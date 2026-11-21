import { waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

// FLOW-259: the screens' dropdowns are the shared Dropdown, not native selects, so
// user.selectOptions doesn't apply. These open one and pick by value or label.
function listOf(trigger: HTMLElement): HTMLElement {
  const id = trigger.getAttribute("aria-controls");
  const list = id ? document.getElementById(id) : null;
  if (!list) throw new Error("The dropdown is not open");
  return list;
}
export async function openDropdown(user: UserEvent, trigger: HTMLElement): Promise<HTMLElement> {
  if (trigger.getAttribute("aria-expanded") !== "true") await user.click(trigger);
  return waitFor(() => listOf(trigger));
}
export async function choose(user: UserEvent, trigger: HTMLElement, choice: string) {
  const list = await openDropdown(user, trigger);
  const option = await waitFor(() => {
    const options = within(list).getAllByRole("option");
    const match = options.find((o) => o.dataset.value === choice) ?? options.find((o) => o.textContent === choice);
    if (!match) throw new Error(`No option ${choice}`);
    return match;
  });
  await user.click(option);
}
export async function optionTexts(user: UserEvent, trigger: HTMLElement): Promise<string[]> {
  const list = await openDropdown(user, trigger);
  const texts = within(list).getAllByRole("option").map((o) => o.textContent ?? "");
  await user.keyboard("{Escape}");
  return texts;
}
