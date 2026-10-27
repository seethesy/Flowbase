import { TestAuth } from "./auth-provider";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { it, expect, vi } from "vitest";
import { DemoProvider, DemoScreen } from "../src/app/store";
import { AppShell } from "../src/components/layout/AppShell";
import { ClientList } from "../src/features/clients";
import { ProposalDrawer } from "../src/features/proposals";
import type { ReactNode } from "react";
async function mount(node: ReactNode, path = "/") {
  const view = render(
    <TestAuth>
      <DemoProvider>
        <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
      </DemoProvider>
    </TestAuth>,
  );
  await waitFor(() =>
    expect(screen.queryByText("Loading workspace…")).not.toBeInTheDocument(),
  );
  return view;
}
it("updates a proposal and rejects an invalid stage", async () => {
  const user = userEvent.setup();
  await mount(<DemoScreen><ProposalDrawer id="FB-2026" onClose={() => {}} /></DemoScreen>);
  await screen.findByLabelText("Proposal stage");
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
  expect(await screen.findByRole("alert")).toHaveTextContent("503");
  expect(screen.getByRole("heading", { name: "Clients" })).toBeInTheDocument();
});
