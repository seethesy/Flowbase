import type { z } from "zod";
import { apiErrorSchema } from "../../shared/api";
import {
  clientSchema,
  duplicateErrorSchema,
  eventSchema,
  eventStatusChangeSchema,
  venueSchema,
  type ClientInput,
  type EventInput,
  type EventTransitionInput,
  type VenueInput,
} from "../../shared/core-records";
import {
  itemSchema,
  sectionSchema,
  type CountInput,
  type ItemInput,
  type ItemKind,
  type SectionKind,
  type TransferInput,
} from "../../shared/inventory";

// Client for the core records API (FLOW-53/54/55). Failures carry the API's
// message, its request reference, and any possible duplicates.
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly duplicates: { id: string; name: string }[];
  constructor(
    status: number,
    code: string,
    message: string,
    duplicates: { id: string; name: string }[] = [],
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.duplicates = duplicates;
  }
}

export async function request<S extends z.ZodType>(
  schema: S,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<z.output<S>> {
  const response = await fetch(path, {
    method,
    ...(body !== undefined && {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = apiErrorSchema.safeParse(json);
    const duplicate = duplicateErrorSchema.safeParse(json);
    throw new ApiRequestError(
      response.status,
      error.success ? error.data.error.code : "UNKNOWN",
      error.success
        ? `${error.data.error.message} Reference: ${error.data.error.requestId}`
        : `The request failed (${response.status}). Please retry.`,
      duplicate.success ? duplicate.data.duplicates : [],
    );
  }
  return schema.parse(json);
}

export const query = (params: Record<string, string | boolean | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value) search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
};
export const at = (resource: string, id: string, action = "") =>
  `/api/${resource}/${encodeURIComponent(id)}${action && `/${action}`}`;

export const clientsApi = {
  list: (filter: { archived?: boolean; flagged?: boolean } = {}) =>
    request(clientSchema.array(), `/api/clients${query(filter)}`),
  get: (id: string) => request(clientSchema, at("clients", id)),
  create: (input: ClientInput) =>
    request(clientSchema, "/api/clients", "POST", input),
  update: (id: string, input: ClientInput) =>
    request(clientSchema, at("clients", id), "PUT", input),
  setArchived: (id: string, archived: boolean) =>
    request(
      clientSchema,
      at("clients", id, archived ? "archive" : "restore"),
      "POST",
      {},
    ),
};

export const venuesApi = {
  list: (filter: { archived?: boolean } = {}) =>
    request(venueSchema.array(), `/api/venues${query(filter)}`),
  get: (id: string) => request(venueSchema, at("venues", id)),
  create: (input: VenueInput) =>
    request(venueSchema, "/api/venues", "POST", input),
  update: (id: string, input: VenueInput) =>
    request(venueSchema, at("venues", id), "PUT", input),
  setArchived: (id: string, archived: boolean) =>
    request(
      venueSchema,
      at("venues", id, archived ? "archive" : "restore"),
      "POST",
      {},
    ),
};

export const eventsApi = {
  list: (
    filter: {
      archived?: boolean;
      clientId?: string;
      venueId?: string;
      from?: string;
      to?: string;
    } = {},
  ) => request(eventSchema.array(), `/api/events${query(filter)}`),
  get: (id: string) => request(eventSchema, at("events", id)),
  create: (input: EventInput) =>
    request(eventSchema, "/api/events", "POST", input),
  update: (id: string, input: EventInput) =>
    request(eventSchema, at("events", id), "PUT", input),
  setArchived: (id: string, archived: boolean) =>
    request(
      eventSchema,
      at("events", id, archived ? "archive" : "restore"),
      "POST",
      {},
    ),
  setStatus: (id: string, input: EventTransitionInput) =>
    request(eventSchema, at("events", id, "status"), "POST", input),
  statusHistory: (id: string) =>
    request(
      eventStatusChangeSchema.array(),
      at("events", id, "status-history"),
    ),
};

export const inventoryApi = {
  list: (
    filter: {
      archived?: boolean;
      kind?: ItemKind;
      subtype?: string;
      category?: string;
      sectionId?: string;
      vendor?: string;
      belowPar?: boolean;
      search?: string;
    } = {},
  ) => request(itemSchema.array(), `/api/inventory/items${query(filter)}`),
  get: (id: string) => request(itemSchema, at("inventory/items", id)),
  create: (input: ItemInput) =>
    request(itemSchema, "/api/inventory/items", "POST", input),
  update: (id: string, input: ItemInput) =>
    request(itemSchema, at("inventory/items", id), "PUT", input),
  setArchived: (id: string, archived: boolean) =>
    request(
      itemSchema,
      at("inventory/items", id, archived ? "archive" : "restore"),
      "POST",
      {},
    ),
  transfer: (id: string, input: TransferInput) =>
    request(itemSchema, at("inventory/items", id, "transfers"), "POST", input),
  count: (id: string, input: CountInput) =>
    request(itemSchema, at("inventory/items", id, "counts"), "POST", input),
};

export const sectionsApi = {
  list: (filter: { archived?: boolean; kind?: SectionKind } = {}) =>
    request(sectionSchema.array(), `/api/inventory/sections${query(filter)}`),
  create: (input: { name: string; kind: SectionKind }) =>
    request(sectionSchema, "/api/inventory/sections", "POST", input),
  rename: (id: string, name: string) =>
    request(sectionSchema, at("inventory/sections", id), "PUT", { name }),
  setArchived: (id: string, archived: boolean) =>
    request(
      sectionSchema,
      at("inventory/sections", id, archived ? "archive" : "restore"),
      "POST",
      {},
    ),
};
