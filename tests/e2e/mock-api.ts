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
  CorrectionInput,
  CostChange,
  CountInput,
  CountLineInput,
  InventoryItem,
  ItemInput,
  MovementInput,
  MovementType,
  Section,
  StockCount,
  StockMovement,
  TransferInput,
} from "../../shared/inventory";

import {
  leadStatusTransitions,
  type Lead,
  type LeadConversion,
  type LeadDuplicate,
  type LeadDuplicateReason,
  type LeadSourceLink,
  type LeadSummary,
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

// The inventory API (FLOW-69/70/71/81/82/83/90) for an admin, in memory, with the
// default sections. Seed items are stored as returned by the API; their seeded
// stock has no movements.
export async function mockInventoryApi(
  page: Page,
  seed: { items?: InventoryItem[] } = {},
) {
  const now = () => new Date().toISOString();
  const sections = new Map<string, Section>(
    defaultSections.map((section) => [section.id, section]),
  );
  const items = new Map((seed.items ?? []).map((item) => [item.id, item]));
  const ledger = new Map<string, StockMovement[]>();
  const costs = new Map<string, CostChange[]>();
  type Count = {
    id: string;
    sectionId: string;
    status: StockCount["status"];
    startedAt: string;
    completedAt: string | null;
    lines: Map<
      string,
      { quantity: number; difference: number; reason: string; countedAt: string }
    >;
  };
  const counts = new Map<string, Count>();
  const signed = (type: MovementType, quantity: number) =>
    ["pull", "damage_loss", "consume"].includes(type) ? -quantity : quantity;
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
    const previousCents = current?.consumable?.unitCostCents ?? null;
    if (
      consumable?.unitCostCents !== undefined &&
      consumable.unitCostCents !== previousCents &&
      current
    )
      costs.set(current.id, [
        {
          id: randomUUID(),
          previousCents,
          unitCostCents: consumable.unitCostCents,
          source: "manual",
          changedBy: null,
          changedAt: now(),
        },
        ...(costs.get(current.id) ?? []),
      ]);
    const isBar = input.kind === "consumable" && input.subtype === "bar";
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
              dietaryTags: consumable.dietaryTags ?? [],
              allergensVerified: consumable.allergensVerified ?? false,
              storageSectionId: storage?.id ?? null,
              storageSectionName: storage?.name ?? null,
              storageOrder: consumable.storageOrder ?? null,
            }
          : null,
        bar: isBar
          ? {
              brand: input.bar?.brand ?? "",
              subcategory: input.bar?.subcategory ?? "",
              container: input.bar?.container ?? null,
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
  const change = (
    item: InventoryItem,
    sectionId: string,
    delta: number,
    movement: Partial<StockMovement> & { type: MovementType },
  ) => {
    ledger.set(item.id, [
      {
        id: randomUUID(),
        itemId: item.id,
        sectionId,
        sectionName: sections.get(sectionId)?.name ?? "",
        quantity: delta,
        reason: "",
        transferId: null,
        correctsId: null,
        correctedBy: [],
        link: null,
        createdBy: null,
        createdAt: now(),
        ...movement,
      },
      ...(ledger.get(item.id) ?? []),
    ]);
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
    if (resource === "counts") return countRoute(route, id, action, body);
    if (resource === "movements" && action === "corrections") {
      const input = body as CorrectionInput;
      const list =
        [...ledger.values()].find((movements) =>
          movements.some((m) => m.id === id),
        ) ?? [];
      const original = list.find((m) => m.id === id);
      const item = original && items.get(original.itemId);
      if (!original || !item)
        return fail(route, 404, "NOT_FOUND", "Movement not found.");
      const itemId = item.id;
      const total = list
        .filter((m) => m.id === id || m.correctsId === id)
        .reduce((sum, m) => sum + m.quantity, 0);
      const correctionId = randomUUID();
      items.set(
        itemId,
        change(item, original.sectionId, input.quantity - total, {
          id: correctionId,
          type: original.type,
          reason: input.reason,
          correctsId: id,
        }),
      );
      original.correctedBy = [...original.correctedBy, correctionId];
      return route.fulfill({ status: 201, json: ledger.get(itemId) });
    }
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
            (!params.get("tier") || item.tier === params.get("tier")) &&
            (!params.get("subcategory") ||
              item.bar?.subcategory === params.get("subcategory")) &&
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
    if (method === "GET" && action === "movements")
      return route.fulfill({ json: ledger.get(current.id) ?? [] });
    if (method === "GET" && action === "cost-history")
      return route.fulfill({ json: costs.get(current.id) ?? [] });
    if (method === "POST" && action === "movements") {
      const movement = body as MovementInput;
      const delta = signed(movement.type, movement.quantity);
      const level = current.stock.find((s) => s.sectionId === movement.sectionId);
      if ((level?.quantity ?? 0) + delta < 0)
        return fail(route, 409, "INSUFFICIENT_STOCK", "Not enough stock.");
      next = change(current, movement.sectionId, delta, {
        type: movement.type,
        reason: movement.reason ?? "",
      });
    }
    if (method === "PUT" && !action) next = save(body as ItemInput, current);
    if (action === "archive" || action === "restore")
      next = { ...current, archivedAt: action === "archive" ? now() : null };
    if (action === "transfers") {
      const transfer = body as TransferInput;
      const from = current.stock.find((s) => s.sectionId === transfer.fromSectionId);
      if ((from?.quantity ?? 0) < transfer.quantity)
        return fail(route, 409, "INSUFFICIENT_STOCK", "Not enough stock.");
      const transferId = randomUUID();
      next = change(
        change(current, transfer.fromSectionId, -transfer.quantity, {
          type: "transfer",
          transferId,
        }),
        transfer.toSectionId,
        transfer.quantity,
        { type: "transfer", transferId },
      );
    }
    if (action === "counts") {
      const counted = body as CountInput;
      const level = current.stock.find((s) => s.sectionId === counted.sectionId);
      next = change(current, counted.sectionId, counted.quantity - (level?.quantity ?? 0), {
        type: "count",
      });
    }
    if (!next) return fail(route, 404, "NOT_FOUND", "Not found.");
    items.set(next.id, next);
    const created =
      action === "transfers" || action === "counts" || action === "movements";
    return route.fulfill({ status: created ? 201 : 200, json: next });
  });

  // Count mode: the section's consumables in shelf order, with saved counts.
  const countView = (count: Count): StockCount => {
    const order = (item: InventoryItem) =>
      item.consumable?.storageOrder ?? Number.MAX_SAFE_INTEGER;
    const lines = [...items.values()]
      .filter(
        (item) =>
          item.kind === "consumable" &&
          !item.archivedAt &&
          (item.consumable?.storageSectionId === count.sectionId ||
            item.stock.some((s) => s.sectionId === count.sectionId) ||
            count.lines.has(item.id)),
      )
      .sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name))
      .map((item) => {
        const line = count.lines.get(item.id);
        return {
          itemId: item.id,
          name: item.name,
          code: item.code,
          subtype: item.subtype,
          category: item.category,
          unit: item.unit,
          storageOrder: item.consumable?.storageOrder ?? null,
          parLevel: item.consumable?.parLevel ?? null,
          belowPar: item.belowPar,
          systemQuantity:
            item.stock.find((s) => s.sectionId === count.sectionId)?.quantity ??
            0,
          canCount: true,
          counted: line ? { ...line, countedBy: null } : null,
        };
      });
    return {
      id: count.id,
      sectionId: count.sectionId,
      sectionName: sections.get(count.sectionId)?.name ?? "",
      status: count.status,
      countedItems: count.lines.size,
      startedBy: null,
      startedAt: count.startedAt,
      completedAt: count.completedAt,
      lines,
    };
  };
  const countRoute = (
    route: Route,
    id: string | undefined,
    action: string | undefined,
    body: unknown,
  ) => {
    const method = route.request().method();
    if (!id && method === "GET") {
      const status = new URL(route.request().url()).searchParams.get("status");
      return route.fulfill({
        json: [...counts.values()]
          .filter((count) => !status || count.status === status)
          // The list carries summaries only.
          .map((count) => ({ ...countView(count), lines: undefined })),
      });
    }
    if (!id && method === "POST") {
      const { sectionId } = body as { sectionId: string };
      const open = [...counts.values()].find(
        (count) => count.sectionId === sectionId && count.status === "open",
      );
      if (open) return route.fulfill({ status: 200, json: countView(open) });
      const count: Count = {
        id: randomUUID(),
        sectionId,
        status: "open",
        startedAt: now(),
        completedAt: null,
        lines: new Map(),
      };
      counts.set(count.id, count);
      return route.fulfill({ status: 201, json: countView(count) });
    }
    const count = id ? counts.get(id) : undefined;
    if (!count) return fail(route, 404, "NOT_FOUND", "Count not found.");
    if (method === "GET") return route.fulfill({ json: countView(count) });
    if (count.status !== "open")
      return fail(route, 409, "COUNT_COMPLETED", "This count is already complete.");
    if (action === "complete") {
      count.status = "completed";
      count.completedAt = now();
      return route.fulfill({ json: countView(count) });
    }
    const line = body as CountLineInput;
    const item = items.get(line.itemId);
    if (!item) return fail(route, 404, "NOT_FOUND", "Item not found.");
    const level = item.stock.find((s) => s.sectionId === count.sectionId);
    const difference = line.quantity - (level?.quantity ?? 0);
    items.set(
      item.id,
      change(item, count.sectionId, difference, {
        type: "count",
        reason: line.reason ?? "",
      }),
    );
    count.lines.set(item.id, {
      quantity: line.quantity,
      difference,
      reason: line.reason ?? "",
      countedAt: now(),
    });
    return route.fulfill({ json: countView(count) });
  };
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
  sectionRow(7, "Bar Storage", "consumable"),
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
  bar: null,
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

