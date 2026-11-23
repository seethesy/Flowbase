import { fireEvent, render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { describe, expect, it, vi } from "vitest";
import { emptyLayout, layoutProblems, layoutTables } from "../shared/layout";
import { DateTimeCell, dateTimeSortKey, instantParts } from "../src/components/shared/date-time-cell";
import { fromRowControl, rowOpenProps } from "../src/components/shared/row-open";

// FLOW-296: the shared row-open rule, the date/time cell, and the tables
// registered for column resize.

function Row({ open }: { open: () => void }) {
  return (
    <table>
      <tbody>
        <tr data-testid="row" {...rowOpenProps(open)}>
          <td>Plain text</td>
          <td>
            <button type="button">Status</button>
            <span role="combobox" aria-label="Owner" tabIndex={0} />
            {createPortal(<div role="listbox"><div role="option" aria-selected="false">In portal</div></div>, document.body)}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

describe("row open (FLOW-296 AC3)", () => {
  it("opens on a plain cell and never on a control or a portal menu", () => {
    const open = vi.fn();
    render(<Row open={open} />);
    fireEvent.click(screen.getByText("Status"));
    fireEvent.click(screen.getByRole("combobox", { name: "Owner" }));
    fireEvent.click(screen.getByRole("option", { name: "In portal" }));
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Plain text"));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("ignores Enter and Space from a control, opens on Enter on the row itself", () => {
    const open = vi.fn();
    render(<Row open={open} />);
    fireEvent.keyDown(screen.getByText("Status"), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Owner" }), { key: " " });
    expect(open).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByTestId("row"), { key: "Enter" });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("treats the open link itself as not a control of its own", () => {
    const link = document.createElement("button");
    const inner = document.createElement("span");
    link.append(inner);
    expect(fromRowControl({ target: inner, currentTarget: link })).toBe(false);
    const nested = document.createElement("span");
    nested.setAttribute("role", "combobox");
    link.append(nested);
    expect(fromRowControl({ target: nested, currentTarget: link })).toBe(true);
  });
});

describe("date and time cell (FLOW-296 AC2)", () => {
  it("shows the time beneath the date, and one part alone as text", () => {
    const { container, rerender } = render(<DateTimeCell date="2026-09-03" time="18:00" />);
    expect(container.querySelector(".date-time-cell__date")).toHaveTextContent("2026-09-03");
    expect(container.querySelector(".date-time-cell__time")).toHaveTextContent("18:00");
    rerender(<DateTimeCell date="2026-09-03" />);
    expect(container.querySelector(".date-time-cell")).toBeNull();
    expect(container).toHaveTextContent("2026-09-03");
    rerender(<DateTimeCell />);
    expect(container).toHaveTextContent("—");
  });

  it("sorts by date then time, and reads an instant in business time", () => {
    const keys = [dateTimeSortKey("2026-09-03", "18:00"), dateTimeSortKey("2026-09-03", "09:00"), dateTimeSortKey("2026-09-02", "23:00")];
    expect([...keys].sort()).toEqual(["2026-09-02T23:00", "2026-09-03T09:00", "2026-09-03T18:00"]);
    expect(instantParts("2026-09-03T22:00:00.000Z")).toEqual({ date: "2026-09-03", time: "18:00" });
    expect(instantParts(null)).toBeNull();
  });
});

describe("tables registered for resize (FLOW-296 AC1)", () => {
  it("saves widths on a table with no source, and still checks sourced tables", () => {
    expect(layoutTables["lead-dashboard.by-source"].source).toBeNull();
    expect(layoutTables["sops.library"].source).toBe("sops");
    expect(layoutTables["tasks.dashboard.table"].source).toBe("tasks");
    const widths = { ...emptyLayout(), tables: { "lead-dashboard.by-source": { columns: [{ key: "source", width: 240 }, { key: "count" }] } } };
    expect(layoutProblems("leads.dashboard", widths)).toEqual([]);
    const unknown = { ...emptyLayout(), tables: { "tasks.dashboard.table": { columns: [{ key: "title" }, { key: "nope" }] } } };
    expect(layoutProblems("tasks.dashboard", unknown).map((problem) => problem.message)).toContain('Unknown field "nope".');
  });
});
