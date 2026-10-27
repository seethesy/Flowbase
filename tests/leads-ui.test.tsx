import { TestAuth } from "./auth-provider";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { ConvertLeadForm, LeadInbox } from "../src/features/leads";
import type { Client } from "../shared/core-records";
import type { Lead } from "../shared/leads";

const requestId = "81449b27-3ebd-41b3-bdad-58f725d7f319";
const now = "2026-10-22T09:00:00.000Z";
const lead = (overrides: Partial<Lead> = {}): Lead => ({
  id: "d0000000-0000-4000-8000-000000000001",
  receivedAt: now,
  channel: "webhook",
  source: "Bark",
  sourceLeadId: "bark-1",
  sourceLeadUrl: "",
  purchased: false,
  name: "Maya Ortiz",
  email: "maya@example.com",
  phone: "202-555-0142",
  eventDate: "2026-12-05",
  guestCount: 60,
  location: "Brooklyn, NY",
  eventType: "Wedding",
  budgetCents: null,
  message: "",
  status: "qualified",
  lostReason: "",
  firstRespondedAt: null,
  firstResponseSeconds: null,
  assignedSalespersonId: null,
  convertedClientId: null,
  convertedEventId: null,
  mergedIntoLeadId: null,
  needsReview: false,
  archivedAt: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});
const juniper: Client = {
  id: "c0000000-0000-4000-8000-000000000001",
  name: "Juniper & Co.",
  kind: "organization",
  assignedSalespersonId: null,
  notes: "",
  tags: [],
  contacts: [],
  possibleDuplicateOf: null,
  archivedAt: null,
  createdAt: now,
  updatedAt: now,
};
type Handler = (init?: RequestInit) => Response | Promise<Response>;
const mockApi = (routes: Record<string, Handler>) =>
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const key = `${init?.method ?? "GET"} ${String(input)}`;
    const handler = routes[key];
    if (!handler) throw new Error(`Unexpected request ${key}`);
    return handler(init);
  });
const mount = (node: ReactNode) =>
  render(
    <TestAuth>
      <MemoryRouter>{node}</MemoryRouter>
    </TestAuth>,
  );

it("lists leads, flags the ones that need review and filters by search", async () => {
  mockApi({
    "GET /api/leads": () =>
      Response.json([
        lead({ status: "new" }),
        lead({
          id: "d0000000-0000-4000-8000-000000000002",
          name: "Noah Kim",
          eventDate: null,
          needsReview: true,
          status: "new",
        }),
      ]),
  });
  const user = userEvent.setup();
  mount(<LeadInbox />);
  expect(await screen.findByText("Noah Kim")).toBeInTheDocument();
  expect(screen.getByText("Maya Ortiz")).toBeInTheDocument();
  expect(screen.getAllByText("Needs review")).toHaveLength(2); // tab + badge
  await user.type(
    screen.getByRole("textbox", { name: "Search name, email or phone…" }),
    "noah",
  );
  expect(screen.queryByText("Maya Ortiz")).not.toBeInTheDocument();
});

it("asks for the view's filters from the API", async () => {
  const requested: string[] = [];
  vi.mocked(fetch).mockImplementation(async (input) => {
    requested.push(String(input));
    return Response.json([]);
  });
  const user = userEvent.setup();
  mount(<LeadInbox />);
  await screen.findByText("0 leads");
  await user.click(screen.getByRole("tab", { name: "Triage" }));
  await user.click(screen.getByRole("tab", { name: "Needs review" }));
  expect(requested).toEqual([
    "/api/leads",
    "/api/leads?triage=true",
    "/api/leads?needsReview=true",
  ]);
});

it("warns about a matching client on convert and offers to link instead", async () => {
  const posts: unknown[] = [];
  const converted = lead({
    status: "converted",
    convertedClientId: juniper.id,
    convertedEventId: "e0000000-0000-4000-8000-000000000001",
  });
  mockApi({
    "GET /api/clients": () => Response.json([juniper]),
    "POST /api/leads/d0000000-0000-4000-8000-000000000001/convert": (init) => {
      const body = JSON.parse(String(init?.body));
      posts.push(body);
      return body.client.mode === "link"
        ? Response.json({
            lead: converted,
            client: { id: juniper.id, name: juniper.name },
            event: {
              id: "e0000000-0000-4000-8000-000000000001",
              title: "Juniper & Co. — Wedding",
            },
          })
        : Response.json(
            {
              error: {
                code: "POSSIBLE_DUPLICATE",
                message: "A client with this email or phone already exists.",
                requestId,
              },
              duplicates: [{ id: juniper.id, name: juniper.name }],
            },
            { status: 409 },
          );
    },
  });
  const onConverted = vi.fn();
  const user = userEvent.setup();
  mount(
    <ConvertLeadForm
      lead={lead()}
      onClose={() => {}}
      onConverted={onConverted}
    />,
  );
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByLabelText("Client name *")).toHaveValue(
    "Maya Ortiz",
  );
  expect(within(dialog).getByLabelText("Event date *")).toHaveValue(
    "2026-12-05",
  );
  fireEvent.change(within(dialog).getByLabelText("Start time *"), {
    target: { value: "18:00" },
  });
  await user.click(
    within(dialog).getByRole("button", { name: "Convert lead" }),
  );
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "A client with this email or phone already exists",
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Link to Juniper & Co." }),
  );
  const picker = await within(dialog).findByLabelText("Existing client");
  await vi.waitFor(() => expect(picker).toHaveValue(juniper.id));
  await user.click(
    within(dialog).getByRole("button", { name: "Convert lead" }),
  );
  await vi.waitFor(() => expect(onConverted).toHaveBeenCalled());
  expect(posts).toEqual([
    {
      client: {
        mode: "create",
        name: "Maya Ortiz",
        kind: "person",
        allowDuplicate: false,
      },
      event: { title: "", date: "2026-12-05", startTime: "18:00" },
    },
    {
      client: { mode: "link", clientId: juniper.id },
      event: { title: "", date: "2026-12-05", startTime: "18:00" },
    },
  ]);
});
