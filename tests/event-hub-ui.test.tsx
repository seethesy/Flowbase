import { TestAuth } from "./auth-provider";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { EventDetail } from "../src/features/events";
import type { Client, FlowEvent } from "../shared/core-records";
import type { EventHub } from "../shared/event-hub";
import type { HistoryEntry } from "../shared/audit";
import type { TaskSummary } from "../shared/tasks";

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

// The event's tasks and history (FLOW-166), as the API returns them.
const task: TaskSummary = {
  id: "d0000000-0000-4000-8000-000000000001",
  title: "Polish the chafing dishes",
  type: "kitchen",
  status: "in_progress",
  priority: "normal",
  dueAt: "2026-11-13T15:00:00.000Z",
  assignees: [{ id: "a0000000-0000-4000-8000-000000000006", name: "Casey" }],
  overseer: null,
  creator: null,
  eventId,
  eventTitle: "Fall gala",
  clientId: null,
  inventoryItemId: null,
  beoId: null,
  checklistDone: 0,
  checklistTotal: 0,
  completedAt: null,
  completedBy: null,
  createdAt: now,
  updatedAt: now,
};
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
    if (path === `/api/tasks?eventId=${eventId}&includeDone=true`)
      return Response.json([task]);
    if (path === `/api/events/${eventId}/history`) return Response.json(history);
    if (path.startsWith("/api/attachments?")) return Response.json([]);
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

it("offers Change status only when the API allows it (FLOW-56)", async () => {
  mountHub({
    event,
    client: null,
    sections: ["details", "files"],
    canEdit: true,
    canChangeStatus: true,
  });
  expect(
    await screen.findByRole("button", { name: "Change status" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("New status")).not.toHaveValue("closed");
  expect(screen.getByRole("heading", { name: "Status history" })).toBeInTheDocument();
});

it("shows the status history without the form to everyone else", async () => {
  mountHub({
    event,
    client: null,
    sections: ["details", "files"],
    canEdit: true,
    canChangeStatus: false,
  });
  expect(
    await screen.findByRole("heading", { name: "Status history" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Change status" }),
  ).not.toBeInTheDocument();
});

it("loads the tasks and history sections from the API (FLOW-166)", async () => {
  mountHub({
    event,
    client: null,
    sections: ["details", "tasks", "files", "history"],
    canEdit: false,
    canChangeStatus: false,
  });
  expect(await screen.findByRole("link", { name: "Polish the chafing dishes" })).toHaveAttribute(
    "href",
    `/tasks/${task.id}`,
  );
  const tasks = screen.getByRole("list", { name: "Event tasks" });
  expect(tasks).toHaveTextContent("In progress");
  expect(tasks).toHaveTextContent("Due Nov 13, 2026, 10:00 AM · Casey");
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

it("leaves out the tasks and history sections the API doesn't list", async () => {
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
  expect(screen.queryByRole("heading", { name: "Tasks" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "History" })).not.toBeInTheDocument();
});
