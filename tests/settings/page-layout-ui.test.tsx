import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CopyProvider, T } from "../../src/app/copy";
import { LiveEditControls } from "../../src/app/live-edit/live-edit";
import { Block, PageGrid } from "../../src/app/live-edit/page-grid";
import { queryClient } from "../../src/app/queryClient";
import { DataTable } from "../../src/components/shared";
import { layoutTables } from "../../shared/layout";
import type { Role } from "../../shared/access";
import { TestAuth } from "../auth-provider";

// Page layouts (FLOW-253/254): pages render as before with nothing saved; a
// saved layout places, hides and colors blocks; the Columns editor saves a
// table's columns through the same Save as text edits.

type Venue = { id: string; name: string; address: string; jurisdiction: string | null; areas: { name: string }[]; updatedAt: string };
const venues: Venue[] = [
  { id: "v1", name: "Harbor Hall", address: "1 Pier Rd", jurisdiction: "MD", areas: [], updatedAt: "2026-11-01T12:00:00Z" },
  { id: "v2", name: "Garden Loft", address: "9 Elm St", jurisdiction: null, areas: [], updatedAt: "2026-11-02T12:00:00Z" },
];
const columns: ColumnDef<Venue, unknown>[] = [
  { accessorKey: "name", header: "Venue" },
  { accessorKey: "address", header: "Address" },
];

let saved: Record<string, unknown> = {};
const writes: { method: string; path: string; body: unknown }[] = [];

function mount(page: ReactNode, { role = "admin" }: { role?: Role } = {}) {
  render(
    <QueryClientProvider client={queryClient}>
      <TestAuth role={role}>
        <CopyProvider canEdit={role === "admin"} canEditLayout={role === "admin"}>
          <RouterProvider
            router={createMemoryRouter([
              {
                path: "/",
                element: (
                  <>
                    <LiveEditControls />
                    {page}
                  </>
                ),
              },
            ])}
          />
        </CopyProvider>
      </TestAuth>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  queryClient.clear();
  saved = {};
  writes.length = 0;
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    if (path === "/api/copy") return Response.json({});
    const match = path.match(/^\/api\/layout\/(.+)$/);
    if (match) {
      const key = decodeURIComponent(match[1]);
      if (method === "GET") return Response.json(saved[key] ?? null);
      if (method === "PUT") {
        const body = JSON.parse(String(init?.body));
        writes.push({ method, path, body });
        saved[key] = { pageKey: key, layout: body, updatedAt: "2026-11-20T12:00:00.000Z", updatedBy: null };
        return Response.json(saved[key]);
      }
      if (method === "DELETE") {
        writes.push({ method, path, body: null });
        delete saved[key];
        return new Response(null, { status: 204 });
      }
    }
    return Response.json({ error: { code: "NOT_FOUND", message: "Not found", requestId: "r" } }, { status: 404 });
  });
});

const Page = () => (
  <div className="detail-grid" data-testid="page">
    <PageGrid pageKey="test.page">
      <Block id="first" name="First">
        <section className="panel">
          <T id="test.page.first">First block</T>
        </section>
      </Block>
      <Block id="second" name="Second">
        <section className="panel">
          <T id="test.page.second">Second block</T>
        </section>
      </Block>
    </PageGrid>
  </div>
);

