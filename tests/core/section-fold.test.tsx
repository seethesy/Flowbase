import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, expect, it } from "vitest";
import { TestAuth } from "../auth-provider";
import { Section } from "../../src/components/shared";

// Folding cards (FLOW-347): the arrow at a card's top right, its states and
// what assistive technology hears.

const mount = (node: ReactNode) => render(<TestAuth>{node}</TestAuth>);

beforeEach(() => window.localStorage.clear());

it("folds a card to its title bar and back (AC1)", async () => {
  const user = userEvent.setup();
  mount(<Section title="Company profile" collapsible><p>Company name</p></Section>);
  const arrow = screen.getByRole("button", { name: "Fold Company profile" });
  expect(arrow).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("Company name")).toBeVisible();
  await user.click(arrow);
  expect(screen.getByRole("heading", { name: "Company profile" })).toBeVisible();
  expect(screen.getByText("Company name")).not.toBeVisible();
  const unfold = screen.getByRole("button", { name: "Unfold Company profile" });
  expect(unfold).toHaveAttribute("aria-expanded", "false");
  await user.click(unfold);
  expect(screen.getByText("Company name")).toBeVisible();
});

it("toggles from the keyboard and names the body it controls (AC2)", async () => {
  const user = userEvent.setup();
  mount(<Section title="Lists" collapsible><p>Event types</p></Section>);
  await user.tab();
  const arrow = screen.getByRole("button", { name: "Fold Lists" });
  expect(arrow).toHaveFocus();
  expect(document.getElementById(arrow.getAttribute("aria-controls")!)).toContainElement(screen.getByText("Event types"));
  await user.keyboard("{Enter}");
  expect(arrow).toHaveAttribute("aria-expanded", "false");
  await user.keyboard(" ");
  expect(arrow).toHaveAttribute("aria-expanded", "true");
});

it("starts closed when the screen says so (AC3)", () => {
  mount(<Section title="Payments" collapsible defaultOpen={false}><p>Deposit</p></Section>);
  expect(screen.getByRole("button", { name: "Unfold Payments" })).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByText("Deposit")).not.toBeVisible();
});

it("remembers a fold on this device for the next visit (A1)", async () => {
  const user = userEvent.setup();
  const view = mount(<Section title="Defaults" collapsible><p>Tax rate</p></Section>);
  await user.click(screen.getByRole("button", { name: "Fold Defaults" }));
  view.unmount();
  mount(<Section title="Defaults" collapsible><p>Tax rate</p></Section>);
  expect(screen.getByText("Tax rate")).not.toBeVisible();
});

it("has no arrow unless the card is collapsible", () => {
  mount(<Section title="History"><p>Recent</p></Section>);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.getByText("Recent")).toBeVisible();
});