// A consumable as the API returns it, kept in Kitchen – Refrigerated unless the
// overrides say otherwise.
export const consumable = (
  name: string,
  overrides: Partial<InventoryItem> & {
    details?: Partial<NonNullable<InventoryItem["consumable"]>>;
    onHand?: number;
  } = {},
): InventoryItem => {
  const { details, onHand = 0, ...item } = overrides;
  const storage =
    defaultSections.find(
      (section) => section.id === details?.storageSectionId,
    ) ?? defaultSections[5];
  const parLevel = details?.parLevel ?? null;
  return {
    id: randomUUID(),
    kind: "consumable",
    subtype: "ingredient",
    code: "",
    name,
    category: "",
    description: "",
    unit: "each",
    group: "",
    color: "",
    tier: "",
    ratio: null,
    active: true,
    rental: null,
    service: null,
    bar: null,
    stock: onHand
      ? [{ sectionId: storage.id, sectionName: storage.name, quantity: onHand }]
      : [],
    totalQuantity: onHand,
    belowPar: parLevel === null ? null : onHand < parLevel,
    archivedAt: null,
    createdAt: "2026-10-22T09:00:00.000Z",
    updatedAt: "2026-10-22T09:00:00.000Z",
    ...item,
    consumable: {
      purchaseUnit: "each",
      packCount: null,
      eachSize: null,
      recipeUnit: null,
      unitCostCents: null,
      costHidden: false,
      preferredVendor: "",
      parLevel,
      allergens: [],
      dietaryTags: [],
      allergensVerified: false,
      storageSectionId: storage.id,
      storageSectionName: storage.name,
      storageOrder: null,
      ...details,
    },
  };
};

