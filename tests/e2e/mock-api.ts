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
import type {
  CountInput,
  InventoryItem,
  ItemInput,
  Section,
  TransferInput,
} from "../../shared/inventory";

import {
  leadStatusTransitions,
  type Lead,
  type LeadConversion,
} from "../../shared/leads";

// An in-memory stand-in for the core records API (FLOW-53/54/55). Playwright runs
// against a Worker without a database or sign-in, so these screens get a fake
// backend that behaves like the real routes for an admin.
export async function mockRecordsApi(
  page: Page,
  seed: { clients?: Client[]; events?: FlowEvent[] } = {},
) {
  const now = () => new Date().toISOString();
  const clients = new Map((seed.clients ?? []).map((c) => [c.id, c]));
  const venues = new Map<string, Venue>();
  const events = new Map((seed.events ?? []).map((e) => [e.id, e]));
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
    // The event hub (FLOW-57) as an admin sees it.
    if (method === "GET" && resource === "events" && action === "hub") {
      const event = current as unknown as FlowEvent;
      const client = clients.get(event.client.id) ?? null;
      return json(route, {
        event,
        client,
        sections: client ? ["details", "client", "files"] : ["details", "files"],
        canEdit: true,
        canChangeStatus: true,
      });
    }
    if (resource === "events" && action === "status-history" && method === "GET")
      return json(route, statusChanges.get(current.id) ?? []);
    if (method === "GET") return json(route, current);
    if (method === "PUT") {
      const updated = (
        save as (input: unknown, current: unknown) => { id: string }
      )(request.postDataJSON(), current);
      records.set(current.id, updated as never);
      return json(route, updated);
    }
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

export const fallGala = (): FlowEvent => ({
  id: "e0000000-0000-4000-8000-000000000001",
  title: "Fall gala",
  date: "2026-11-14",
  startTime: "18:00",
  endTime: null,
  startsAt: "2026-11-14T23:00:00.000Z",
  endsAt: null,
  client: { id: juniper().id, name: juniper().name },
  pocContactId: juniper().contacts[0].id,
  venue: null,
  address: "100 Garden Way, Arlington, VA",
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
  transportationNotes: "",
  internalNotes: "",
  status: "closed",
  bookedAt: "2026-10-22T09:00:00.000Z",
  archivedAt: null,
  createdAt: "2026-10-22T09:00:00.000Z",
  updatedAt: "2026-10-22T09:00:00.000Z",
});

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

// The inventory API (FLOW-69/70/81) for an admin, in memory, with the default
// sections. Seed items are stored as returned by the API.
export async function mockInventoryApi(
  page: Page,
  seed: { items?: InventoryItem[] } = {},
) {
  const now = () => new Date().toISOString();
  const sections = new Map<string, Section>(
    defaultSections.map((section) => [section.id, section]),
  );
  const items = new Map((seed.items ?? []).map((item) => [item.id, item]));
  const fail = (route: Route, status: number, code: string, message: string) =>
    route.fulfill({
      status,
      json: { error: { code, message, requestId: randomUUID() } },
    });
  const withStock = (item: InventoryItem, stock: InventoryItem["stock"]) => {
    const totalQuantity = stock.reduce((sum, level) => sum + level.quantity, 0);
    const par = item.consumable?.parLevel;
    return {
      ...item,
      stock: stock.filter((level) => level.quantity !== 0),
      totalQuantity,
      belowPar: par === null || par === undefined ? null : totalQuantity < par,
    };
  };
  const save = (input: ItemInput, current?: InventoryItem): InventoryItem => {
    const consumable = input.consumable;
    const storage = consumable?.storageSectionId
      ? sections.get(consumable.storageSectionId)
      : undefined;
    return withStock(
      {
        id: current?.id ?? randomUUID(),
        kind: input.kind,
        subtype: input.subtype ?? null,
        code: input.code ?? "",
        name: input.name,
        category: input.category ?? "",
        description: input.description ?? "",
        unit: input.unit ?? "each",
        group: input.group ?? "",
        color: input.color ?? "",
        tier: input.tier ?? "",
        ratio: input.ratio ?? null,
        active: input.active ?? true,
        rental:
          input.kind === "rental"
            ? { priceCents: input.rental?.priceCents ?? null }
            : null,
        service:
          input.kind === "service"
            ? {
                priceCents: input.service?.priceCents ?? null,
                priceBasis: input.service?.priceBasis ?? "per_event",
              }
            : null,
        consumable: consumable
          ? {
              purchaseUnit: consumable.purchaseUnit,
              packCount: consumable.packCount ?? null,
              eachSize: consumable.eachSize ?? null,
              recipeUnit: consumable.recipeUnit ?? null,
              unitCostCents:
                consumable.unitCostCents ??
                current?.consumable?.unitCostCents ??
                null,
              costHidden: false,
              preferredVendor: consumable.preferredVendor ?? "",
              parLevel: consumable.parLevel ?? null,
              allergens: consumable.allergens ?? [],
              storageSectionId: storage?.id ?? null,
              storageSectionName: storage?.name ?? null,
            }
          : null,
        stock: [],
        totalQuantity: 0,
        belowPar: null,
        archivedAt: current?.archivedAt ?? null,
        createdAt: current?.createdAt ?? now(),
        updatedAt: now(),
      },
      current?.stock ?? [],
    );
  };
  const change = (item: InventoryItem, sectionId: string, delta: number) => {
    const stock = item.stock.map((other) => ({ ...other }));
    const level = stock.find((other) => other.sectionId === sectionId);
    if (level) level.quantity += delta;
    else
      stock.push({
        sectionId,
        sectionName: sections.get(sectionId)?.name ?? "",
        quantity: delta,
      });
    return withStock(item, stock);
  };

  await page.route(/\/api\/inventory\//, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const [, , , resource, id, action] = url.pathname.split("/");
    const method = request.method();
    const body = method === "GET" ? undefined : request.postDataJSON();
    if (resource === "sections") {
      if (!id && method === "GET") {
        const kind = url.searchParams.get("kind");
        const archived = url.searchParams.get("archived") === "true";
        return route.fulfill({
          json: [...sections.values()].filter(
            (section) =>
              (!kind || section.kind === kind) &&
              Boolean(section.archivedAt) === archived,
          ),
        });
      }
      return fail(route, 404, "NOT_FOUND", "Not found.");
    }
    if (!id && method === "GET") {
      const params = url.searchParams;
      return route.fulfill({
        json: [...items.values()].filter(
          (item) =>
            Boolean(item.archivedAt) === (params.get("archived") === "true") &&
            (!params.get("kind") || item.kind === params.get("kind")) &&
            (!params.get("subtype") || item.subtype === params.get("subtype")) &&
            (!params.get("category") ||
              item.category === params.get("category")) &&
            (!params.get("sectionId") ||
              item.stock.some((s) => s.sectionId === params.get("sectionId")) ||
              item.consumable?.storageSectionId === params.get("sectionId")) &&
            (params.get("belowPar") !== "true" || item.belowPar === true),
        ),
      });
    }
    if (!id && method === "POST") {
      const created = save(body as ItemInput);
      items.set(created.id, created);
      return route.fulfill({ status: 201, json: created });
    }
    const current = id ? items.get(id) : undefined;
    if (!current) return fail(route, 404, "NOT_FOUND", "Item not found.");
    let next: InventoryItem | undefined;
    if (method === "GET" && !action) next = current;
    if (method === "PUT" && !action) next = save(body as ItemInput, current);
    if (action === "archive" || action === "restore")
      next = { ...current, archivedAt: action === "archive" ? now() : null };
    if (action === "transfers") {
      const transfer = body as TransferInput;
      const from = current.stock.find((s) => s.sectionId === transfer.fromSectionId);
      if ((from?.quantity ?? 0) < transfer.quantity)
        return fail(route, 409, "INSUFFICIENT_STOCK", "Not enough stock.");
      next = change(
        change(current, transfer.fromSectionId, -transfer.quantity),
        transfer.toSectionId,
        transfer.quantity,
      );
    }
    if (action === "counts") {
      const counted = body as CountInput;
      const level = current.stock.find((s) => s.sectionId === counted.sectionId);
      next = change(current, counted.sectionId, counted.quantity - (level?.quantity ?? 0));
    }
    if (!next) return fail(route, 404, "NOT_FOUND", "Not found.");
    items.set(next.id, next);
    const created = action === "transfers" || action === "counts";
    return route.fulfill({ status: created ? 201 : 200, json: next });
  });
}

