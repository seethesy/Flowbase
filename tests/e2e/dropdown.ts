import type { Locator } from "@playwright/test";

// FLOW-259: screens use the shared Dropdown, not a native select, so Playwright's
// selectOption doesn't apply. choose() opens the dropdown and clicks the option,
// matched by value (data-value) or by its label, like selectOption. An array sets
// exactly those options on a multiple dropdown. The list is in a portal on the page.
type Choice = string | { label: string } | string[];
export async function choose(trigger: Locator, choice: Choice) {
  const page = trigger.page();
  await trigger.click();
  const listbox = page.getByRole("listbox").last();
  await listbox.waitFor();
  if (Array.isArray(choice)) {
    // Like selectOption([...]) on a multiple select: exactly these end up picked.
    const options = listbox.getByRole("option");
    const count = await options.count();
    for (let index = 0; index < count; index += 1) {
      const option = options.nth(index);
      const value = await option.getAttribute("data-value");
      const text = (await option.textContent())?.trim();
      const wanted = choice.some((pick) => pick === value || pick === text);
      const picked = (await option.getAttribute("aria-selected")) === "true";
      if (wanted !== picked) await option.click();
    }
    await page.keyboard.press("Escape");
    return;
  }
  const option =
    typeof choice === "string"
      ? listbox.locator(`[role="option"][data-value="${choice.replace(/"/g, '\\"')}"]`).or(listbox.getByRole("option", { name: choice, exact: true })).first()
      : listbox.getByRole("option", { name: choice.label, exact: true });
  await option.click();
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
