import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect } from "vitest";
import { DemoProvider } from "../src/app/store";
import { AppShell } from "../src/components/layout/AppShell";
import { CustomerList, CustomerDetail } from "../src/features/crm";
import { InventoryList, InventoryDetail } from "../src/features/inventory";
import { ContractDrawer } from "../src/features/contracts";
import { RecordForm } from "../src/features/forms";
import { useState, type ReactNode } from "react";
async function mount(node: ReactNode, path = "/") {
  const view = render(
    <DemoProvider>
      <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
    </DemoProvider>,
  );
}
describe("customer workflow", () => {
  it("searches by customer and filters by status", async () => {
    const user = userEvent.setup();
    await mount(<CustomerList />);
    await user.type(
      screen.getByRole("textbox", { name: "Search customers or contacts…" }),
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
        <Route path="/crm/:id" element={<CustomerDetail />} />
      </Routes>,
      "/crm/cus-1",
    );
    await user.click(screen.getByRole("tab", { name: "Notes" }));
    await user.type(
      screen.getByLabelText("Add a note"),
      "Vegan menu requested",
    );
    await user.click(screen.getByRole("button", { name: "Add note" }));
    expect(screen.getByText("Vegan menu requested")).toBeInTheDocument();
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
it("updates a contract and rejects an invalid stage", async () => {
  const user = userEvent.setup();
  await mount(<ContractDrawer id="FB-2026" onClose={() => {}} />);
  await user.selectOptions(screen.getByLabelText("Contract stage"), "Signed");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Cannot move Draft to Signed",
  );
  await user.selectOptions(screen.getByLabelText("Contract stage"), "Sent");
  expect(screen.getByLabelText("Contract stage")).toHaveValue("Sent");
});
function FormHarness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <CustomerList />
      {open && <RecordForm kind="customer" onClose={() => setOpen(false)} />}
    </>
  );
}
it("validates, saves, and closes a customer dialog", async () => {
  const user = userEvent.setup();
  await mount(<FormHarness />);
  const dialog = screen.getByRole("dialog");
  await user.click(
    within(dialog).getByRole("button", { name: "Save customer" }),
  );
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
  await user.click(
    within(dialog).getByRole("button", { name: "Save customer" }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByText("Test Catering Client")).toBeInTheDocument();
});
it("navigates using the sidebar and exposes mobile navigation", async () => {
  const user = userEvent.setup();
  await mount(
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<p>Home content</p>} />
        <Route path="/crm" element={<CustomerList />} />
      </Route>
    </Routes>,
  );
  await user.click(screen.getByRole("link", { name: "CRM" }));
  expect(
    screen.getByRole("heading", { name: "Customers" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Open navigation" }));
  expect(
    screen.getByRole("button", { name: "Close mobile navigation" }),
  ).toBeInTheDocument();
});