const sectionRow = (index: number, name: string, kind: Section["kind"]): Section => ({
  id: `d0000000-0000-4000-8000-00000000000${index}`,
  name,
  kind,
  totalQuantity: 0,
  archivedAt: null,
});
export const defaultSections = [
  sectionRow(1, "Warehouse", "rental"),
  sectionRow(2, "Jamie's", "rental"),
  sectionRow(3, "Cafe", "rental"),
  sectionRow(4, "Vendor", "rental"),
  sectionRow(5, "Kitchen – Dry Storage", "consumable"),
  sectionRow(6, "Kitchen – Refrigerated", "consumable"),
];

export const chairs = (): InventoryItem => ({
  id: "e0000000-0000-4000-8000-000000000001",
  kind: "rental",
  subtype: "furniture",
  code: "CH-001",
  name: "Chiavari Chair",
  category: "Chairs",
  description: "",
  unit: "each",
  group: "",
  color: "Gold",
  tier: "",
  ratio: { quantity: 1, basis: "per_guest" },
  active: true,
  rental: { priceCents: 800 },
  service: null,
  consumable: null,
  stock: [
    { sectionId: defaultSections[0].id, sectionName: "Warehouse", quantity: 40 },
    { sectionId: defaultSections[2].id, sectionName: "Cafe", quantity: 10 },
  ],
  totalQuantity: 50,
  belowPar: null,
  archivedAt: null,
  createdAt: "2026-10-22T09:00:00.000Z",
  updatedAt: "2026-10-22T09:00:00.000Z",
});

