import { test, expect } from "./auth-fixture";
import { fallGala, juniper } from "./fixtures";
import { seedRecords } from "./database";
import { seedUsers } from "../../worker/db/seed";

// Staff assignment and Production Leads (FLOW-140): build a multi-day roster on the
// event hub as the seeded Admin, on the real Worker and database.

// seedUsers: each role full-time then part-time.
const lead = seedUsers.find(
  (u) => u.role === "kitchen_lead" && u.employmentType === "full_time",
)!;
const server = seedUsers.find(
  (u) => u.role === "staff" && u.employmentType === "part_time",
)!;

test("builds a multi-day roster with open slots, a double-booking warning and Production Leads", async ({
  page,
}) => {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  await page.goto(`/#/events/${fallGala().id}`);
  await expect(
    page.getByRole("heading", { name: "Staff", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("No staffing slots yet.")).toBeVisible();

  const addShift = async (day: string, start: string, end: string) => {
    await page.getByRole("button", { name: "Add shift" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Day").selectOption({ label: day });
    await dialog.getByLabel("Start time").fill(start);
    await dialog.getByLabel("End time").fill(end);
    await dialog.getByRole("button", { name: "Save shift" }).click();
    await expect(dialog).toBeHidden();
  };
  await addShift("Pull/load day", "08:00", "12:00");
  await addShift("Setup day", "13:00", "18:00");
  await addShift("Event day", "16:00", "23:30");
  // Pull/load and setup default to the day before the event.
  await expect(
    page.getByRole("region", { name: /^Pull\/load day · Fri, Nov 13, 2026/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: /^Setup day · Fri, Nov 13, 2026/ }),
  ).toBeVisible();
  const eventDay = page.getByRole("region", {
    name: /^Event day · Sat, Nov 14, 2026/,
  });

  await eventDay.getByLabel("Position").selectOption("Server");
  await eventDay.getByLabel("How many").fill("5");
  await eventDay.getByRole("button", { name: "Add slots" }).click();
  await expect(eventDay.getByText("Server #5 – open")).toBeVisible();
  const setup = page.getByRole("region", { name: /^Setup day/ });
  await setup.getByLabel("Position").selectOption("Sous Chef");
  await expect(setup.getByLabel("Department")).toHaveValue("kitchen");
  await setup.getByRole("button", { name: "Add slots" }).click();
  await expect(setup.getByText("Sous Chef – open")).toBeVisible();

  await eventDay.getByLabel("Assign Server #1").selectOption({ label: server.name });
  await expect(
    eventDay.getByText(`Server #1 – ${server.name}`),
  ).toBeVisible();
  await eventDay.getByLabel("Assign Server #2").selectOption({ label: server.name });
  await expect(
    page.getByRole("alert").filter({ hasText: `${server.name} is double-booked` }),
  ).toBeVisible();
  await expect(eventDay.getByText(/^Double-booked: also working Fall gala/)).toHaveCount(2);
  await expect(page.getByLabel("Staffing breakdown")).toHaveText(
    "Kitchen: 1 (0 filled) · Service: 5 (2 filled) · 4 open",
  );

  await page.getByRole("button", { name: "Production Leads" }).click();
  const leads = page.getByRole("dialog");
  // Part-time staff can't be the primary (AC4).
  await expect(
    leads.getByLabel("Primary Production Lead").locator("option", {
      hasText: server.name,
    }),
  ).toHaveCount(0);
  await leads
    .getByLabel("Primary Production Lead")
    .selectOption({ label: lead.name });
  await leads.getByLabel(server.name, { exact: true }).check();
  await leads.getByRole("button", { name: "Save leads" }).click();
  await expect(leads).toBeHidden();
  await expect(page.locator(".staff-leads")).toContainText(lead.name);
  await expect(page.locator(".staff-leads")).toContainText(server.name);
});
