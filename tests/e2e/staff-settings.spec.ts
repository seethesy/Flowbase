import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect, signedInUser } from "./auth-fixture";
import { juniper, mockRecordsApi } from "./mock-api";
import {
  fallbackSettings,
  type BusinessSettings,
  type ListValue,
} from "../../shared/settings";
import type { StaffMember } from "../../shared/staff";

// Staff directory (FLOW-40), business settings (FLOW-45) and CSV export (FLOW-48)
// against in-memory stand-ins for their APIs, as the signed-in Admin.
const member = (overrides: Partial<StaffMember>): StaffMember => ({
  id: randomUUID(),
  name: "Someone",
  email: "someone@gmail.com",
  mobile: "2025550100",
  role: "staff",
  employmentType: "part_time",
  status: "active",
  active: true,
  positions: [],
  notes: "",
  smsConsent: false,
  smsConsentAt: null,
  ...overrides,
});

async function mockStaffAndSettings(page: Page, staff: StaffMember[]) {
  const settings: BusinessSettings = structuredClone(fallbackSettings);
  await page.route(/\/api\/settings(\/|$)/, async (route) => {
    const request = route.request();
    const parts = new URL(request.url()).pathname.split("/");
    if (request.method() === "GET" && parts.length === 3)
      return route.fulfill({ json: settings });
    if (parts[3] === "history") return route.fulfill({ json: [] });
    if (parts[3] === "lists" && request.method() === "POST") {
      const key = parts[4] as keyof BusinessSettings["lists"];
      const value: ListValue = {
        id: randomUUID(),
        listKey: key,
        label: request.postDataJSON().label,
        sortOrder: settings.lists[key].length,
        archived: false,
      };
      settings.lists[key].push(value);
      return route.fulfill({ status: 201, json: value });
    }
    if (parts[3] === "values" && parts[5] === "archive") {
      const value = Object.values(settings.lists)
        .flat()
        .find((candidate) => candidate.id === parts[4])!;
      value.archived = true;
      return route.fulfill({ json: value });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.route(/\/api\/staff(\/|$)/, async (route) => {
    const id = new URL(route.request().url()).pathname.split("/")[3];
    if (!id) return route.fulfill({ json: staff });
    const current = staff.find((candidate) => candidate.id === id)!;
    if (route.request().method() === "PATCH")
      Object.assign(current, route.request().postDataJSON());
    return route.fulfill({ json: current });
  });
}

test("filters the staff directory by position and employment type and exports the filtered list", async ({
  page,
}) => {
  await mockStaffAndSettings(page, [
    member({
      name: "Avery Captain",
      email: "avery@gmail.com",
      employmentType: "full_time",
      positions: ["Catering Lead/Captain", "Server"],
    }),
    member({ name: "Blake Server", email: "blake@gmail.com", positions: ["Server"] }),
    member({ name: "Casey Driver", email: "casey@gmail.com", positions: ["Driver"] }),
    member({
      name: "Drew Former",
      email: "drew@gmail.com",
      positions: ["Server"],
      status: "deactivated",
      active: false,
    }),
  ]);
  await page.goto("/#/staff");
  await expect(page.getByText("3 staff", { exact: true })).toBeVisible();
  await page.getByLabel("Position", { exact: true }).selectOption("Server");
  await expect(page.getByText("2 staff", { exact: true })).toBeVisible();
  await page
    .getByLabel("Employment type", { exact: true })
    .selectOption({ label: "Part-time" });
  await expect(page.getByText("1 staff", { exact: true })).toBeVisible();
  await page.getByLabel("Employment type", { exact: true }).selectOption("");
  await page.getByLabel("Show inactive").check();
  await expect(page.getByText("3 staff", { exact: true })).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^staff-\d{4}-\d{2}-\d{2}\.csv$/);
  const lines = (await readFile((await file.path())!, "utf8"))
    .replace(/^\ufeff/, "")
    .trimEnd()
    .split("\r\n");
  expect(lines[0]).toBe("Name,Positions,Role,Employment,Mobile,Email,Status");
  expect(lines.slice(1).map((line) => line.split(",")[0])).toEqual([
    "Avery Captain",
    "Blake Server",
    "Drew Former",
  ]);
  expect(lines[1]).toContain("Catering Lead/Captain; Server");
});

test("a list value Admin adds in Settings is offered in the event form, and archiving removes it", async ({
  page,
}) => {
  await mockStaffAndSettings(page, [
    member({ id: signedInUser.id, name: signedInUser.name, role: "admin" }),
  ]);
  await mockRecordsApi(page, { clients: [juniper()] });
  await page.goto("/#/settings");
  await page.getByLabel(/^List/).selectOption({ label: "Event types" });
  await page.getByLabel("Add to Event types").fill("Gala");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Gala added.", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Event types" }).getByText("Gala"),
  ).toBeVisible();

  await page.goto("/#/events");
  await page.getByRole("button", { name: "New Event", exact: true }).click();
  const eventType = page.getByRole("dialog").getByLabel(/^Event type/);
  await expect(eventType.locator("option")).toHaveText([
    "—",
    "Corporate",
    "Wedding",
    "Gala",
  ]);
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.goto("/#/settings");
  await page.getByLabel(/^List/).selectOption({ label: "Event types" });
  await page
    .getByRole("list", { name: "Event types" })
    .getByRole("listitem")
    .filter({ hasText: "Gala" })
    .getByRole("button", { name: "Archive" })
    .click();
  await expect(page.getByText("Gala archived.", { exact: true })).toBeVisible();
  await page.goto("/#/events");
  await page.getByRole("button", { name: "New Event", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByLabel(/^Event type/).locator("option"),
  ).toHaveText(["—", "Corporate", "Wedding"]);
});
