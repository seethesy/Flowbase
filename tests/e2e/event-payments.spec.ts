import { test, expect } from "./auth-fixture";
import { fallGala, juniper } from "./fixtures";
import { seedRecords } from "./database";

// Payment schedule and log (FLOW-131): schedule a $1,500 deposit and a $3,500
// balance, record the deposit, and see the $3,500 balance. A card number in the
// reference is refused.

// TEMPORARY: prints what the page showed when this test failed on CI.
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const info = await page
    .evaluate(() => ({
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      dialogs: [...document.querySelectorAll("[role=dialog]")].map((d) =>
        (d.textContent ?? "").slice(0, 400),
      ),
      text: document.body.innerText.slice(0, 2500),
    }))
    .catch((e: Error) => ({ error: e.message }));
  console.log(`DIAG ${testInfo.project.name} ${testInfo.title} ${JSON.stringify(info)}`);
});

test("records a payment against the schedule and refuses a card number", async ({
  page,
}) => {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  await page.goto(`/#/events/${fallGala().id}`);
  await expect(
    page.getByRole("heading", { name: "Payments", exact: true }),
  ).toBeVisible();

  const schedule = async (type: string, amount: string, due: string) => {
    await page.getByRole("button", { name: "Add scheduled payment" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Type").selectOption({ label: type });
    await dialog.getByLabel("Amount ($)").fill(amount);
    await dialog.getByLabel("Due date").fill(due);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
  };
  await schedule("Deposit", "1500", "2027-01-10");
  await schedule("Balance", "3500", "2027-02-10");
  await expect(page.getByTestId("payments-balance")).toHaveText("$5,000.00");

  await page.getByRole("button", { name: "Record payment" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Method").selectOption({ label: "Zelle" });
  await dialog.getByLabel("Amount ($)").fill("1500");
  await dialog.getByLabel("Reference").fill("4242 4242 4242 4242");
  await dialog.getByRole("button", { name: "Record payment" }).click();
  await expect(dialog.getByRole("alert")).toContainText("card number");

  await dialog.getByLabel("Reference").fill("ZEL-8841");
  await dialog.getByRole("button", { name: "Record payment" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("payments-balance")).toHaveText("$3,500.00");
  await expect(page.getByText("ZEL-8841")).toBeVisible();
});
