import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { RoundCheck } from "../../src/components/ui/round-check";

// FLOW-245: one round checkbox, used everywhere.
function Labelled({ initial = false }: { initial?: boolean }) {
  const [checked, setChecked] = useState(initial);
  return (
    <label>
      <RoundCheck checked={checked} onChange={(e) => setChecked(e.target.checked)} />
      Show archived
    </label>
  );
}

describe("RoundCheck", () => {
  it("is a native checkbox with the round-check style", () => {
    render(<Labelled />);
    const check = screen.getByRole("checkbox", { name: "Show archived" });
    expect(check).toHaveAttribute("type", "checkbox");
    expect(check).toHaveClass("round-check");
    expect(check).not.toBeChecked();
  });

  it("toggles with Space and with a click on its label (AC3)", async () => {
    const user = userEvent.setup();
    render(<Labelled />);
    const check = screen.getByRole("checkbox", { name: "Show archived" });
    check.focus();
    await user.keyboard(" ");
    expect(check).toBeChecked();
    await user.click(screen.getByText("Show archived"));
    expect(check).not.toBeChecked();
  });

  it("puts the label text after the check", () => {
    render(<Labelled />);
    const label = screen.getByText("Show archived").closest("label")!;
    expect(label.firstElementChild).toBe(screen.getByRole("checkbox"));
  });

  it("shows a dash for some-selected and honours disabled", () => {
    const { rerender } = render(<RoundCheck aria-label="Select all" indeterminate checked={false} onChange={() => {}} />);
    const check = screen.getByRole("checkbox", { name: "Select all" }) as HTMLInputElement;
    expect(check.indeterminate).toBe(true);
    rerender(<RoundCheck aria-label="Select all" checked onChange={() => {}} disabled />);
    expect(check.indeterminate).toBe(false);
    expect(check).toBeDisabled();
    expect(check).toBeChecked();
  });

  it("forwards its ref to the input", () => {
    let input: HTMLInputElement | null = null;
    render(<RoundCheck aria-label="Ref" ref={(node) => {
      input = node;
    }} />);
    expect(input).toBe(screen.getByRole("checkbox", { name: "Ref" }));
  });
});

// AC1: no screen renders a browser-default checkbox. The lint rule catches the
// same thing in the editor; this keeps it true if the rule is ever bypassed.
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(tsx|ts)$/.test(name) ? [path] : [];
  });
}
it("has no raw checkbox outside RoundCheck", () => {
  const offenders = sourceFiles(join(process.cwd(), "src"))
    .filter((path) => !path.endsWith(join("components", "ui", "round-check.tsx")))
    .filter((path) => /<input\b[^>]*\btype=(["'{]|\{["'`])checkbox/s.test(readFileSync(path, "utf8")));
  expect(offenders).toEqual([]);
});
