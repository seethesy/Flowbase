import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { CopyProvider, joined, LabelT } from "../src/app/copy";
import { LiveEditControls } from "../src/app/live-edit";
import { queryClient } from "../src/app/queryClient";
import { RoleText } from "../src/components/shared";
import { StatusPill } from "../src/components/ui/status-pill";
import { taskTypeLabels } from "../shared/tasks";

// FLOW-257: labels a screen takes from a constant map are editable live, with
// one key per map value, and render exactly as before with no overrides.

function mount(children: ReactNode, overrides: Record<string, string> = {}) {
  queryClient.clear();
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (String(input) === "/api/copy" && (init?.method ?? "GET") === "GET") return Response.json(overrides);
    return Response.json({ error: { code: "NOT_FOUND", message: "Not found", requestId: "r" } }, { status: 404 });
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CopyProvider canEdit>
        <LiveEditControls />
        {children}
      </CopyProvider>
    </QueryClientProvider>,
  );
}

describe("labels from constant maps", () => {
  it("renders the map's label unchanged outside the providers (AC2)", () => {
    const { container } = render(
      <p>
        <StatusPill status="p_sent" /> <RoleText role="part_time_staff" />{" "}
        {joined([<LabelT id="labels.task-type" value="kitchen">{taskTypeLabels.kitchen}</LabelT>, "", null, "Prep"])}
      </p>,
    );
    expect(container.textContent).toBe(`P Sent Part Time Staff ${taskTypeLabels.kitchen} · Prep`);
  });

  it("keys each label by its map value and shows a saved override", async () => {
    mount(
      <>
        <StatusPill status="closing" />
        <RoleText role="admin" />
      </>,
      { "labels.pipeline-status.closing": "Signing", "labels.role.admin": "Owner" },
    );
    expect(await screen.findByText("Signing")).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
  });

  it("outlines map labels in edit mode so the admin can edit them (AC1)", async () => {
    mount(
      <>
        <StatusPill status="p_creation" />
        <LabelT id="labels.planning-output-kind" value="bar_plan">bar plan</LabelT>
      </>,
    );
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Edit screen text" }));
    expect(screen.getByText("P Creation").closest("[data-copy-id]")?.getAttribute("data-copy-id")).toBe(
      "labels.pipeline-status.p-creation",
    );
    expect(screen.getByText("bar plan").closest("[data-copy-id]")?.getAttribute("data-copy-id")).toBe(
      "labels.planning-output-kind.bar-plan",
    );
  });
});