// An in-memory stand-in for the leads API (FLOW-100/111/112), behaving like the real
// routes for an admin: filters, the triage queue, status rules, assignment and
// conversion.
export async function mockLeadsApi(page: Page, seed: Lead[]) {
  const leads = new Map(seed.map((lead) => [lead.id, lead]));
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, json: body });
  const error = (route: Route, status: number, code: string, message: string) =>
    json(
      route,
      { error: { code, message, requestId: randomUUID() } },
      status,
    );
  await page.route(/\/api\/leads(\/|\?|$)/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const parts = url.pathname.split("/");
    const id: string | undefined = parts[3];
    const action: string | undefined = parts[4];
    const method = request.method();
    const body = method === "POST" ? request.postDataJSON() : undefined;
    if (method === "GET" && !id) {
      const param = (key: string) => url.searchParams.get(key);
      return json(
        route,
        [...leads.values()]
          .filter(
            (lead) =>
              (!param("status") || lead.status === param("status")) &&
              (!param("source") || lead.source === param("source")) &&
              (!param("channel") || lead.channel === param("channel")) &&
              (param("needsReview") !== "true" || lead.needsReview) &&
              (param("triage") !== "true" ||
                (!lead.assignedSalespersonId &&
                  ["new", "contacted", "qualified"].includes(lead.status))),
          )
          .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)),
      );
    }
    if (method === "POST" && id === "assign") {
      for (const leadId of body.leadIds as string[]) {
        const lead = leads.get(leadId);
        if (lead)
          leads.set(leadId, {
            ...lead,
            assignedSalespersonId: body.assignedSalespersonId,
          });
      }
      return json(
        route,
        (body.leadIds as string[]).map((leadId) => leads.get(leadId)),
      );
    }
    const current = id ? leads.get(id) : undefined;
    if (!current)
      return error(route, 404, "NOT_FOUND", "Lead not found.");
    if (method === "GET") return json(route, current);
    if (action === "assign") {
      const updated = {
        ...current,
        assignedSalespersonId: body.assignedSalespersonId,
      };
      leads.set(current.id, updated);
      return json(route, updated);
    }
    if (action === "status") {
      if (body.status === "lost" && !String(body.reason ?? "").trim())
        return error(
          route,
          400,
          "INVALID_REQUEST",
          "A reason is required when marking a lead lost.",
        );
      if (!leadStatusTransitions[current.status].includes(body.status))
        return error(
          route,
          409,
          "INVALID_TRANSITION",
          `A ${current.status} lead can't be marked ${body.status}.`,
        );
      const now = new Date();
      const updated: Lead = {
        ...current,
        status: body.status,
        lostReason: body.status === "lost" ? body.reason : current.lostReason,
        firstRespondedAt:
          current.firstRespondedAt ??
          (body.status === "contacted" ? now.toISOString() : null),
        firstResponseSeconds:
          current.firstResponseSeconds ??
          (body.status === "contacted"
            ? Math.round((now.getTime() - Date.parse(current.receivedAt)) / 1000)
            : null),
      };
      leads.set(current.id, updated);
      return json(route, updated);
    }
    if (action === "convert") {
      if (current.status !== "qualified")
        return error(
          route,
          409,
          "INVALID_TRANSITION",
          "Only a qualified lead can be converted.",
        );
      const clientId = randomUUID();
      const eventId = randomUUID();
      const converted: Lead = {
        ...current,
        status: "converted",
        convertedClientId: clientId,
        convertedEventId: eventId,
      };
      leads.set(current.id, converted);
      const result: LeadConversion = {
        lead: converted,
        client: { id: clientId, name: body.client?.name || current.name },
        event: {
          id: eventId,
          title: body.event.title || `${current.name} — ${current.eventType}`,
        },
      };
      return json(route, result);
    }
    return error(route, 404, "NOT_FOUND", "Not found.");
  });
}

let leadCounter = 0;
export const lead = (overrides: Partial<Lead> = {}): Lead => {
  leadCounter += 1;
  return {
    id: `d0000000-0000-4000-8000-${String(leadCounter).padStart(12, "0")}`,
    receivedAt: `2026-10-${String(10 + leadCounter).padStart(2, "0")}T14:00:00.000Z`,
    channel: "webhook",
    source: "Bark",
    sourceLeadId: `bark-${leadCounter}`,
    sourceLeadUrl: "",
    purchased: false,
    name: `Lead ${leadCounter}`,
    email: `lead${leadCounter}@example.com`,
    phone: "202-555-0100",
    eventDate: "2026-12-05",
    guestCount: 60,
    location: "Brooklyn, NY",
    eventType: "Wedding",
    budgetCents: null,
    message: "",
    status: "new",
    lostReason: "",
    firstRespondedAt: null,
    firstResponseSeconds: null,
    assignedSalespersonId: null,
    convertedClientId: null,
    convertedEventId: null,
    needsReview: false,
    rawPayload: null,
    archivedAt: null,
    createdAt: "2026-10-10T14:00:00.000Z",
    updatedAt: "2026-10-10T14:00:00.000Z",
    ...overrides,
  };
};
