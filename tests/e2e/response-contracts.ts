import type { Response } from "@playwright/test";
import type { z } from "zod";
import { apiErrorSchema, healthSchema } from "../../shared/api";
import { authConfigSchema, userSchema } from "../../shared/users";
import { recordSchemas } from "../../shared/records";
import {
  clientSchema,
  venueSchema,
  eventSchema,
  eventStatusChangeSchema,
} from "../../shared/core-records";
import { eventHubSchema } from "../../shared/event-hub";
import {
  itemSchema,
  sectionSchema,
  movementSchema,
  costChangeSchema,
  stockCountSchema,
  stockCountSummarySchema,
} from "../../shared/inventory";
import {
  leadSchema,
  leadDashboardSchema,
  leadDuplicateSchema,
  leadConversionSchema,
} from "../../shared/leads";
import { searchResultSchema } from "../../shared/search";
import {
  timeReportSchema,
  activityRecordedSchema,
} from "../../shared/time-tracking";
import { attachmentSchema, uploadTicketSchema } from "../../shared/attachments";
import { historyEntrySchema } from "../../shared/audit";

export function responseSchema(
  path: string,
  method: string,
  status: number,
): z.ZodType {
  if (status >= 400) return apiErrorSchema;
  const [, , resource, id, action] = path.split("/");
  if (resource === "health") return healthSchema;
  if (resource === "auth")
    return id === "config" ? authConfigSchema : userSchema;
  if (resource === "demo") {
    const schema = recordSchemas[id as keyof typeof recordSchemas];
    if (schema) return method === "GET" ? schema.array() : schema;
  }
  if (resource === "admin" && id === "users")
    return method === "GET" ? userSchema.array() : userSchema;
  if (resource === "search") return searchResultSchema.array();
  if (resource === "time")
    return id === "report" ? timeReportSchema : activityRecordedSchema;
  if (resource === "attachments")
    return !id && method === "GET"
      ? attachmentSchema.array()
      : !id && method === "POST"
        ? uploadTicketSchema
        : attachmentSchema;
  if (resource === "leads") {
    if (id === "dashboard") return leadDashboardSchema;
    if (id === "duplicates")
      return action ? leadSchema : leadDuplicateSchema.array();
    if (id === "assign") return leadSchema.array();
    if (action === "convert") return leadConversionSchema;
    return !id ? leadSchema.array() : leadSchema;
  }
  if (resource === "inventory") {
    const tail = path.split("/")[5];
    if (id === "sections")
      return !action && method === "GET"
        ? sectionSchema.array()
        : sectionSchema;
    if (id === "counts")
      return !action && method === "GET"
        ? stockCountSummarySchema.array()
        : stockCountSchema;
    if (id === "movements") return movementSchema.array();
    if (tail === "cost-history") return costChangeSchema.array();
    if (tail === "movements" && method === "GET") return movementSchema.array();
    return !action && method === "GET" ? itemSchema.array() : itemSchema;
  }
  if (["clients", "venues", "events"].includes(resource)) {
    if (action === "history") return historyEntrySchema.array();
    if (action === "status-history") return eventStatusChangeSchema.array();
    if (action === "hub") return eventHubSchema;
    const schema =
      resource === "clients"
        ? clientSchema
        : resource === "venues"
          ? venueSchema
          : eventSchema;
    return !id && method === "GET" ? schema.array() : schema;
  }
  throw new Error(`Missing shared response contract for ${method} ${path}`);
}

export async function validateApiResponse(response: Response) {
  if (response.status() === 204) return;
  responseSchema(
    new URL(response.url()).pathname,
    response.request().method(),
    response.status(),
  ).parse(await response.json());
}