describe("PageGrid", () => {
  it("renders the page exactly as its code does with no saved layout", async () => {
    mount(<Page />);
    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input) === "/api/layout/test.page")).toBe(true),
    );
    const page = screen.getByTestId("page");
    expect(page.querySelector(".page-grid")).toBeNull();
    expect([...page.children].map((child) => child.textContent)).toEqual(["First block", "Second block"]);
  });

  it("places, hides and colors blocks from the saved layout, in reading order", async () => {
    saved["test.page"] = {
      pageKey: "test.page",
      updatedAt: "2026-11-20T12:00:00.000Z",
      updatedBy: null,
      layout: {
        version: 1,
        blocks: [
          { kind: "builtin", id: "first", x: 0, y: 6, w: 12, h: 4, hidden: true },
          { kind: "builtin", id: "second", x: 6, y: 0, w: 6, h: 4, style: { background: "#edf3ee" } },
          { kind: "text", id: "heading-1", variant: "heading", text: "This week", x: 0, y: 0, w: 6, h: 2 },
        ],
        tables: {},
        fieldBoxes: {},
      },
    };
    mount(<Page />);
    const heading = await screen.findByRole("heading", { name: "This week" });
    const grid = heading.closest(".page-grid")!;
    expect(screen.queryByText("First block")).toBeNull();
    const blocks = [...grid.querySelectorAll<HTMLElement>(".page-grid-block")];
    expect(blocks.map((block) => block.dataset.blockId)).toEqual(["heading-1", "second"]);
    expect(blocks[1].style.getPropertyValue("--layout-bg")).toBe("#edf3ee");
    expect(blocks[1].style.gridColumn).toBe("7 / span 6");
  });

  it("shows no layout chrome to a role without layout.edit", async () => {
    mount(<Page />, { role: "salesperson" });
    await screen.findByText("First block");
    expect(screen.queryByRole("button", { name: "Edit screen text" })).toBeNull();
    expect(screen.queryByRole("toolbar", { name: "Page layout" })).toBeNull();
  });
});

describe("Columns (FLOW-254)", () => {
  const Table = () => (
    <PageGrid pageKey="venues.list">
      <Block id="list" name="List">
        <DataTable copyKey="venues.venue-list" data={venues} columns={columns} exportName="venues" />
      </Block>
    </PageGrid>
  );

  it("is a layout-aware table", () => {
    expect(layoutTables["venues.venue-list"].source).toBe("venues");
  });

  it("shows the saved columns in order, adding a registry column and sorting only sortable fields", async () => {
    saved["venues.list"] = {
      pageKey: "venues.list",
      updatedAt: "2026-11-20T12:00:00.000Z",
      updatedBy: null,
      layout: {
        version: 1,
        blocks: [],
        tables: { "venues.venue-list": { columns: [{ key: "jurisdiction" }, { key: "name" }] } },
        fieldBoxes: {},
      },
    };
    mount(<Table />);
    await screen.findByText("MD");
    const headers = screen.getAllByRole("columnheader").map((header) => header.textContent?.replace(/[↑↓\s]+$/, ""));
    expect(headers).toEqual(["Jurisdiction", "Venue"]);
    expect(screen.queryByText("1 Pier Rd")).toBeNull();
  });

  it("hides a column in edit mode and saves it with the page's Save", async () => {
    mount(<Table />);
    await screen.findByText("1 Pier Rd");
    fireEvent.click(screen.getByRole("button", { name: "Edit screen text" }));
    fireEvent.click(await screen.findByRole("button", { name: /Columns/ }));
    const picker = screen.getByRole("dialog", { name: "Columns" });
    // Name is required: it can't be hidden.
    expect(within(picker).getByRole("checkbox", { name: "Show Venue" })).toBeDisabled();
    fireEvent.click(within(picker).getByRole("checkbox", { name: "Show Address" }));
    await waitFor(() => expect(screen.queryByText("1 Pier Rd")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({
      method: "PUT",
      path: "/api/layout/venues.list",
      body: { version: 1, tables: { "venues.venue-list": { columns: [{ key: "name" }] } } },
    });
  });

  it("Reset columns brings back the code's columns", async () => {
    saved["venues.list"] = {
      pageKey: "venues.list",
      updatedAt: "2026-11-20T12:00:00.000Z",
      updatedBy: null,
      layout: { version: 1, blocks: [], tables: { "venues.venue-list": { columns: [{ key: "name" }] } }, fieldBoxes: {} },
    };
    mount(<Table />);
    await screen.findByText("Harbor Hall");
    // The saved column set arrives with the layout.
    await waitFor(() => expect(screen.queryByText("1 Pier Rd")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Edit screen text" }));
    fireEvent.click(await screen.findByRole("button", { name: /Columns/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Columns" })).getByRole("button", { name: "Reset columns" }));
    await screen.findByText("1 Pier Rd");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect((writes[0].body as { tables: object }).tables).toEqual({});
  });
});