// An in-memory stand-in for the leads API (FLOW-100/111/112), behaving like the real
// routes for an admin: filters, the triage queue, status rules, assignment,
// conversion, and possible duplicates with merge (FLOW-110).
export async function mockLeadsApi(
  page: Page,
  seed: Lead[],
  pairs: { leadId: string; matchedLeadId: string; reason: LeadDuplicateReason }[] = [],
) {
  const leads = new Map(seed.map((lead) => [lead.id, lead]));
  const duplicates = new Map<string, (typeof pairs)[number]>(
    pairs.map((pair) => [randomUUID(), pair]),
  );
  const merged = new Map<string, LeadSourceLink[]>();
  const summary = (lead: Lead): LeadSummary => ({
    id: lead.id,
    name: lead.name,
    source: lead.source,
    channel: lead.channel,
    status: lead.status,
    receivedAt: lead.receivedAt,
    eventDate: lead.eventDate,
    assignedSalespersonId: lead.assignedSalespersonId,
  });
  const link = (lead: Lead, mergedAt: string | null = null): LeadSourceLink => ({
    leadId: lead.id,
    channel: lead.channel,
    source: lead.source,
    sourceLeadId: lead.sourceLeadId,
    sourceLeadUrl: lead.sourceLeadUrl,
    receivedAt: lead.receivedAt,
    mergedAt,
    mergedBy: mergedAt ? "a0000000-0000-4000-8000-000000000001" : null,
  });
  const detail = (lead: Lead): Lead => ({
    ...lead,
    sourceLinks: [link(lead), ...(merged.get(lead.id) ?? [])],
    duplicates: [...duplicates.entries()]
      .filter(([, pair]) => pair.leadId === lead.id || pair.matchedLeadId === lead.id)
      .map(([duplicateId, pair]) => ({
        duplicateId,
        reason: pair.reason,
        lead: summary(
          leads.get(pair.leadId === lead.id ? pair.matchedLeadId : pair.leadId)!,
        ),
        client: null,
      })),
    assignedElsewhere: false,
  });
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
    if (id === "duplicates") {
      if (method === "GET" && !action)
        return json(
          route,
          [...duplicates.entries()].map(
            ([duplicateId, pair]): LeadDuplicate => ({
              id: duplicateId,
              reason: pair.reason,
              lead: summary(leads.get(pair.leadId)!),
              matchedLead: summary(leads.get(pair.matchedLeadId)!),
              matchedClient: null,
              crossOwner: false,
              createdAt: "2026-10-20T14:00:00.000Z",
            }),
          ),
        );
      const pair = action ? duplicates.get(action) : undefined;
      if (!pair) return error(route, 404, "NOT_FOUND", "Duplicate not found.");
      duplicates.delete(action!);
      if (parts[5] === "dismiss") return route.fulfill({ status: 204 });
      const keep = leads.get(body.keepLeadId)!;
      const other = leads.get(
        body.keepLeadId === pair.leadId ? pair.matchedLeadId : pair.leadId,
      )!;
      leads.delete(other.id);
      merged.set(keep.id, [
        ...(merged.get(keep.id) ?? []),
        link(other, new Date().toISOString()),
        ...(merged.get(other.id) ?? []),
      ]);
      return json(route, detail(keep));
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
    if (method === "GET") return json(route, detail(current));
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
    mergedIntoLeadId: null,
    archivedAt: null,
    createdAt: "2026-10-10T14:00:00.000Z",
    updatedAt: "2026-10-10T14:00:00.000Z",
    ...overrides,
  };
};
