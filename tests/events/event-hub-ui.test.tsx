import { TestAuth } from "../auth-provider";
import { choose } from "../dropdown-helpers";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, RouterProvider, createMemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { EventDetail } from "../../src/features/events/event-detail";
import type { Client, FlowEvent } from "../../shared/core-records";
import type { EventHub } from "../../shared/event-hub";
import type { HistoryEntry } from "../../shared/audit";

// The event hub screen (FLOW-57): it shows only the sections the API lists.
const now = "2026-10-22T09:00:00.000Z";
const eventId = "e0000000-0000-4000-8000-000000000001";
const clientId = "c0000000-0000-4000-8000-000000000001";
const event: FlowEvent = {
  id: eventId,
  title: "Fall gala",
  date: "2026-11-14",
  startTime: "18:00",
  endTime: null,
  startsAt: "2026-11-14T23:00:00.000Z",
  endsAt: null,
  client: { id: clientId, name: "Juniper & Co." },
  pocContactId: "c0000000-0000-4000-8000-0000000000a1",
  venue: null,
  address: "100 Garden Way",
  areas: [],
  eventType: "Gala",
  serviceType: "",
  foodServiceStyle: "",
  guestCount: 120,
  servingsCount: null,
  assignedSalespersonId: null,
  productionLeadId: null,
  assistantLeadIds: [],
  dressCode: "",
  arrivalTime: null,
  transportationNotes: "",
  internalNotes: "",
  status: "closed",
  bookedAt: now,
  planningStaleAt: null,
  archivedAt: null,
  createdAt: now,
  updatedAt: now,
};
const client = (email: string | null): Client => ({
  id: clientId,
  name: "Juniper & Co.",
  kind: "organization",
  assignedSalespersonId: null,
  notes: "",
  tags: ["corporate"],
  contacts: [
    {
      id: "c0000000-0000-4000-8000-0000000000a1",
      name: "Olivia Bennett",
      role: "primary_poc",
      email,
      phone: email && "202-555-0101",
      notes: "",
    },
  ],
  possibleDuplicateOf: null,
  archivedAt: null,
  createdAt: now,
  updatedAt: now,
});

// The event's history (FLOW-166), as the API returns it.
const history: HistoryEntry[] = [
  {
    id: "f0000000-0000-4000-8000-000000000002",
    action: "update",
    actorId: "a0000000-0000-4000-8000-000000000001",
    actorName: "Ash",
    at: "2026-10-23T14:30:00.000Z",
    changes: {
      title: { before: "Gala", after: "Fall gala" },
      status: { before: "inquiry", after: "closed" },
      assignedSalespersonId: {
        before: null,
        after: "a0000000-0000-4000-8000-000000000003",
      },
    },
  },
  {
    id: "f0000000-0000-4000-8000-000000000001",
    action: "create",
    actorId: null,
    actorName: null,
    at: now,
    changes: {},
  },
];

function mountHub(hub: EventHub) {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const path = String(input);
    if (path === `/api/events/${eventId}/hub`) return Response.json(hub);
    if (path === `/api/events/${eventId}/history`) return Response.json(history);
    if (path.startsWith("/api/attachments?")) return Response.json([]);
    if (path.startsWith("/api/communications?")) return Response.json([]);
    if (path === `/api/events/${eventId}/status-history`) return Response.json([]);
    throw new Error(`Unexpected request ${path}`);
  });
  render(
    <TestAuth><MemoryRouter initialEntries={[`/events/${eventId}`]}>
      <Routes>
        <Route path="/events/:id" element={<EventDetail />} />
      </Routes>
    </MemoryRouter></TestAuth>,
  );
}

it("loads the details, client and files sections from the API", async () => {
  mountHub({
    event,
    client: client("olivia@juniper.example"),
    sections: ["details", "client", "files"],
    canEdit: true,
    canChangeStatus: false,
  });
  expect(
    await screen.findByRole("heading", { name: "Fall gala", level: 1 }),
  ).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Event details" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Client" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open client" })).toHaveAttribute(
    "href",
    `/clients/${clientId}`,
  );
  expect(screen.getByText("Olivia Bennett (point of contact)")).toBeInTheDocument();
  expect(screen.getByText(/olivia@juniper\.example/)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Event files" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
});

it("shows a part-time user only the sections and fields the API allows", async () => {
  mountHub({
    event,
    client: null,
    sections: ["details", "files"],
    canEdit: false,
    canChangeStatus: false,
  });
  expect(
    await screen.findByRole("heading", { name: "Fall gala", level: 1 }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Client" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Open client" })).not.toBeInTheDocument();
  expect(screen.queryByText("Olivia Bennett", { exact: false })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
});

