import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { TestAuth } from "./auth-provider";
import { Allowed } from "../src/app/permissions";
import { VenueList } from "../src/features/venues";
import { LeadInbox } from "../src/features/leads";

it("hides venue creation while keeping the readable list", async () => {
  vi.mocked(fetch).mockResolvedValue(Response.json([]));
  render(
    <TestAuth role="kitchen_staff" employmentType="part_time">
      <MemoryRouter>
        <VenueList />
      </MemoryRouter>
    </TestAuth>,
  );
  expect(await screen.findByText("0 venues")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "New Venue" }),
  ).not.toBeInTheDocument();
});
it("keeps lead assignment out of the salesperson's inbox", async () => {
  vi.mocked(fetch).mockResolvedValue(
    Response.json([
      {
        id: "39000000-0000-4000-8000-000000000001",
        receivedAt: "2026-10-20T00:00:00.000Z",
        channel: "webhook",
        source: "Bark",
        sourceLeadId: "1",
        sourceLeadUrl: "",
        purchased: false,
        name: "My Lead",
        email: "lead@example.com",
        phone: "2025550101",
        eventDate: null,
        guestCount: null,
        location: "",
        eventType: "",
        budgetCents: null,
        message: "",
        status: "qualified",
        lostReason: "",
        firstRespondedAt: null,
        firstResponseSeconds: null,
        assignedSalespersonId: "38000000-0000-4000-8000-000000000001",
        convertedClientId: null,
        convertedEventId: null,
        mergedIntoLeadId: null,
        needsReview: false,
        archivedAt: null,
        createdAt: "2026-10-20T00:00:00.000Z",
        updatedAt: "2026-10-20T00:00:00.000Z",
      },
    ]),
  );
  render(
    <TestAuth role="salesperson" employmentType="part_time">
      <MemoryRouter>
        <LeadInbox />
      </MemoryRouter>
    </TestAuth>,
  );
  expect(await screen.findByText("My Lead")).toBeInTheDocument();
  expect(
    screen.queryByRole("checkbox", { name: "Select My Lead" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Convert My Lead" }),
  ).toBeInTheDocument();
});
it("applies item-specific permissions to stock controls", () => {
  render(
    <TestAuth role="kitchen_staff" employmentType="part_time">
      <Allowed
        action="inventory.count"
        item={{ kind: "consumable", subtype: "ingredient" }}
      >
        <button>Count ingredients</button>
      </Allowed>
      <Allowed
        action="inventory.count"
        item={{ kind: "consumable", subtype: "bar" }}
      >
        <button>Count bar</button>
      </Allowed>
      <Allowed action="users.manage">
        <button>Manage users</button>
      </Allowed>
    </TestAuth>,
  );
  expect(
    screen.getByRole("button", { name: "Count ingredients" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Count bar" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Manage users" }),
  ).not.toBeInTheDocument();
});
it("hides protected controls without a signed-in profile", () => {
  render(
    <Allowed action="clients.write">
      <button>New Client</button>
    </Allowed>,
  );
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
