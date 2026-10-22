import { randomUUID } from "node:crypto";
import type { Page, Route } from "@playwright/test";
import type { Attachment, UploadRequest } from "../../shared/attachments";
import type {
  Client,
  ClientInput,
  EventInput,
  EventStatusChange,
  EventTransitionInput,
  FlowEvent,
  Venue,
  VenueInput,
} from "../../shared/core-records";

// An in-memory stand-in for the core records API (FLOW-53/54/55). Playwright runs
// against a Worker without a database or sign-in, so these screens get a fake
// backend that behaves like the real routes for an admin.
export async function mockRecordsApi(
  page: Page,
  seed: { clients?: Client[] } = {},
) {
  const now = () => new Date().toISOString();
  const clients = new Map((seed.clients ?? []).map((c) => [c.id, c]));
  const venues = new Map<string, Venue>();
  const events = new Map<string, FlowEvent>();
  const statusChanges = new Map<string, EventStatusChange[]>();
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, json: body });
  const notFound = (route: Route) =>
    json(
      route,
      {
        error: {
          code: "NOT_FOUND",
          message: "Not found.",
          requestId: randomUUID(),
        },
      },
      404,
    );
  const saveClient = (input: ClientInput, current?: Client): Client => ({
    id: current?.id ?? randomUUID(),
    name: input.name,
    kind: input.kind,
    assignedSalespersonId: null,
    notes: input.notes ?? "",
    tags: input.tags ?? [],
    contacts: (input.contacts ?? []).map((contact) => ({
      id: contact.id ?? randomUUID(),
      name: contact.name,
      role: contact.role,
      email: contact.email ?? "",
      phone: contact.phone ?? "",
      notes: contact.notes ?? "",
    })),
    possibleDuplicateOf: null,
    archivedAt: current?.archivedAt ?? null,
    createdAt: current?.createdAt ?? now(),
    updatedAt: now(),
  });
  const saveVenue = (input: VenueInput, current?: Venue): Venue => ({
    id: current?.id ?? randomUUID(),
    name: input.name,
    address: input.address ?? "",
    jurisdiction: input.jurisdiction ?? null,
    loadInNotes: input.loadInNotes ?? "",
    parkingNotes: input.parkingNotes ?? "",
    areas: (input.areas ?? []).map((area) => ({
      id: area.id ?? randomUUID(),
      name: area.name,
    })),
    contacts: (input.contacts ?? current?.contacts ?? []).map((contact) => ({
      id: contact.id ?? randomUUID(),
      name: contact.name,
      role: contact.role,
      email: contact.email ?? "",
      phone: contact.phone ?? "",
    })),
    archivedAt: current?.archivedAt ?? null,
    createdAt: current?.createdAt ?? now(),
    updatedAt: now(),
  });
  const saveEvent = (input: EventInput, current?: FlowEvent): FlowEvent => {
    const client = clients.get(input.clientId);
    const venue = input.venueId ? venues.get(input.venueId) : undefined;
    const areas =
      input.areas ??
      (venue && venue.id !== current?.venue?.id
        ? venue.areas.map((area) => area.name)
        : (current?.areas.map((area) => area.name) ?? []));
    return {
      id: current?.id ?? randomUUID(),
      title: input.title,
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime ?? null,
      startsAt: new Date(`${input.date}T${input.startTime}:00Z`).toISOString(),
      endsAt: null,
      client: { id: input.clientId, name: client?.name ?? "" },
      pocContactId: input.pocContactId ?? null,
      venue: venue ? { id: venue.id, name: venue.name } : null,
      address: input.address || venue?.address || "",
      areas: areas.map((name) => ({ id: randomUUID(), name })),
      eventType: input.eventType ?? "",
      serviceType: input.serviceType ?? "",
      foodServiceStyle: input.foodServiceStyle ?? "",
      guestCount: input.guestCount ?? null,
      servingsCount: input.servingsCount ?? null,
      assignedSalespersonId: null,
      productionLeadId: null,
      assistantLeadIds: [],
      dressCode: input.dressCode ?? "",
      transportationNotes: input.transportationNotes ?? "",
      internalNotes: input.internalNotes ?? "",
      // Like the API: any status on create, unchanged by an edit.
      status: current?.status ?? input.status ?? "inquiry",
      bookedAt: null,
      archivedAt: current?.archivedAt ?? null,
      createdAt: current?.createdAt ?? now(),
      updatedAt: now(),
    };
  };
  const collections = {
    clients: { store: clients, save: saveClient },
    venues: { store: venues, save: saveVenue },
    events: { store: events, save: saveEvent },
  } as const;

  await page.route(/\/api\/(clients|venues|events)(\/|\?|$)/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const parts = url.pathname.split("/");
    const resource = parts[2] as keyof typeof collections;
    const id: string | undefined = parts[3];
    const action: string | undefined = parts[4];
    const { store, save } = collections[resource];
    const records = store as Map<string, { id: string; archivedAt: string | null }>;
    const method = request.method();
    if (!id && method === "GET") {
      const archived = url.searchParams.get("archived") === "true";
      const clientId = url.searchParams.get("clientId");
      const venueId = url.searchParams.get("venueId");
      return json(
        route,
        [...records.values()].filter((record) => {
          const event = record as unknown as FlowEvent;
          return (
            Boolean(record.archivedAt) === archived &&
            (!clientId || event.client?.id === clientId) &&
            (!venueId || event.venue?.id === venueId)
          );
        }),
      );
    }
    if (!id && method === "POST") {
      const created = (save as (input: unknown) => { id: string })(
        request.postDataJSON(),
      );
      records.set(created.id, created as never);
      return json(route, created, 201);
    }
    const current = id ? records.get(id) : undefined;
    if (!current) return notFound(route);
    if (method === "GET") return json(route, current);
    if (method === "PUT") {
      const updated = (
        save as (input: unknown, current: unknown) => { id: string }
      )(request.postDataJSON(), current);
      records.set(current.id, updated as never);
      return json(route, updated);
    }
    if (resource === "events" && action === "status-history" && method === "GET")
      return json(route, statusChanges.get(current.id) ?? []);
    if (resource === "events" && action === "status" && method === "POST") {
      const event = current as unknown as FlowEvent;
      const input = request.postDataJSON() as EventTransitionInput;
      const updated = { ...event, status: input.status, updatedAt: now() };
      statusChanges.set(event.id, [
        {
          id: randomUUID(),
          manual: true,
          from: event.status,
          to: input.status,
          reason: input.reason ?? "",
          actorId: null,
          at: now(),
        },
        ...(statusChanges.get(event.id) ?? []),
      ]);
      records.set(event.id, updated as never);
      return json(route, updated);
    }
    if (method === "POST" && (action === "archive" || action === "restore")) {
      const updated = {
        ...current,
        archivedAt: action === "archive" ? now() : null,
      };
      records.set(current.id, updated);
      return json(route, updated);
    }
    return notFound(route);
  });
}

