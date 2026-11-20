import type { Locator } from "@playwright/test";

// FLOW-259: screens use the shared Dropdown, not a native select, so Playwright's
// selectOption doesn't apply. choose() opens the dropdown and clicks the option,
// matched by value (data-value) or by its label, like selectOption. An array picks
// several options of a multiple dropdown. The list is in a portal on the page.
type Choice = string | { label: string } | string[];
export async function choose(trigger: Locator, choice: Choice) {
  const page = trigger.page();
  await trigger.click();
  const picks = Array.isArray(choice) ? choice : [choice];
  const listbox = page.getByRole("listbox").last();
  for (const pick of picks) {
    const option =
      typeof pick === "string"
        ? listbox.locator(`[role="option"][data-value="${pick.replace(/"/g, '\\"')}"]`).or(listbox.getByRole("option", { name: pick, exact: true })).first()
        : listbox.getByRole("option", { name: pick.label, exact: true });
    // A multiple dropdown keeps an option that's already picked; don't untoggle it.
    if (Array.isArray(choice) && (await option.getAttribute("aria-selected")) === "true") continue;
    await option.click();
  }
  if (Array.isArray(choice)) await page.keyboard.press("Escape");
}

// The option labels a dropdown offers (it opens and closes it). Use with
// expect.poll, as the options of a native select were checked with toHaveCount.
export async function optionTexts(trigger: Locator): Promise<string[]> {
  const page = trigger.page();
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
  const texts = await page.getByRole("listbox").last().getByRole("option").allTextContents();
  await page.keyboard.press("Escape");
  return texts.map((text) => text.trim());
}