it("shows contact details as hidden when the API leaves them out", async () => {
  mountHub({
    event,
    client: client(null),
    sections: ["details", "client", "files"],
    canEdit: true,
    canChangeStatus: false,
  });
  expect(await screen.findByText("Olivia Bennett (point of contact)")).toBeInTheDocument();
  expect(screen.getByText(/Primary POC · Hidden · Hidden/)).toBeInTheDocument();
});

// FLOW-350: the status changes in the dropdown under the title, for whoever
// may change it; the Status card is gone.
it("changes the status from the dropdown under the title (FLOW-350 AC2)", async () => {
  const user = userEvent.setup();
  mountHub({
    event,
    client: null,
    sections: ["details", "files"],
    canEdit: true,
    canChangeStatus: true,
  });
  const fetched = vi.mocked(fetch);
  const base = fetched.getMockImplementation()!;
  fetched.mockImplementation(async (input, init) =>
    String(input) === `/api/events/${eventId}/status` && init?.method === "POST"
      ? Response.json({ ...event, status: "preparation" })
      : base(input, init));
  const status = await screen.findByRole("combobox", { name: "Event status" });
  expect(status).toHaveAttribute("data-value", "closed");
  expect(screen.queryByRole("button", { name: "Change status" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Status" })).not.toBeInTheDocument();
  await choose(user, status, "preparation");
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Event status" })).toHaveAttribute("data-value", "preparation"));
  const post = fetched.mock.calls.find(([url, init]) => String(url) === `/api/events/${eventId}/status` && init?.method === "POST");
  expect(JSON.parse(String(post![1]!.body))).toEqual({ status: "preparation", reason: "" });
});

it("shows a plain status pill to everyone else (FLOW-350 AC2)", async () => {
  mountHub({
    event,
    client: null,
    sections: ["details", "files"],
    canEdit: true,
    canChangeStatus: false,
  });
  const heading = (await screen.findByRole("heading", { name: "Fall gala", level: 1 })).closest(".record-heading")!;
  expect(within(heading as HTMLElement).queryByRole("combobox")).not.toBeInTheDocument();
  expect(within(heading as HTMLElement).getByText("Closed")).toBeInTheDocument();
});

it("links the client's name to the client's page outside Edit mode (FLOW-350 AC1)", async () => {
  mountHub({
    event,
    client: client("olivia@juniper.example"),
    sections: ["details", "client", "files"],
    canEdit: true,
    canChangeStatus: false,
  });
  const links = await screen.findAllByRole("link", { name: "Juniper & Co." });
  // Event details and the Client card.
  expect(links).toHaveLength(2);
  for (const link of links) expect(link).toHaveAttribute("href", `/clients/${clientId}`);
});

it("opens Event details, Notes and Client and folds the other cards (FLOW-350 AC3)", async () => {
  const user = userEvent.setup();
  window.localStorage.clear();
  mountHub({
    event,
    client: client(null),
    sections: ["details", "client", "files", "history"],
    canEdit: true,
    canChangeStatus: false,
  });
  for (const title of ["Event details", "Notes", "Client"])
    expect(await screen.findByRole("button", { name: `Fold ${title}` })).toHaveAttribute("aria-expanded", "true");
  for (const title of ["Communication log", "Event files", "History"])
    expect(await screen.findByRole("button", { name: `Unfold ${title}` })).toHaveAttribute("aria-expanded", "false");
  await user.click(screen.getByRole("button", { name: "Unfold Event files" }));
  expect(screen.getByRole("button", { name: "Fold Event files" })).toHaveAttribute("aria-expanded", "true");
});

it("loads the history section from the API (FLOW-166)", async () => {
  window.localStorage.clear();
  mountHub({
    event,
    client: null,
    sections: ["details", "files", "history"],
    canEdit: false,
    canChangeStatus: false,
  });
  // The History card starts folded (FLOW-350).
  await userEvent.setup().click(await screen.findByRole("button", { name: "Unfold History" }));
  const changes = await screen.findByRole("list", { name: "Event history" });
  expect(changes).toHaveTextContent("Changed");
  expect(changes).toHaveTextContent("Ash · Oct 23, 2026, 10:30 AM");
  expect(changes).toHaveTextContent("Title: Gala → Fall gala");
  expect(changes).toHaveTextContent("Status: Inquiry → Closed");
  // Ids mean nothing on screen: the change is named without them.
  expect(changes).toHaveTextContent("Salesperson changed");
  expect(changes).not.toHaveTextContent("a0000000");
  expect(changes).toHaveTextContent("Created");
  expect(changes).toHaveTextContent("Flowbase");
});

it("leaves out the history section when the API doesn't list it", async () => {
  mountHub({
    event,
    client: null,
    sections: ["details", "files"],
    canEdit: false,
    canChangeStatus: false,
  });
  expect(
    await screen.findByRole("heading", { name: "Fall gala", level: 1 }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "History" })).not.toBeInTheDocument();
});

// FLOW-335: Edit turns the event's own fields into inputs in place, in their
// cards, with one Save / Cancel; Status and calculated values stay text.
// A data router: the page guards leaving with unsaved edits (useBlocker).
function mountHubForEdit(hub: EventHub, saved: unknown[] = []) {
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const path = String(input);
    if (path === `/api/events/${eventId}/hub`) return Response.json(hub);
    if (path === `/api/events/${eventId}` && init?.method === "PUT") {
      saved.push(JSON.parse(String(init.body)));
      return Response.json({ ...hub.event, ...(JSON.parse(String(init.body)) as object), updatedAt: "2026-10-22T10:00:00.000Z" });
    }
    if (path.startsWith("/api/clients?")) return Response.json([hub.client]);
    if (path.startsWith("/api/venues")) return Response.json([]);
    if (path.startsWith("/api/settings")) return Response.json({}, { status: 404 });
    if (path.startsWith("/api/attachments?")) return Response.json([]);
    if (path.startsWith("/api/communications?")) return Response.json([]);
    if (path === `/api/events/${eventId}/status-history`) return Response.json([]);
    return Response.json([]);
  });
  const router = createMemoryRouter([{ path: "/events/:id", element: <EventDetail /> }], { initialEntries: [`/events/${eventId}`] });
  render(<TestAuth><RouterProvider router={router} /></TestAuth>);
}