// Attachments (FLOW-42) with R2 mocked: signed URLs point at /r2-mock/ on the
// app's own origin, where the browser's PUTs are recorded and served back.
export async function mockAttachmentsApi(page: Page) {
  const objects = new Map<string, { body: Buffer; type: string }>();
  const puts: { key: string; size: number; type: string }[] = [];
  const attachments = new Map<string, Attachment>();
  const keysOf = new Map<string, string[]>();
  let starts = 0;
  await page.route(/\/r2-mock\//, async (route) => {
    const request = route.request();
    const key = new URL(request.url()).pathname.replace("/r2-mock/", "");
    if (request.method() === "PUT") {
      const body = request.postDataBuffer() ?? Buffer.alloc(0);
      const type = request.headers()["content-type"] ?? "";
      objects.set(key, { body, type });
      puts.push({ key, size: body.length, type });
      return route.fulfill({ status: 200 });
    }
    const object = objects.get(key);
    return object
      ? route.fulfill({ status: 200, body: object.body, contentType: object.type })
      : route.fulfill({ status: 404 });
  });
  await page.route(/\/api\/attachments/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const id = url.pathname.split("/")[3];
    const action = url.pathname.split("/")[4];
    const signed = (key: string) => `${url.origin}/r2-mock/${key}`;
    if (!id && request.method() === "GET")
      return route.fulfill({
        json: [...attachments.values()].filter(
          (attachment) =>
            attachment.recordId === url.searchParams.get("recordId") &&
            attachment.urlsExpireAt !== null,
        ),
      });
    if (!id && request.method() === "POST") {
      starts += 1;
      const input = request.postDataJSON() as UploadRequest;
      const attachmentId = randomUUID();
      const keys = input.variants.map(
        (variant) => `${attachmentId}/${variant.name}`,
      );
      const attachment: Attachment = {
        id: attachmentId,
        recordType: input.recordType,
        recordId: input.recordId,
        group: input.group ?? "",
        fileName: input.fileName,
        caption: input.caption ?? "",
        kind: input.variants[0].name === "original" ? "document" : "photo",
        urls: {},
        urlsExpireAt: null,
        createdAt: new Date().toISOString(),
      };
      attachments.set(attachmentId, attachment);
      keysOf.set(attachmentId, keys);
      return route.fulfill({
        status: 201,
        json: {
          attachment,
          uploads: input.variants.map((variant, index) => ({
            name: variant.name,
            url: signed(keys[index]),
            headers: { "Content-Type": variant.contentType },
          })),
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        },
      });
    }
    const attachment = id ? attachments.get(id) : undefined;
    if (attachment && action === "complete") {
      const ready: Attachment = {
        ...attachment,
        urls: Object.fromEntries(
          (keysOf.get(attachment.id) ?? []).map((key) => [
            key.split("/")[1],
            signed(key),
          ]),
        ),
        urlsExpireAt: new Date(Date.now() + 300_000).toISOString(),
      };
      attachments.set(attachment.id, ready);
      return route.fulfill({ json: ready });
    }
    return route.fulfill({
      status: 404,
      json: {
        error: { code: "NOT_FOUND", message: "Not found.", requestId: randomUUID() },
      },
    });
  });
  return { puts, starts: () => starts };
}

export const juniper = (): Client => ({
  id: "c0000000-0000-4000-8000-000000000001",
  name: "Juniper & Co.",
  kind: "organization",
  assignedSalespersonId: null,
  notes: "",
  tags: [],
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
  createdAt: "2026-10-22T09:00:00.000Z",
  updatedAt: "2026-10-22T09:00:00.000Z",
});
