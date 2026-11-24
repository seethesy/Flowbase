import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Dropdown } from "../../src/components/ui/Dropdown";
import { StatusSelect } from "../../src/components/ui/status-pill";

// FLOW-259: one shared dropdown in place of every native select.
function Fruit({ onChange = () => {} }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState("apple");
  return (
    <label>
      Fruit
      <Dropdown
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          onChange(event.target.value);
        }}
      >
        <option value="apple">Apple</option>
        <option value="banana">Banana</option>
        <option value="cherry" disabled>
          Cherry
        </option>
        <option value="date">Date</option>
      </Dropdown>
    </label>
  );
}

describe("Dropdown", () => {
  it("is a combobox button that opens a listbox of options with a check on the current one", async () => {
    const user = userEvent.setup();
    render(<Fruit />);
    const trigger = screen.getByRole("combobox", { name: "Fruit" });
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveTextContent("Apple");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const list = screen.getByRole("listbox");
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["Apple", "Banana", "Cherry", "Date"]);
    expect(within(list).getByRole("option", { name: "Apple" })).toHaveAttribute("aria-selected", "true");
    await user.click(within(list).getByRole("option", { name: "Banana" }));
    expect(trigger).toHaveTextContent("Banana");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("renders the list in a portal outside a scrolling container (AC4)", async () => {
    const user = userEvent.setup();
    render(
      <div data-testid="scroller" style={{ overflow: "auto", height: 40 }}>
        <Fruit />
      </div>,
    );
    await user.click(screen.getByRole("combobox", { name: "Fruit" }));
    expect(screen.getByTestId("scroller")).not.toContainElement(screen.getByRole("listbox"));
  });

  it("works from the keyboard alone (AC3)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Fruit onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "Fruit" });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    const activeName = () => document.getElementById(trigger.getAttribute("aria-activedescendant") ?? "")?.textContent;
    expect(activeName()).toBe("Apple");
    await user.keyboard("{ArrowDown}");
    expect(activeName()).toBe("Banana");
    // Disabled options are skipped.
    await user.keyboard("{ArrowDown}");
    expect(activeName()).toBe("Date");
    await user.keyboard("{Home}");
    expect(activeName()).toBe("Apple");
    await user.keyboard("{End}");
    expect(activeName()).toBe("Date");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("date");
    expect(trigger).toHaveFocus();
    // Type-ahead, then Space chooses.
    await user.keyboard("b");
    expect(activeName()).toBe("Banana");
    await user.keyboard(" ");
    expect(onChange).toHaveBeenLastCalledWith("banana");
    // Esc closes without choosing and keeps focus on the trigger.
    await user.keyboard("{ArrowDown}{ArrowDown}{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveTextContent("Banana");
  });

  it("takes Esc before a surrounding dialog, so only the list closes", async () => {
    const user = userEvent.setup();
    const dialogEscape = vi.fn();
    document.addEventListener("keydown", (event) => event.key === "Escape" && dialogEscape(), { capture: true });
    render(<Fruit />);
    await user.click(screen.getByRole("combobox", { name: "Fruit" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(dialogEscape).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(dialogEscape).toHaveBeenCalledTimes(1);
  });

  it("closes on an outside click", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Fruit />
        <p>Elsewhere</p>
      </>,
    );
    await user.click(screen.getByRole("combobox", { name: "Fruit" }));
    await user.click(screen.getByText("Elsewhere"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("submits its value with a form under its name, and keeps an uncontrolled value", async () => {
    const user = userEvent.setup();
    let submitted: FormData | null = null;
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitted = new FormData(event.currentTarget);
        }}
      >
        <Dropdown name="role" defaultValue="staff" aria-label="Role">
          <option value="admin">Admin</option>
          <option value="staff">Staff</option>
        </Dropdown>
        <button type="submit">Save</button>
      </form>,
    );
    await user.click(screen.getByRole("combobox", { name: "Role" }));
    await user.click(screen.getByRole("option", { name: "Admin" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(submitted!.get("role")).toBe("admin");
  });

  it("keeps a multiple list open and toggles values", async () => {
    const user = userEvent.setup();
    function People() {
      const [ids, setIds] = useState<string[]>([]);
      return (
        <Dropdown multiple aria-label="People" value={ids} onChange={(e) => setIds([...e.target.selectedOptions].map((o) => o.value))}>
          <option value="a">Ann</option>
          <option value="b">Bo</option>
        </Dropdown>
      );
    }
    render(<People />);
    const trigger = screen.getByRole("combobox", { name: "People" });
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "Ann" }));
    await user.click(screen.getByRole("option", { name: "Bo" }));
    expect(screen.getByRole("listbox")).toHaveAttribute("aria-multiselectable", "true");
    expect(trigger).toHaveTextContent("Ann, Bo");
    await user.click(screen.getByRole("option", { name: "Ann" }));
    expect(trigger).toHaveTextContent("Bo");
  });

  // FLOW-332: a multiple-choice filter with a rounded-square checkbox on each
  // option's left and a summary on the trigger.
  it("draws a checkbox before each option and a summary on the trigger when asked", async () => {
    const user = userEvent.setup();
    function Layers() {
      const [on, setOn] = useState<string[]>(["holds"]);
      return (
        <Dropdown multiple checkboxes aria-label="Layers" value={on} summary={`Show: ${on.length} layers`} onValueChange={setOn}>
          <option value="production">Production tasks</option>
          <option value="holds">Tentative holds</option>
        </Dropdown>
      );
    }
    render(<Layers />);
    const trigger = screen.getByRole("combobox", { name: "Layers" });
    expect(trigger).toHaveTextContent("Show: 1 layers");
    await user.click(trigger);
    const holds = screen.getByRole("option", { name: "Tentative holds" });
    const production = screen.getByRole("option", { name: "Production tasks" });
    // The box comes first, checked for a chosen option, and there's no trailing check mark.
    expect(holds.firstElementChild).toHaveClass("fb-select-option__box", "is-checked");
    expect(production.firstElementChild).toHaveClass("fb-select-option__box");
    expect(production.firstElementChild).not.toHaveClass("is-checked");
    expect(holds.querySelector(".fb-select-option__check")).toBeNull();
    await user.click(production);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(production).toHaveAttribute("aria-selected", "true");
    expect(production.firstElementChild).toHaveClass("is-checked");
    expect(trigger).toHaveTextContent("Show: 2 layers");
  });

  it("keeps the trailing check mark and no box without checkboxes", async () => {
    const user = userEvent.setup();
    render(<Fruit />);
    await user.click(screen.getByRole("combobox", { name: "Fruit" }));
    const apple = screen.getByRole("option", { name: "Apple" });
    expect(apple.querySelector(".fb-select-option__box")).toBeNull();
    expect(apple.querySelector(".fb-select-option__check")).not.toBeNull();
  });

  it("shows <optgroup> labels as headings over their options", async () => {
    const user = userEvent.setup();
    render(
      <Dropdown aria-label="Subcategory" defaultValue="">
        <option value="">All subcategories</option>
        <optgroup label="Liquor">
          <option>Vodka</option>
          <option>Gin</option>
        </optgroup>
        <optgroup label="Wine">
          <option>White</option>
        </optgroup>
      </Dropdown>,
    );
    await user.click(screen.getByRole("combobox", { name: "Subcategory" }));
    const liquor = screen.getByRole("group", { name: "Liquor" });
    expect(within(liquor).getAllByRole("option").map((o) => o.textContent)).toEqual(["Vodka", "Gin"]);
    expect(within(screen.getByRole("group", { name: "Wine" })).getByRole("option", { name: "White" })).toBeInTheDocument();
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(screen.getByRole("combobox", { name: "Subcategory" })).toHaveAttribute("data-value", "Gin");
  });

  it("shows status options as their colored pills (AC2)", async () => {
    const user = userEvent.setup();
    render(<StatusSelect label="Lead status" value="pitching" onChange={() => {}} />);
    const trigger = screen.getByRole("combobox", { name: "Lead status" });
    expect(trigger.querySelector(".status-pill--pitching")).toHaveTextContent("Pitching");
    await user.click(trigger);
    const closing = screen.getByRole("option", { name: "Closing" });
    expect(closing.querySelector(".status-pill.status-pill--closing")).not.toBeNull();
  });

  it("offers an Add box only when creatable, and selects the created option", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(async (name: string) => `id-${name}`);
    function Categories({ creatable }: { creatable: boolean }) {
      const [options, setOptions] = useState([{ value: "", label: "None" }]);
      const [value, setValue] = useState("");
      return (
        <Dropdown
          aria-label="Category"
          value={value}
          options={options}
          onValueChange={setValue}
          creatable={
            creatable
              ? {
                  onCreate: async (name) => {
                    const id = await onCreate(name);
                    setOptions((list) => [...list, { value: id, label: name }]);
                    return id;
                  },
                }
              : undefined
          }
        />
      );
    }
    const { unmount } = render(<Categories creatable={false} />);
    await user.click(screen.getByRole("combobox", { name: "Category" }));
    expect(screen.queryByRole("textbox", { name: "Add option" })).not.toBeInTheDocument();
    unmount();
    render(<Categories creatable />);
    await user.click(screen.getByRole("combobox", { name: "Category" }));
    await user.type(screen.getByRole("textbox", { name: "Add option" }), "Furniture{Enter}");
    expect(onCreate).toHaveBeenCalledWith("Furniture");
    expect(screen.getByRole("combobox", { name: "Category" })).toHaveTextContent("Furniture");
  });

  it("passes axe checks closed and open (AC3)", async () => {
    const user = userEvent.setup();
    const { container } = render(<Fruit />);
    const rules = { "color-contrast": { enabled: false }, region: { enabled: false } };
    const closed = await axe.run(container, { rules });
    expect(closed.violations).toEqual([]);
    await user.click(screen.getByRole("combobox", { name: "Fruit" }));
    const open = await axe.run(document.body, { rules });
    expect(open.violations).toEqual([]);
  });
});

// AC1: no screen renders a browser-default dropdown. The lint rule catches the
// same thing in the editor; this keeps it true if the rule is ever bypassed.
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(tsx|ts)$/.test(name) ? [path] : [];
  });
}
it("has no native select anywhere in src", () => {
  const offenders = sourceFiles(join(process.cwd(), "src")).filter((path) => /<select[\s>]/.test(readFileSync(path, "utf8")));
  expect(offenders).toEqual([]);
});
