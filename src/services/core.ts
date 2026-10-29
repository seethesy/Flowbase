import type { z } from "zod";
import { queryClient } from "../app/queryClient";
import { authFetch } from "./auth";
import { apiErrorSchema } from "../../shared/api";
import type { Version } from "../../shared/schema-primitives";
import {
  clientSchema,
  duplicateErrorSchema,
  eventSchema,
  eventStatusChangeSchema,
  venueSchema,
  type ClientInput,
  type EventInput,
  type EventStatus,
  type EventTransitionInput,
  type VenueInput,
} from "../../shared/core-records";
import { eventHubSchema } from "../../shared/event-hub";
import {
  costChangeSchema,
  itemSchema,
  movementSchema,
  sectionSchema,
  stockCountSchema,
  stockCountSummarySchema,
  type CorrectionInput,
  type CountInput,
  type CountLineInput,
  type ItemInput,
  type ItemKind,
  type MovementInput,
  type SectionKind,
  type TransferInput,
} from "../../shared/inventory";
import {
  clientRecipeSchema,
  recipeSchema,
  scaledRecipeSchema,
  type RecipeInput,
} from "../../shared/recipes";

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

async function send(path: string, method = "GET", body?: unknown) {
  const response = await authFetch(path, {
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
  // A save can change anything another screen has cached (FLOW-189): mark it
  // all stale, so each screen refetches the next time it opens. Screens on view
  // reload what they show themselves, as before.
  if (method !== "GET")
    void queryClient.invalidateQueries({ refetchType: "none" });
  return { json, response };
}

export async function request<S extends z.ZodType>(
  schema: S,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<z.output<S>> {
  return schema.parse((await send(path, method, body)).json);
}

// One page of a list (FLOW-179): the rows, and the cursor for the next page when
// the API says more rows exist.
export type Page<T> = { rows: T[]; next: string | null };
export async function requestPage<S extends z.ZodType>(
  schema: S,
  path: string,
): Promise<Page<z.output<S>>> {
  const { json, response } = await send(path);
  const more = response.headers.get("X-Has-More") === "true";
  return {
    rows: schema.array().parse(json),
    next: more ? response.headers.get("X-Next-Cursor") : null,
  };
}
// Every page, for pickers and sub-lists that must be complete (a venue picker, a
// client's events). Stops after `maxPages` as a guard against a runaway loop.
export async function allPages<T>(
  load: (cursor?: string) => Promise<Page<T>>,
  maxPages = 50,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await load(cursor);
    rows.push(...result.rows);
    if (!result.next) break;
    cursor = result.next;
  }
  return rows;
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
  list: (
    filter: { archived?: boolean; flagged?: boolean; search?: string } = {},
    cursor?: string,
  ) => requestPage(clientSchema, `/api/clients${query({ ...filter, cursor })}`),
  get: (id: string) => request(clientSchema, at("clients", id)),
  create: (input: ClientInput) =>
    request(clientSchema, "/api/clients", "POST", input),
  // Carries the updatedAt the form loaded; a stale copy answers 409 STALE (FLOW-186).
  update: (id: string, input: ClientInput & Version) =>
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
  list: (filter: { archived?: boolean; search?: string } = {}, cursor?: string) =>
    requestPage(venueSchema, `/api/venues${query({ ...filter, cursor })}`),
  get: (id: string) => request(venueSchema, at("venues", id)),
  create: (input: VenueInput) =>
    request(venueSchema, "/api/venues", "POST", input),
  update: (id: string, input: VenueInput & Version) =>
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
      search?: string;
      statuses?: EventStatus[];
    } = {},
    cursor?: string,
  ) => {
    const { statuses, ...rest } = filter;
    return requestPage(
      eventSchema,
      `/api/events${query({ ...rest, status: statuses?.join(","), cursor })}`,
    );
  },
  get: (id: string) => request(eventSchema, at("events", id)),
  hub: (id: string) => request(eventHubSchema, at("events", id, "hub")),
  create: (input: EventInput) =>
    request(eventSchema, "/api/events", "POST", input),
  update: (id: string, input: EventInput & Version) =>
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
  statusHistory: (id: string, cursor?: string) =>
    requestPage(
      eventStatusChangeSchema,
      `${at("events", id, "status-history")}${query({ cursor })}`,
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
      tier?: string;
      subcategory?: string;
    } = {},
    cursor?: string,
  ) =>
    requestPage(itemSchema, `/api/inventory/items${query({ ...filter, cursor })}`),
  get: (id: string) => request(itemSchema, at("inventory/items", id)),
  create: (input: ItemInput) =>
    request(itemSchema, "/api/inventory/items", "POST", input),
  update: (id: string, input: ItemInput & Version) =>
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
  movements: (id: string, cursor?: string) =>
    requestPage(
      movementSchema,
      `${at("inventory/items", id, "movements")}${query({ cursor })}`,
    ),
  addMovement: (id: string, input: MovementInput) =>
    request(itemSchema, at("inventory/items", id, "movements"), "POST", input),
  correct: (movementId: string, input: CorrectionInput) =>
    request(
      movementSchema.array(),
      at("inventory/movements", movementId, "corrections"),
      "POST",
      input,
    ),
  costHistory: (id: string, cursor?: string) =>
    requestPage(
      costChangeSchema,
      `${at("inventory/items", id, "cost-history")}${query({ cursor })}`,
    ),
};

// Count mode (FLOW-82).
export const countsApi = {
  list: (filter: { status?: "open" | "completed" } = {}, cursor?: string) =>
    requestPage(
      stockCountSummarySchema,
      `/api/inventory/counts${query({ ...filter, cursor })}`,
    ),
  get: (id: string) => request(stockCountSchema, at("inventory/counts", id)),
  start: (sectionId: string) =>
    request(stockCountSchema, "/api/inventory/counts", "POST", { sectionId }),
  saveLine: (id: string, input: CountLineInput) =>
    request(
      stockCountSchema,
      at("inventory/counts", id, "lines"),
      "POST",
      input,
    ),
  complete: (id: string) =>
    request(
      stockCountSchema,
      at("inventory/counts", id, "complete"),
      "POST",
      {},
    ),
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

// Recipe book (FLOW-93/94/95/98).
export const recipesApi = {
  clientList: (filter: { category?: string } = {}) =>
    request(clientRecipeSchema.array(), `/api/recipes/client${query(filter)}`),
  list: (
    filter: {
      archived?: boolean;
      category?: string;
      search?: string;
    } = {},
  ) => request(recipeSchema.array(), `/api/recipes${query(filter)}`),
  get: (id: string) => request(recipeSchema, at("recipes", id)),
  create: (input: RecipeInput) =>
    request(recipeSchema, "/api/recipes", "POST", input),
  update: (id: string, input: RecipeInput) =>
    request(recipeSchema, at("recipes", id), "PUT", input),
  setArchived: (id: string, archived: boolean) =>
    request(
      recipeSchema,
      at("recipes", id, archived ? "archive" : "restore"),
      "POST",
      {},
    ),
  scale: (id: string, servings: number) =>
    request(
      scaledRecipeSchema,
      `${at("recipes", id, "scale")}${query({ servings: String(servings) })}`,
    ),
};
