import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { ClientForm, ClientList } from "../src/features/clients";
import { EventForm } from "../src/features/events";
import type { Client } from "../shared/core-records";

const requestId = "81449b27-3ebd-41b3-bdad-58f725d7f319";
const now = "2026-10-22T09:00:00.000Z";
const client = (overrides: Partial<Client> = {}): Client => ({
  id: "c0000000-0000-4000-8000-000000000001",
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
      email: "olivia@juniper.example",
      phone: "202-555-0101",
      notes: "",
    },
  ],
  possibleDuplicateOf: null,
  archivedAt: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});
type Handler = (init?: RequestInit) => Response | Promise<Response>;
// Routes fetch calls by "METHOD /path"; anything unexpected fails the test.
const mockApi = (routes: Record<string, Handler>) =>
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const key = `${init?.method ?? "GET"} ${String(input)}`;
    const handler = routes[key];
    if (!handler) throw new Error(`Unexpected request ${key}`);
    return handler(init);
  });
const bodyOf = (init?: RequestInit) => JSON.parse(String(init?.body));
const mount = (node: ReactNode) =>
  render(<MemoryRouter>{node}</MemoryRouter>);

it("lists clients from the API and hides contact details it isn't given", async () => {
  mockApi({
    "GET /api/clients": () =>
      Response.json([
        client(),
        client({
          id: "c0000000-0000-4000-8000-000000000002",
          name: "The Glasshouse",
          contacts: [
            {
              id: "c0000000-0000-4000-8000-0000000000a2",
              name: "Mara",
              role: "primary_poc",
              email: null,
              phone: null,
              notes: "",
            },
          ],
        }),
      ]),
  });
  const user = userEvent.setup();
  mount(<ClientList />);
  expect(await screen.findByText("The Glasshouse")).toBeInTheDocument();
  expect(screen.getAllByText("Hidden")).toHaveLength(2);
  await user.type(
    screen.getByRole("textbox", { name: "Search clients or contacts…" }),
    "Olivia",
  );
  expect(screen.queryByText("The Glasshouse")).not.toBeInTheDocument();
  expect(screen.getByText("Juniper & Co.")).toBeInTheDocument();
});

it("shows the API's message and reference when the list can't load", async () => {
  mockApi({
    "GET /api/clients": () =>
      Response.json(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "Sign-in is required.",
            requestId,
          },
        },
        { status: 401 },
      ),
  });
  mount(<ClientList />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    `Sign-in is required. Reference: ${requestId}`,
  );
  expect(screen.getByRole("heading", { name: "Clients" })).toBeInTheDocument();
});

it("warns about a possible duplicate and creates the client only when confirmed", async () => {
  const posts: unknown[] = [];
  mockApi({
    "POST /api/clients": (init) => {
      const body = bodyOf(init);
      posts.push(body);
      return body.allowDuplicate
        ? Response.json(client({ name: body.name }), { status: 201 })
        : Response.json(
            {
              error: {
                code: "POSSIBLE_DUPLICATE",
                message: "A client with this email or phone already exists.",
                requestId,
              },
              duplicates: [{ id: client().id, name: "Juniper & Co." }],
            },
            { status: 409 },
          );
    },
  });
  const onSaved = vi.fn();
  const user = userEvent.setup();
  mount(<ClientForm onClose={() => {}} onSaved={onSaved} />);
  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Save client" }));
  expect(within(dialog).getByRole("alert")).toHaveTextContent(
    "Name is required",
  );
  await user.type(within(dialog).getByLabelText("Name *"), "Juniper Events");
  await user.type(
    within(dialog).getByLabelText("Contact name *"),
    "Olivia Bennett",
  );
  await user.type(
    within(dialog).getByLabelText("Email"),
    "olivia@juniper.example",
  );
  await user.click(within(dialog).getByRole("button", { name: "Save client" }));
  const warning = await within(dialog).findByRole("alert");
  expect(warning).toHaveTextContent("already exists");
  expect(
    within(warning).getByRole("link", { name: "Juniper & Co." }),
  ).toBeInTheDocument();
  expect(onSaved).not.toHaveBeenCalled();
  await user.click(
    within(dialog).getByRole("button", { name: "Create anyway" }),
  );
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(posts).toHaveLength(2);
  expect(posts[1]).toMatchObject({
    name: "Juniper Events",
    allowDuplicate: true,
    contacts: [
      {
        name: "Olivia Bennett",
        role: "primary_poc",
        email: "olivia@juniper.example",
      },
    ],
  });
});

it("leaves hidden contact details out of an edit so the API keeps them", async () => {
  let sent: { contacts: Record<string, unknown>[] } | undefined;
  const hiddenClient = client({
    contacts: [{ ...client().contacts[0], email: null, phone: null }],
  });
  mockApi({
    [`PUT /api/clients/${hiddenClient.id}`]: (init) => {
      sent = bodyOf(init);
      return Response.json(hiddenClient);
    },
  });
  const user = userEvent.setup();
  mount(
    <ClientForm client={hiddenClient} onClose={() => {}} onSaved={() => {}} />,
  );
  expect(
    screen.getByText("Email and phone are visible to full-time staff only."),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save client" }));
  await waitFor(() => expect(sent).toBeDefined());
  expect(sent?.contacts[0]).not.toHaveProperty("email");
  expect(sent?.contacts[0]).not.toHaveProperty("phone");
});

it("creates an event from just a title, date, time and client", async () => {
  let sent: Record<string, unknown> | undefined;
  mockApi({
    "GET /api/clients": () => Response.json([client()]),
    "GET /api/venues": () => Response.json([]),
    "POST /api/events": (init) => {
      sent = bodyOf(init);
      return new Response(null, { status: 500 });
    },
  });
  const user = userEvent.setup();
  mount(<EventForm onClose={() => {}} onSaved={() => {}} />);
  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Save event" }));
  expect(within(dialog).getByRole("alert")).toHaveTextContent(
    "Title, date, start time and client are required.",
  );
  await user.type(within(dialog).getByLabelText("Title *"), "Fall gala");
  await user.type(within(dialog).getByLabelText("Date *"), "2026-11-14");
  await user.type(within(dialog).getByLabelText("Start time *"), "18:00");
  await within(dialog).findByRole("option", { name: "Juniper & Co." });
  await user.selectOptions(
    within(dialog).getByLabelText("Client *"),
    "Juniper & Co.",
  );
  await user.click(within(dialog).getByRole("button", { name: "Save event" }));
  await waitFor(() => expect(sent).toBeDefined());
  expect(sent).toMatchObject({
    title: "Fall gala",
    date: "2026-11-14",
    startTime: "18:00",
    clientId: client().id,
    guestCount: null,
  });
  // Untouched areas are left to the API, which copies the venue's.
  expect(sent).not.toHaveProperty("areas");
});
