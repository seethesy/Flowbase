import { expect, test } from "@playwright/test";

// The embeddable inquiry form (FLOW-109). It is public: no sign-in.
test("a visitor sends an inquiry and sees a thank-you", async ({ page }) => {
  const posts: Record<string, unknown>[] = [];
  await page.route("**/api/ingest/website", async (route) => {
    posts.push(route.request().postDataJSON());
    await route.fulfill({ status: 202, json: { receiptId: "r-1", duplicate: false } });
  });
  await page.goto("/inquiry.html");
  await page.getByLabel("Your name *").fill("Jordan Example");
  await page.getByRole("button", { name: "Send inquiry" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Enter an email address or phone number.",
  );
  expect(posts).toHaveLength(0);
  await page.getByLabel("Email").fill("jordan.example@example.test");
  await page.getByLabel("Number of guests").fill("85");
  await page.getByRole("button", { name: "Send inquiry" }).click();
  await expect(page.getByRole("heading", { name: "Thank you" })).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({
    name: "Jordan Example",
    email: "jordan.example@example.test",
    guestCount: 85,
    company: "",
  });
  expect(String(posts[0].submissionId)).toHaveLength(36);
});

test("a failed send keeps the form and retries the same submission", async ({ page }) => {
  const ids: unknown[] = [];
  let attempt = 0;
  await page.route("**/api/ingest/website", async (route) => {
    ids.push(route.request().postDataJSON().submissionId);
    attempt += 1;
    await route.fulfill(
      attempt === 1
        ? { status: 429, json: { error: { code: "RATE_LIMITED", message: "x" } } }
        : { status: 202, json: { receiptId: "r-1", duplicate: false } },
    );
  });
  await page.goto("/inquiry.html");
  await page.getByLabel("Your name *").fill("Jordan Example");
  await page.getByLabel("Phone").fill("555-010-0199");
  await page.getByRole("button", { name: "Send inquiry" }).click();
  await expect(page.getByRole("alert")).toContainText("try again later");
  await page.getByRole("button", { name: "Send inquiry" }).click();
  await expect(page.getByRole("heading", { name: "Thank you" })).toBeVisible();
  expect(ids[0]).toBe(ids[1]);
});
