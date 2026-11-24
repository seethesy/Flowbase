import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { CopyProvider, Plural, T, useCopy } from "../../src/app/copy";
import { LiveEditControls, LiveEditLayer } from "../../src/app/live-edit/live-edit";
import { queryClient } from "../../src/app/queryClient";
import { comparePlaceholders, copySlug, placeholderError, placeholderNames } from "../../shared/copy";

// Admin live text editing (FLOW-240): <T>, plurals, edit mode, save and reset.

function Screen({ onAction }: { onAction: () => void }) {
  const searchPlaceholder = useCopy("test.screen.search.placeholder", "Search leads…");
  return (
    <>
      <LiveEditControls />
      <h1>
        <T id="test.screen.title">Inbox</T>
      </h1>
      <button type="button" onClick={onAction}>
        <T id="test.screen.save-lead">Save lead</T>
      </button>
      <a href="#/elsewhere" onClick={onAction}>
        <T id="test.screen.open">Open lead</T>
      </a>
      <p data-testid="count">
        <T id="test.screen.leads" values={{ count: 3 }}>
          {"{count} leads"}
        </T>
      </p>
      <input aria-label="Search" placeholder={searchPlaceholder} data-copy-id="test.screen.search.placeholder" />
      <LiveEditLayer />
    </>
  );
}

function mount({
  canEdit = true,
  overrides = {} as Record<string, string>,
  orphans = { copy: [], blocks: [] } as { copy: { key: string; text: string }[]; blocks: { pageKey: string; id: string; kind: string }[] },
} = {}) {
  const writes: { method: string; path: string; body: unknown }[] = [];
  let saved = { ...overrides };
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    if (path === "/api/copy" && method === "GET") return Response.json(saved);
    if (path === "/api/copy" && method === "PUT") {
      const body = JSON.parse(String(init?.body)) as { key: string; text: string }[];
      writes.push({ method, path, body });
      for (const edit of body) saved[edit.key] = edit.text;
      return Response.json(saved);
    }
    if (path === "/api/copy/orphans" && method === "GET") return Response.json(orphans);
    if (path === "/api/copy/orphans" && method === "POST") {
      const body = JSON.parse(String(init?.body)) as { action: string; key: string; to?: string };
      writes.push({ method, path, body });
      orphans = { ...orphans, copy: orphans.copy.filter((orphan) => orphan.key !== body.key) };
      return new Response(null, { status: 204 });
    }
    if (path.startsWith("/api/copy/") && method === "DELETE") {
      writes.push({ method, path, body: null });
      const key = decodeURIComponent(path.slice("/api/copy/".length));
      saved = Object.fromEntries(Object.entries(saved).filter(([k]) => k !== key));
      return new Response(null, { status: 204 });
    }
    return Response.json({ error: { code: "NOT_FOUND", message: "Not found", requestId: "r" } }, { status: 404 });
  });
  const onAction = vi.fn();
  const router = createMemoryRouter([
    { path: "/", element: <Screen onAction={onAction} /> },
    { path: "/elsewhere", element: <p>Elsewhere</p> },
  ]);
  render(
    <QueryClientProvider client={queryClient}>
      <CopyProvider canEdit={canEdit}>
        <RouterProvider router={router} />
      </CopyProvider>
    </QueryClientProvider>,
  );
  return { onAction, writes, router };
}
const editor = () => screen.getByRole("dialog", { name: "Edit text" });
const startEditing = () => fireEvent.click(screen.getByRole("button", { name: "Edit screen text" }));

describe("<T> outside the providers", () => {
  it("renders the default, fills placeholders and picks the plural key", () => {
    render(
      <p>
        <T id="test.default.title">Leads</T> <T id="test.default.count" values={{ count: 2, name: <b>Ann</b> }}>{"{count} for {name}"}</T>{" "}
        <Plural id="test.default.rows" count={1} one="{count} row" other="{count} rows" />{" "}
        <Plural id="test.default.items" count={4} one="{count} item" other="{count} items" />
      </p>,
    );
    expect(screen.getByText(/Leads 2 for/)).toHaveTextContent("Leads 2 for Ann 1 row 4 items");
    expect(screen.getByText("Ann").tagName).toBe("B");
  });
});