it("edits the event's own fields in place and keeps Status and calculated values read-only (FLOW-335)", async () => {
  const user = userEvent.setup();
  const saved: unknown[] = [];
  mountHubForEdit({
    event: { ...event, planningStaleAt: now, transportationNotes: "Van at 3" },
    client: client("olivia@juniper.example"),
    sections: ["details", "client"],
    canEdit: true,
    canChangeStatus: false,
  }, saved);
  await user.click(await screen.findByRole("button", { name: "Edit" }));
  // No drawer: the inputs are on the page, in the details and notes cards.
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Fall gala");
  expect(screen.getByLabelText("Date")).toHaveValue("2026-11-14");
  expect(screen.getByLabelText("Start time")).toHaveValue("18:00");
  expect(screen.getByRole("textbox", { name: "Address" })).toHaveValue("100 Garden Way");
  expect(screen.getByRole("spinbutton", { name: "Guests" })).toHaveValue(120);
  expect(screen.getByRole("combobox", { name: "Client" })).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Venue" })).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Transportation" })).toHaveValue("Van at 3");
  // AC2: Status (its own panel) and Planning outputs (calculated) have no input.
  const details = screen.getByRole("heading", { name: "Event details" }).closest("section")!;
  const status = within(details).getByText("Status").closest("[data-readonly]");
  expect(status).not.toBeNull();
  expect(within(status as HTMLElement).queryByRole("combobox")).toBeNull();
  expect(within(details).getByText("Planning outputs").closest("[data-readonly]")).not.toBeNull();

  // AC3: Cancel puts every card back as it was, without saving.
  await user.clear(screen.getByRole("textbox", { name: "Address" }));
  await user.type(screen.getByRole("textbox", { name: "Address" }), "1 Elm St");
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("textbox", { name: "Address" })).not.toBeInTheDocument();
  expect(screen.getByText("100 Garden Way")).toBeInTheDocument();
  expect(saved).toEqual([]);

  // AC1: Save sends the changes with the version it loaded.
  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.clear(screen.getByRole("spinbutton", { name: "Guests" }));
  await user.type(screen.getByRole("spinbutton", { name: "Guests" }), "150");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(saved).toHaveLength(1));
  expect(saved[0]).toMatchObject({ guestCount: 150, title: "Fall gala", address: "100 Garden Way", updatedAt: now });
  expect(saved[0]).not.toHaveProperty("areas");
});

it("offers no Edit to a user the API says can't edit (FLOW-335 AC4)", async () => {
  mountHubForEdit({ event, client: client("olivia@juniper.example"), sections: ["details"], canEdit: false, canChangeStatus: false });
  expect(await screen.findByRole("heading", { name: "Fall gala", level: 1 })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();
});
