import { render, screen, within, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, Link } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { TestAuth } from "./auth-provider";
import { DemoProvider, DemoScreen } from "../src/app/store";
import { AppShell, Breadcrumbs } from "../src/components/layout/AppShell";
import { Dashboard } from "../src/features/dashboard";
import { useDemo } from "../src/app/store";
import { juniper, chairs } from "./e2e/fixtures";

it.each(["/clients", "/inventory", "/venues", "/events", "/leads"])("renders %s without demo requests or quick create", async (path) => {
  render(<TestAuth><DemoProvider><MemoryRouter initialEntries={[path]}><Routes><Route element={<AppShell />}><Route path={path} element={<p>Real screen</p>} /></Route></Routes></MemoryRouter></DemoProvider></TestAuth>);
  expect(screen.getByText("Real screen")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText("Real screen")).toBeInTheDocument());
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/api/demo/"))).toBe(false);
  expect(screen.queryByRole("button", { name: /quick (new|create)/i })).not.toBeInTheDocument();
});

it.each([
  { path: `/clients/${juniper().id}`, record: juniper(), endpoint: `/api/clients/${juniper().id}` },
  { path: `/inventory/${chairs().id}`, record: chairs(), endpoint: `/api/inventory/items/${chairs().id}` },
])("uses the real API name for $path", async ({ path, record, endpoint }) => {
  vi.mocked(fetch).mockImplementation(async (url) => {
    expect(String(url)).toBe(endpoint);
    return Response.json({ ...record, name: "Real record name, absent from fixtures" });
  });
  render(<MemoryRouter initialEntries={[path]}><Breadcrumbs /></MemoryRouter>);
  expect(await within(screen.getByRole("navigation", { name: "Breadcrumb" })).findByText("Real record name, absent from fixtures")).toBeInTheDocument();
});

it("does not request item details for inventory subpages", () => {
  render(<MemoryRouter initialEntries={["/inventory/counts"]}><Breadcrumbs /></MemoryRouter>);
  expect(fetch).not.toHaveBeenCalled();
});

it("labels every fixture dashboard widget as sample data", async () => {
  render(<TestAuth><DemoProvider><MemoryRouter><DemoScreen><Dashboard /></DemoScreen></MemoryRouter></DemoProvider></TestAuth>);
  await screen.findByText("Active Clients (sample data)");
  for (const label of ["Open Proposals", "Proposals Won This Month", "Inventory Alerts", "Recent activity", "Recent proposals", "Proposals by status", "Stock needs attention", "Coming up"]) {
    expect(screen.getByText(`${label} (sample data)`)).toBeInTheDocument();
  }
});

function SampleProposal() {
  const store = useDemo();
  const proposal = store.proposals.records[0];
  return <button onClick={() => void store.proposals.save({ ...proposal, name: "Edited sample proposal" })}>{proposal.name}</button>;
}
it("keeps proposal edits when leaving demo routes and returning", async () => {
  const user = userEvent.setup();
  render(<TestAuth><DemoProvider><MemoryRouter><Link to="/clients">Real records</Link><Link to="/">Sample proposals</Link><Routes><Route path="/" element={<DemoScreen><SampleProposal /></DemoScreen>} /><Route path="/clients" element={<p>Clients screen</p>} /></Routes></MemoryRouter></DemoProvider></TestAuth>);
  await user.click(await screen.findByRole("button"));
  await screen.findByRole("button", { name: "Edited sample proposal" });
  await user.click(screen.getByRole("link", { name: "Real records" }));
  await user.click(screen.getByRole("link", { name: "Sample proposals" }));
  expect(await screen.findByRole("button", { name: "Edited sample proposal" })).toBeInTheDocument();
});