describe("placeholder helpers", () => {
  it("compares the placeholders of an edit with its default (AC5)", () => {
    expect(placeholderNames("{count} of {total}, {count}")).toEqual(["count", "total"]);
    expect(comparePlaceholders(["count"], "rows")).toEqual({ missing: ["count"], unknown: [] });
    expect(comparePlaceholders(["count"], "{cuont} rows")).toEqual({ missing: ["count"], unknown: ["cuont"] });
    expect(placeholderError(["count"], "rows")).toBe("Keep {count} in the text");
    expect(placeholderError(["count"], "{count} rows")).toBeNull();
    expect(copySlug("Staff & roles…")).toBe("staff-roles");
  });
});

describe("live edit mode", () => {
  it("shows the saved wording as plain text to everyone (AC2, AC7)", async () => {
    mount({ canEdit: false, overrides: { "test.screen.title": "<b>Leads</b><script>alert(1)</script>" } });
    expect(await screen.findByRole("heading", { name: "<b>Leads</b><script>alert(1)</script>" })).toBeInTheDocument();
    expect(document.querySelector("h1 b, h1 script")).toBeNull();
    // Only copy.edit sees the pencil (AC1).
    expect(screen.queryByRole("button", { name: "Edit screen text" })).toBeNull();
  });

  it("edits text inside a button or link without firing it (AC8)", async () => {
    const { onAction, router } = mount();
    startEditing();
    expect(screen.getByText("Inbox").closest(".live-copy")).not.toBeNull();
    fireEvent.click(screen.getByText("Save lead"));
    expect(onAction).not.toHaveBeenCalled();
    expect(within(editor()).getByRole("textbox", { name: "Text" })).toHaveValue("Save lead");
    fireEvent.click(screen.getByText("Open lead"));
    expect(onAction).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe("/");
    expect(within(editor()).getByRole("textbox", { name: "Text" })).toHaveValue("Open lead");
  });

  it("previews an edit, marks it changed and saves the batch (AC2)", async () => {
    const { writes } = mount();
    startEditing();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByText("Inbox"));
    fireEvent.change(within(editor()).getByRole("textbox", { name: "Text" }), { target: { value: "Lead inbox" } });
    expect(screen.getByRole("heading", { name: "Lead inbox" }).querySelector(".live-copy-edited")).not.toBeNull();
    fireEvent.click(screen.getByText("{count} leads".replace("{count}", "3")));
    fireEvent.change(within(editor()).getByRole("textbox", { name: "Text" }), { target: { value: "{count} open leads" } });
    expect(screen.getByTestId("count")).toHaveTextContent("3 open leads");
    fireEvent.click(save);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual([
      { key: "test.screen.title", text: "Lead inbox", placeholders: [] },
      { key: "test.screen.leads", text: "{count} open leads", placeholders: ["count"] },
    ]);
    // Saved: edit mode ends and the new wording stays.
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit screen text" })).toBeInTheDocument());
    expect(await screen.findByRole("heading", { name: "Lead inbox" })).toBeInTheDocument();
  });

  it("blocks Save while a placeholder is missing (AC5)", () => {
    mount();
    startEditing();
    fireEvent.click(screen.getByText("3 leads"));
    fireEvent.change(within(editor()).getByRole("textbox", { name: "Text" }), { target: { value: "open leads" } });
    expect(within(editor()).getByRole("alert")).toHaveTextContent("Keep {count} in the text");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("discards every pending edit on Cancel (AC3)", () => {
    const { writes } = mount();
    startEditing();
    fireEvent.click(screen.getByText("Inbox"));
    fireEvent.change(within(editor()).getByRole("textbox", { name: "Text" }), { target: { value: "Lead inbox" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Edit text" })).toBeNull();
    expect(screen.getByRole("button", { name: "Edit screen text" })).toBeInTheDocument();
    expect(writes).toEqual([]);
  });

  it("resets a saved override to the default on Save (AC6)", async () => {
    const { writes } = mount({ overrides: { "test.screen.title": "Lead inbox" } });
    expect(await screen.findByRole("heading", { name: "Lead inbox" })).toBeInTheDocument();
    startEditing();
    fireEvent.click(screen.getByText("Lead inbox"));
    fireEvent.click(within(editor()).getByRole("button", { name: "Reset to default" }));
    expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes).toEqual([{ method: "DELETE", path: "/api/copy/test.screen.title", body: null }]));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument());
  });

  it("edits an input placeholder from a click on the input", () => {
    mount();
    startEditing();
    fireEvent.click(screen.getByRole("textbox", { name: "Search" }));
    fireEvent.change(within(editor()).getByRole("textbox", { name: "Text" }), { target: { value: "Find a lead…" } });
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveAttribute("placeholder", "Find a lead…");
  });

  it("asks Save, Discard or Stay before leaving with unsaved edits (AC4)", async () => {
    const { router, writes } = mount();
    startEditing();
    fireEvent.click(screen.getByText("Inbox"));
    fireEvent.change(within(editor()).getByRole("textbox", { name: "Text" }), { target: { value: "Lead inbox" } });
    void router.navigate("/elsewhere");
    expect(await screen.findByRole("dialog", { name: "Save your text changes?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Save your text changes?" })).toBeNull());
    expect(router.state.location.pathname).toBe("/");
    expect(screen.getByRole("heading", { name: "Lead inbox" })).toBeInTheDocument();

    void router.navigate("/elsewhere");
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    expect(await screen.findByText("Elsewhere")).toBeInTheDocument();
    expect(writes).toEqual([]);
  });

  it("saves from the leave prompt and goes on (AC4)", async () => {
    const { router, writes } = mount();
    startEditing();
    fireEvent.click(screen.getByText("Inbox"));
    fireEvent.change(within(editor()).getByRole("textbox", { name: "Text" }), { target: { value: "Lead inbox" } });
    void router.navigate("/elsewhere");
    const prompt = await screen.findByRole("dialog", { name: "Save your text changes?" });
    fireEvent.click(within(prompt).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Elsewhere")).toBeInTheDocument();
    expect(writes[0].body).toEqual([{ key: "test.screen.title", text: "Lead inbox", placeholders: [] }]);
  });
});

// FLOW-277: edits that outlive their screen or their default's placeholders.
describe("live edits across releases", () => {
  it("shows the default while an override's placeholders don't match it (AC4)", async () => {
    // Saved for an older default "{total} leads"; the default is now "{count} leads".
    mount({ overrides: { "test.screen.leads": "{total} open leads" } });
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("3 leads"));
    expect(screen.getByTestId("count")).not.toHaveTextContent("{total}");
    startEditing();
    await waitFor(() => expect(screen.getByTestId("count").querySelector(".live-copy-stale")).not.toBeNull());
    const flagged = screen.getByTestId("count").querySelector(".live-copy-stale");
    expect(flagged).toHaveAttribute("title", "Update for new {count}");
    fireEvent.click(screen.getByText("3 leads"));
    // The editor opens on the saved text; Save stays blocked until {count} is back.
    expect(within(editor()).getByRole("textbox", { name: "Text" })).toHaveValue("{total} open leads");
    expect(within(editor()).getByText(/saved for an older version/)).toBeInTheDocument();
    fireEvent.change(within(editor()).getByRole("textbox", { name: "Text" }), { target: { value: "{total} leads!" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(within(editor()).getByRole("textbox", { name: "Text" }), { target: { value: "{count} open leads" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("trims line breaks before saving (AC6)", async () => {
    const { writes } = mount();
    startEditing();
    fireEvent.click(screen.getByText("Save lead"));
    fireEvent.change(within(editor()).getByRole("textbox", { name: "Text" }), { target: { value: "Save Changes\n\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual([{ key: "test.screen.save-lead", text: "Save Changes", placeholders: [] }]);
  });

  it("lists saved edits that no longer match a screen, to delete or move (AC3)", async () => {
    const { writes } = mount({
      orphans: {
        copy: [
          { key: "retired.screen.title", text: "Old title" },
          { key: "retired.screen.note", text: "Old note" },
        ],
        blocks: [],
      },
    });
    startEditing();
    fireEvent.click(await screen.findByRole("button", { name: "2 saved edits no longer match a screen" }));
    const notice = screen.getByRole("region", { name: "Saved edits that no longer match a screen" });
    const first = within(notice).getByText('"Old title"').closest("li")!;
    fireEvent.click(within(first as HTMLElement).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(writes.at(-1)?.body).toEqual({ action: "delete", type: "copy", key: "retired.screen.title" }),
    );
    expect(await screen.findByRole("button", { name: "1 saved edit no longer matches a screen" })).toBeInTheDocument();
    const second = within(notice).getByText('"Old note"').closest("li") as HTMLElement;
    fireEvent.click(within(second).getByRole("button", { name: "Move to key" }));
    fireEvent.change(within(second).getByRole("textbox", { name: "New wording key" }), { target: { value: "test.screen.title" } });
    fireEvent.click(within(second).getByRole("button", { name: "Move" }));
    await waitFor(() =>
      expect(writes.at(-1)?.body).toEqual({ action: "move", type: "copy", key: "retired.screen.note", to: "test.screen.title" }),
    );
    await waitFor(() => expect(screen.queryByRole("region", { name: "Saved edits that no longer match a screen" })).toBeNull());
  });
});
