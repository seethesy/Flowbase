import { eq } from "drizzle-orm";
import { choose } from "./dropdown";
import { test, expect } from "./auth-fixture";
import { fallGala, juniper } from "./fixtures";
import { browserDb, seedRecords } from "./database";
import { approvalRequests, contracts, proposals, proposalVersions } from "../../worker/db/schema";
import { DOCX_TYPE, PDF_TYPE } from "../../shared/proposals";

// The Proposals library (FLOW-276) as the seeded Admin on the real Worker and
// database: one file per event, labels, views, links, rename, search and filter,
// and the Sales tracker's new home at /sales.

const gala = { proposal: "f0000000-0000-4000-8000-000000000276", v1: "a0000000-0000-4000-8000-000000002761", v2: "a0000000-0000-4000-8000-000000002762" };
const brunch = { event: "e0000000-0000-4000-8000-000000000276", proposal: "f0000000-0000-4000-8000-000000000277", v1: "a0000000-0000-4000-8000-000000002771" };
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);
const stored = (key: string, fileName: string, contentType = DOCX_TYPE) => ({ key, fileName, contentType, size: 10 });

async function seedLibrary() {
  await seedRecords({ clients: [juniper()], events: [fallGala(), { ...fallGala(), id: brunch.event, title: "Spring brunch", date: "2027-03-14" }] });
  await browserDb(async (db) => {
    await db.insert(proposals).values([
      { id: gala.proposal, eventId: fallGala().id, clientId: juniper().id, title: "Gala proposal", stage: "closed" },
      { id: brunch.proposal, eventId: brunch.event, clientId: juniper().id, title: "Brunch proposal" },
    ]);
    await db.insert(proposalVersions).values([
      { id: gala.v1, proposalId: gala.proposal, number: 1, status: "ready", completedAt: daysAgo(3), docx: stored("proposal/gala/v1/proposal.docx", "Gala v1.docx") },
      { id: gala.v2, proposalId: gala.proposal, number: 2, status: "ready", completedAt: daysAgo(2),
        docx: stored("proposal/gala/v2/proposal.docx", "Gala v2.docx"), pdf: stored("proposal/gala/v2/proposal.pdf", "Gala v2.pdf", PDF_TYPE) },
      { id: brunch.v1, proposalId: brunch.proposal, number: 1, status: "ready", completedAt: daysAgo(100), docx: stored("proposal/brunch/v1/proposal.docx", "Brunch.docx") },
    ]);
    await db.update(proposals).set({ currentVersionId: gala.v2 }).where(eq(proposals.id, gala.proposal));
    await db.update(proposals).set({ currentVersionId: brunch.v1 }).where(eq(proposals.id, brunch.proposal));
    await db.insert(approvalRequests).values({ subjectType: "proposal_version", subjectId: gala.v2, summary: "Gala", approverRole: "admin", status: "approved" });
    // Final: the client signed the contract for the gala's latest version.
    await db.insert(contracts).values({ eventId: fallGala().id, proposalId: gala.proposal, versionId: gala.v2,
      signedAt: daysAgo(1), clientSigner: "Client", salespersonSigner: "Salesperson" });
  });
}

test("lists one file per event with labels, links, search and the upload-date filter", async ({ page }) => {
  await seedLibrary();
  await page.goto("/#/proposals");
  await expect(page.getByRole("heading", { name: "Proposals", exact: true })).toBeVisible();
  const table = page.getByRole("table", { name: "Proposal files" });
  await expect(table.getByRole("row")).toHaveCount(3);
  const galaRow = table.getByRole("row", { name: /Gala proposal/ });
  const brunchRow = table.getByRole("row", { name: /Brunch proposal/ });
  // AC2: labels for the shown version only.
  await expect(galaRow.getByText("Approved", { exact: true })).toBeVisible();
  await expect(galaRow.getByText("Final", { exact: true })).toBeVisible();
  await expect(brunchRow.getByText("Approved", { exact: true })).toHaveCount(0);
  await expect(brunchRow.getByText("Final", { exact: true })).toHaveCount(0);
  // AC1: the event shows as a link carrying its name, with no other details.
  await expect(galaRow.getByRole("link", { name: "Fall gala" })).toHaveAttribute("href", `#/events/${fallGala().id}?proposal=${gala.proposal}`);
  await expect(table).not.toContainText("2026-11-14");
  // AC4: the latest version's .docx and its PDF.
  await expect(galaRow.getByRole("link", { name: "Download Gala proposal (DOCX)" })).toHaveAttribute("href", /proposal\/gala\/v2\/proposal\.docx/);
  await expect(galaRow.getByRole("link", { name: "Download Gala proposal (DOCX)" })).toHaveAttribute("download", "Gala v2.docx");
  await expect(galaRow.getByRole("link", { name: "Open Gala proposal (PDF)" })).toHaveAttribute("href", /proposal\/gala\/v2\/proposal\.pdf/);
  await expect(brunchRow.getByRole("link", { name: /\(PDF\)/ })).toHaveCount(0);
  // AC6: search by name, then the upload-date filter.
  await page.getByPlaceholder("Search files…").fill("brunch");
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(brunchRow).toBeVisible();
  await page.getByPlaceholder("Search files…").fill("");
  await choose(page.getByLabel("Uploaded"), { label: "Last 90 days" });
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(galaRow).toBeVisible();
  await choose(page.getByLabel("Uploaded"), { label: "Last 7 days" });
  await expect(galaRow).toBeVisible();
});

test("names can't be edited in the library; they change on the event page", async ({ page }) => {
  await seedLibrary();
  await page.goto("/#/proposals");
  const table = page.getByRole("table", { name: "Proposal files" });
  await expect(table.getByRole("row", { name: /Gala proposal/ })).toBeVisible();
  await expect(table.locator(".table-edit-trigger")).toHaveCount(0);
  await expect(table.getByRole("textbox")).toHaveCount(0);
  await browserDb(async (db) => { await db.update(proposals).set({ title: "Gala proposal final" }).where(eq(proposals.id, gala.proposal)); });
  await page.reload();
  await expect(table.getByRole("row", { name: /Gala proposal final/ })).toBeVisible();
});

test("switches between list and grid views and remembers the choice", async ({ page }) => {
  await seedLibrary();
  await page.goto("/#/proposals");
  await expect(page.getByRole("table", { name: "Proposal files" })).toBeVisible();
  await page.getByRole("button", { name: "Grid" }).click();
  const grid = page.getByRole("list", { name: "Proposal files" });
  await expect(grid.getByRole("listitem")).toHaveCount(2);
  await expect(grid.getByRole("listitem").filter({ hasText: "Gala proposal" }).getByText("Final", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Grid" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("list", { name: "Proposal files" })).toBeVisible();
  await page.getByRole("button", { name: "List" }).click();
  await page.reload();
  await expect(page.getByRole("table", { name: "Proposal files" })).toBeVisible();
});

test("the Sales tracker lives at /sales and its tab opens it", async ({ page }) => {
  await seedLibrary();
  await page.goto("/#/proposals");
  await page.getByRole("navigation", { name: "Sales pages" }).getByRole("link", { name: "Sales tracker" }).click();
  await expect(page).toHaveURL(/#\/sales$/);
  await expect(page.getByRole("heading", { name: "Sales tracker", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Sales reports" }).click();
  await expect(page.getByRole("heading", { name: "Sales reports" })).toBeVisible();
  await page.getByRole("link", { name: "← Sales tracker" }).click();
  await expect(page).toHaveURL(/#\/sales$/);
});
