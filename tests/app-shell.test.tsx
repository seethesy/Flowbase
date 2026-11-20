import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it } from "vitest";
import type { Role } from "../shared/access";
import { TestAuth } from "./auth-provider";
import { AppShell } from "../src/components/layout/AppShell";

// FLOW-246 (sidebar headings, tabs, collapse edge) and FLOW-247 (header).
beforeEach(() => window.localStorage.clear());

function mount(path = "/", role: Role = "admin") {
  return render(
    <TestAuth role={role}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<p>Home content</p>} />
            <Route path="/leads" element={<p>Leads screen</p>} />
            <Route path="/clients" element={<p>Clients screen</p>} />
            <Route path="/venues" element={<p>Venues screen</p>} />
            <Route path="/calendar" element={<p>Calendar screen</p>} />
            <Route path="/day-of" element={<p>Day-of screen</p>} />
            <Route path="/profile" element={<p>Profile screen</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </TestAuth>,
  );
}
const mainNav = () => screen.getByRole("navigation", { name: "Main" });

it("shows the nine headings, Settings and Help, and no demo note or bottom collapse button", () => {
  mount();
  expect(within(mainNav()).getAllByRole("link").map((link) => link.textContent)).toEqual([
    "Dashboard", "Sales", "Events", "Staffing", "Inventory", "Kitchen", "Marketing", "Documents", "Reports",
  ]);
  const secondary = screen.getByRole("navigation", { name: "Settings and help" });
  expect(within(secondary).getAllByRole("link").map((link) => link.textContent)).toEqual(["Settings", "Help & resources"]);
  expect(screen.queryByText(/A LITTLE LOOK AROUND/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/DEMO · v0\.1/)).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /(Collapse|Expand) sidebar/ })).toHaveLength(1);
});

it("opens a heading's first tab and shows its sub-pages as tabs", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(within(mainNav()).getByRole("link", { name: "Sales" }));
  expect(screen.getByText("Leads screen")).toBeInTheDocument();
  const tabs = screen.getByRole("navigation", { name: "Sales pages" });
  expect(within(tabs).getAllByRole("link").map((link) => link.textContent)).toEqual(["Leads", "Clients", "Proposals", "Venues"]);
  expect(within(tabs).getByRole("link", { name: "Leads" })).toHaveAttribute("aria-current", "page");
  await user.click(within(tabs).getByRole("link", { name: "Clients" }));
  expect(screen.getByText("Clients screen")).toBeInTheDocument();
  // The heading stays highlighted on every tab.
  expect(within(mainNav()).getByRole("link", { name: "Sales" })).toHaveClass("active");
});

it("keeps Day-of under the heading it was opened from", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(within(mainNav()).getByRole("link", { name: "Events" }));
  await user.click(within(screen.getByRole("navigation", { name: "Events pages" })).getByRole("link", { name: "Day-of" }));
  expect(screen.getByText("Day-of screen")).toBeInTheDocument();
  expect(within(mainNav()).getByRole("link", { name: "Events" })).toHaveClass("active");
  expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "Events" })).toBeInTheDocument();
});

it("hides tabs the role can't open", () => {
  mount("/venues", "staff");
  expect(screen.queryByRole("navigation", { name: "Sales pages" })).not.toBeInTheDocument();
  expect(within(mainNav()).getByRole("link", { name: "Sales" })).toHaveAttribute("href", "/venues");
});

it("collapses and expands from the edge bar and remembers it", async () => {
  const user = userEvent.setup();
  window.localStorage.setItem("flowbase.sidebar.collapsed", "false");
  const view = mount();
  const aside = view.container.querySelector("aside.sidebar")!;
  expect(aside).not.toHaveClass("collapsed");
  await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
  expect(aside).toHaveClass("collapsed");
  expect(window.localStorage.getItem("flowbase.sidebar.collapsed")).toBe("true");
  view.unmount();
  mount();
  const edge = screen.getByRole("button", { name: "Expand sidebar" });
  expect(document.querySelector("aside.sidebar")).toHaveClass("collapsed");
  edge.focus();
  await user.keyboard("{Enter}");
  expect(document.querySelector("aside.sidebar")).not.toHaveClass("collapsed");
});

it("has no / key hint or DEMO badge in the header", () => {
  mount();
  const header = document.querySelector("header.top-header")!;
  expect(header.querySelector("kbd")).toBeNull();
  expect(within(header as HTMLElement).queryByText("DEMO")).not.toBeInTheDocument();
});

it("closes the profile menu on an outside click, Escape and navigation", async () => {
  const user = userEvent.setup();
  mount();
  const open = () => user.click(screen.getByRole("button", { name: "Open profile menu" }));
  await open();
  expect(screen.getByRole("link", { name: "Employee profile" })).toBeInTheDocument();
  await user.click(screen.getByText("Home content"));
  expect(screen.queryByRole("link", { name: "Employee profile" })).not.toBeInTheDocument();
  await open();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("link", { name: "Employee profile" })).not.toBeInTheDocument();
  await open();
  // Navigating closes it too: follow the sidebar's profile link by keyboard, so
  // there is no outside click.
  screen.getByRole("link", { name: /Test User/ }).focus();
  await user.keyboard("{Enter}");
  expect(screen.getByText("Profile screen")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole("link", { name: "Employee profile" })).not.toBeInTheDocument());
});

it("links every breadcrumb segment but the last", () => {
  mount("/clients");
  const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
  expect(within(crumbs).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
    ["Workspace", "/"],
    ["Sales", "/leads"],
  ]);
  expect(within(crumbs).getByText("Clients")).toHaveAttribute("aria-current", "page");
});
