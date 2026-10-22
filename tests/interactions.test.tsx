import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { it, expect, vi } from "vitest";
import { DemoProvider } from "../src/app/store";
import { AppShell } from "../src/components/layout/AppShell";
import { ClientList } from "../src/features/clients";
import { InventoryList, InventoryDetail } from "../src/features/inventory";
import { ProposalDrawer } from "../src/features/proposals";
import type { ReactNode } from "react";
async function mount(node: ReactNode, path = "/") {
  const view = render(
    <DemoProvider>
      <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
    </DemoProvider>,
  );
  await waitFor(() =>
    expect(screen.queryByText("Loading workspace…")).not.toBeInTheDocument(),
  );
  return view;
}
it("opens inventory details through a keyboard accessible table link", async () => {
  const user = userEvent.setup();
  await mount(
    <Routes>
      <Route path="/inventory" element={<InventoryList />} />
      <Route path="/inventory/:id" element={<InventoryDetail />} />
    </Routes>,
    "/inventory",
  );
  await user.click(screen.getByRole("button", { name: "INV-001" }));
  expect(
    screen.getByRole("heading", { name: "Organic mixed greens", level: 1 }),
  ).toBeInTheDocument();
  expect(screen.getByText(/Out of Stock · Time/)).toBeInTheDocument();
});
it("updates a proposal and rejects an invalid stage", async () => {
  const user = userEvent.setup();
  await mount(<ProposalDrawer id="FB-2026" onClose={() => {}} />);
  await user.selectOptions(screen.getByLabelText("Proposal stage"), "Signed");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Cannot move Draft to Signed",
  );
  await user.selectOptions(screen.getByLabelText("Proposal stage"), "Sent");
  await waitFor(() =>
    expect(screen.getByLabelText("Proposal stage")).toHaveValue("Sent"),
  );
});
it("navigates using the sidebar and exposes mobile navigation", async () => {
  const user = userEvent.setup();
  await mount(
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<p>Home content</p>} />
        <Route path="/clients" element={<ClientList />} />
      </Route>
    </Routes>,
  );
  await user.click(screen.getByRole("link", { name: "Clients" }));
  expect(screen.getByRole("heading", { name: "Clients" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Open navigation" }));
  expect(
    screen.getByRole("button", { name: "Close mobile navigation" }),
  ).toBeInTheDocument();
});

it("shows a load failure instead of treating missing API data as an empty workspace", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
  await mount(<ClientList />);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Unable to load demo records",
  );
  expect(
    screen.queryByRole("heading", { name: "Clients" }),
  ).not.toBeInTheDocument();
});
