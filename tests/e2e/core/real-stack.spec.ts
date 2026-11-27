import { choose } from "../dropdown";
import { databaseTest as test, expect, mockBrowserAuth } from "../auth-fixture";
import { seedDatabase, seedId, seedUsers } from "../../../worker/db/seed";
import { browserDb } from "../database";
import { clients, events, leads } from "../../../worker/db/schema";
import {
  addLocalDays,
  businessTimeToUtc,
  utcToBusinessTime,
} from "../../../shared/time";

for (const role of ["admin", "salesperson"] as const) {
  test(`${role}: clients, venues, events, leads, inventory, counts and time on the real stack`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const user = seedUsers.find(
      (u) => u.role === role,
    )!;
    await seedDatabase(process.env.DATABASE_URL);
    await mockBrowserAuth(page, { userId: user.id });
    const otherEventDate = addLocalDays(utcToBusinessTime(new Date()).date, 10);
    await browserDb(async (db) => {
      const otherOwner = seedUsers.find(
        (u) => u.role === "part_time_staff",
      )!.id;
      await db.insert(clients).values({
        id: seedId(30, 1),
        name: "Other salesperson client",
        kind: "person",
        assignedSalespersonId: otherOwner,
      });
      await db.insert(events).values({
        id: seedId(30, 2),
        title: "Other salesperson event",
        clientId: seedId(30, 1),
        // At Negotiation, so Events › Overview's table lists it (FLOW-349
        // retired the /events list); the page opens on its month.
        status: "negotiation",
        startsAt: businessTimeToUtc(otherEventDate, "18:00"),
        assignedSalespersonId: otherOwner,
      });
      await db.insert(leads).values({
        id: seedId(30, 3),
        name: "Other salesperson lead",
        channel: "manual",
        source: "Referral",
        assignedSalespersonId: otherOwner,
      });
    });

    await page.clock.install({ time: new Date(Date.now() - 120_000) });
    const clientsLoaded = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/clients",
    );
    await page.goto("/#/clients");
    await clientsLoaded;
    await page
      .getByPlaceholder("Search clients or contacts…")
      .fill("Other salesperson client");
    await expect(
      page.getByText("Other salesperson client", { exact: true }),
    ).toHaveCount(role === "admin" ? 1 : 0);
    await page.getByPlaceholder("Search clients or contacts…").fill("Juniper");
    await page.getByRole("row", { name: /Juniper & Co\./ })
      .getByRole("button", { name: "Open", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Juniper & Co.", level: 1 }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Contacts", exact: true }).click();
    await expect(
      page.getByText("Olivia Bennett", { exact: true }),
    ).toBeVisible();

    await page.goto(`/#/venues/${seedId(5, 1)}`);
    await expect(
      page.getByRole("heading", { name: "The Glasshouse", level: 1 }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByLabel("Parking notes")
      .fill(`Verified by ${role}`);
    await page.getByRole("button", { name: "Save venue" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByText(`Verified by ${role}`, { exact: true }),
    ).toBeVisible();

    const eventsLoaded = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/events",
    );
    await page.goto(`/#/events/overview?date=${otherEventDate}`);
    await eventsLoaded;
    await expect(
      page.getByRole("table").getByRole("button", {
        name: "Other salesperson event",
        exact: true,
      }),
    ).toHaveCount(role === "admin" ? 1 : 0);
    await page.goto(`/#/events/${seedId(7, 1)}`);
    const eventHeading = page.getByRole("heading", {
      name: "Autumn leadership retreat",
      level: 1,
    });
    await expect(eventHeading).toBeVisible();

    // Advance only the browser's clock from the recent past, so production's
    // future-session guard remains active while one minute elapses instantly.
    await eventHeading.click();
    const recorded = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/time/sessions" &&
        r.request().method() === "POST",
    );
    await page.clock.runFor(61_000);
    expect((await recorded).status()).toBe(200);
    await page.clock.resume();
    await page.goto("/#/reports");
    await expect(
      page.getByRole("link", {
        name: "Autumn leadership retreat",
        exact: true,
      }),
    ).toBeVisible();
    if (role === "salesperson")
      await expect(
        page.getByText("Your own active time in Flowbase.", { exact: false }),
      ).toBeVisible();

    await page.goto("/#/leads");
    await expect(
      page.getByRole("link", { name: "Seed wedding inquiry", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Other salesperson lead", exact: true }),
    ).toHaveCount(role === "admin" ? 1 : 0);
    await page.getByRole("link", { name: "Seed wedding inquiry", exact: true }).click();
    await page.getByRole("combobox", { name: "Lead status" }).click();
    await page.getByRole("option", { name: "Pitching" }).click();
    await expect(page.getByText("Pitching", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("Pitching", { exact: true })).toBeVisible();

    await page.goto(`/#/inventory/${seedId(8, 3)}`);
    await expect(
      page.getByRole("heading", { name: "Linen napkins · sage", level: 1 }),
    ).toBeVisible();
    await expect(
      page
        .locator(".stock-table")
        .first()
        .getByRole("row", { name: /^Warehouse / }),
    ).toBeVisible();

    // FLOW-291: a count starts from the Inventory tab; supplies are Master
    // items kept at the Warehouse (FLOW-289).
    await page.goto("/#/inventory");
    await choose(
      page.getByRole("combobox", { name: "Start stock count" }),
      { label: "Warehouse" },
    );
    const line = page.getByRole("listitem", {
      name: "Chafing dish fuel",
      exact: true,
    });
    await line.getByLabel("Counted (each)").fill("5");
    await line
      .getByRole("button", { name: "Save count for Chafing dish fuel" })
      .click();
    await expect(line.getByRole("status")).toContainText("Counted 5 each");
    await page.reload();
    await expect(line.getByRole("status")).toContainText("Counted 5 each");
    if (role === "salesperson") {
      const statuses = await page.evaluate(
        async (ids) => {
          const token = JSON.parse(
            localStorage.getItem("sb-test-auth-token")!,
          ).access_token;
          return Promise.all(
            ids.map(
              async (path) =>
                (
                  await fetch(path, {
                    headers: { Authorization: `Bearer ${token}` },
                  })
                ).status,
            ),
          );
        },
        ["clients", "events", "leads"].map(
          (resource, i) => `/api/${resource}/${seedId(30, i + 1)}`,
        ),
      );
      expect(statuses).toEqual([404, 404, 404]);
    }
  });
}

test("browser contract validation detects a malformed real-route response", async ({
  page,
}) => {
  await mockBrowserAuth(page);
  await page.goto("/#/venues");
  await expect(
    page.getByRole("heading", { name: "Venues", exact: true }),
  ).toBeVisible();
  // A deliberate mutation proves the schema validator used by the automatic
  // fixture rejects drift even if the UI would tolerate it.
  const { responseSchema } = await import("../response-contracts");
  const contract = responseSchema("/api/venues", "GET", 200);
  expect(() => contract.parse([{ id: "changed-response" }])).toThrow();
});
