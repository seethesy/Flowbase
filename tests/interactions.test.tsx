import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import { DemoProvider } from "../src/app/store";
import { AppShell } from "../src/components/layout/AppShell";
import { ClientList, ClientDetail } from "../src/features/clients";
import { InventoryList, InventoryDetail } from "../src/features/inventory";
import { ProposalDrawer } from "../src/features/proposals";
import { RecordForm } from "../src/features/forms";
import { useState, type ReactNode } from "react";
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
describe("client workflow", () => {
  it("searches by client and filters by status", async () => {
    const user = userEvent.setup();
    await mount(<ClientList />);
    await user.type(
      screen.getByRole("textbox", { name: "Search clients or contacts…" }),
      "Juniper",
    );
    expect(
      screen.getByRole("button", { name: "JC Juniper & Co." }),
    ).toBeInTheDocument();
    expect(screen.queryByText("The Glasshouse")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Statuses"), "Active");
    expect(screen.getByText("No records found")).toBeInTheDocument();
  });
  it("switches record detail tabs and adds a timestamped note", async () => {
    const user = userEvent.setup();
    await mount(
      <Routes>
        <Route path="/clients/:id" element={<ClientDetail />} />
      </Routes>,
      "/clients/cli-1",
    );
    await user.click(screen.getByRole("tab", { name: "Notes" }));
    await user.type(
      screen.getByLabelText("Add a note"),
      "Vegan menu requested",
    );
    await user.click(screen.getByRole("button", { name: "Add note" }));
    expect(await screen.findByText("Vegan menu requested")).toBeInTheDocument();
    expect(screen.getByText(/Alex Chen ·/)).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Files" }));
    expect(screen.getByText("Event brief.pdf")).toBeInTheDocument();
  });
});
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
function FormHarness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <ClientList />
      {open && <RecordForm kind="client" onClose={() => setOpen(false)} />}
    </>
  );
}
it("validates, saves, and closes a client dialog", async () => {
  const user = userEvent.setup();
  await mount(<FormHarness />);
  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Save client" }));
  expect(within(dialog).getByRole("alert")).toHaveTextContent(
    "Name is required",
  );
  await user.type(
    within(dialog).getByLabelText("Name *"),
    "Test Catering Client",
  );
  await user.type(
    within(dialog).getByLabelText("Main contact *"),
    "Avery Demo",
  );
  await user.type(
    within(dialog).getByLabelText("Email *"),
    "avery@demo.example",
  );
  await user.click(within(dialog).getByRole("button", { name: "Save client" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(screen.getByText("Test Catering Client")).toBeInTheDocument();
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

it("keeps a rejected save open and shows its request reference", async () => {
  const user = userEvent.setup();
  await mount(<FormHarness />);
  const dialog = screen.getByRole("dialog");
  await user.type(within(dialog).getByLabelText("Name *"), "Rejected client");
  await user.type(within(dialog).getByLabelText("Main contact *"), "Avery");
  await user.type(
    within(dialog).getByLabelText("Email *"),
    "avery@demo.example",
  );
  const requestId = "81449b27-3ebd-41b3-bdad-58f725d7f319";
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json(
      {
        error: { code: "INTERNAL_ERROR", message: "Please retry.", requestId },
      },
      { status: 500 },
    ),
  );
  await user.click(within(dialog).getByRole("button", { name: "Save client" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(requestId);
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "RC Rejected client" }),
  ).not.toBeInTheDocument();
});
