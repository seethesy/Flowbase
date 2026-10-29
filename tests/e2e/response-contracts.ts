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
import { itemAllocationSchema, requirementSchema } from "../../shared/allocation";
import { eventRosterSchema } from "../../shared/event-staff";
import {
  availabilitySchema,
  conflictSchema,
  reservationSchema,
} from "../../shared/reservations";
import {
  proposalDetailSchema,
  proposalSchema,
  proposalUploadTicketSchema,
} from "../../shared/proposals";
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
import { vendorDetailSchema, vendorSchema } from "../../shared/vendors";
import {
  timeReportSchema,
  activityRecordedSchema,
} from "../../shared/time-tracking";
import { attachmentSchema, uploadTicketSchema } from "../../shared/attachments";
import { historyEntrySchema } from "../../shared/audit";
import { clientRecipeSchema, recipeSchema, scaledRecipeSchema } from "../../shared/recipes";
import {
  businessDefaultsSchema,
  businessSettingsSchema,
  companyProfileSchema,
  listValueSchema,
  settingsHistoryEntrySchema,
} from "../../shared/settings";
import { staffMemberSchema } from "../../shared/staff";
import {
  notificationInboxSchema,
  notificationPreferenceSchema,
  notificationSchema,
} from "../../shared/notifications";
import { taskSchema, taskSummarySchema } from "../../shared/tasks";
import { approvalRequestSchema } from "../../shared/approvals";
import {
  importBatchResultSchema,
  importLogSchema,
  importModuleSchema,
  importRowPlanSchema,
} from "../../shared/imports";

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
    if (action === "history") return historyEntrySchema.array();
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
    if (tail === "history") return historyEntrySchema.array();
    // Availability, conflicts and allocations of an item (FLOW-76/77/85).
    if (tail === "availability") return availabilitySchema;
    if (tail === "conflicts") return conflictSchema.array();
    if (tail === "allocations") return itemAllocationSchema.array();
    if (tail === "movements" && method === "GET") return movementSchema.array();
    return !action && method === "GET" ? itemSchema.array() : itemSchema;
  }
  if (resource === "recipes") {
    if (id === "client") return clientRecipeSchema.array();
    if (action === "history") return historyEntrySchema.array();
    if (action === "scale") return scaledRecipeSchema;
    return !id && method === "GET" ? recipeSchema.array() : recipeSchema;
  }
  // Vendor directory (FLOW-84): the list, otherwise the vendor with its items.
  if (resource === "vendors") {
    if (action === "history") return historyEntrySchema.array();
    return !id && method === "GET" ? vendorSchema.array() : vendorDetailSchema;
  }
  if (["clients", "venues", "events"].includes(resource)) {
    if (action === "history") return historyEntrySchema.array();
    if (action === "status-history") return eventStatusChangeSchema.array();
    if (action === "hub") return eventHubSchema;
    // Staff roster (FLOW-140): every roster call answers with the whole roster.
    if (["roster", "shifts", "slots"].includes(action)) return eventRosterSchema;
    // Holds, conflicts and consumable needs (FLOW-76/77/85).
    if (action === "reservations")
      return method === "GET" ? reservationSchema.array() : reservationSchema;
    if (action === "conflicts") return conflictSchema.array();
    if (action === "requirements") return requirementSchema.array();
    const schema =
      resource === "clients"
        ? clientSchema
        : resource === "venues"
          ? venueSchema
          : eventSchema;
    return !id && method === "GET" ? schema.array() : schema;
  }
  if (resource === "reservations") return reservationSchema;
  if (resource === "reservation-conflicts") return conflictSchema;
  // Proposals (FLOW-122/123): the event's list, the upload ticket, and otherwise
  // the proposal with its versions and stage history.
  if (resource === "proposals") {
    if (!id && method === "GET") return proposalSchema.array();
    if (action === "versions" && !path.split("/")[5])
      return proposalUploadTicketSchema;
    return proposalDetailSchema;
  }
  if (resource === "settings") {
    if (!id) return businessSettingsSchema;
    if (id === "history") return settingsHistoryEntrySchema.array();
    if (id === "company") return companyProfileSchema;
    if (id === "defaults") return businessDefaultsSchema;
    if (id === "lists" && path.split("/")[5] === "order")
      return listValueSchema.array();
    return listValueSchema;
  }
  if (resource === "imports") {
    if (id === "modules")
      return action ? importModuleSchema : importModuleSchema.array();
    if (id === "dry-run") return importRowPlanSchema.array();
    if (action === "rows") return importBatchResultSchema;
    return !id && method === "GET" ? importLogSchema.array() : importLogSchema;
  }
  if (resource === "staff")
    return !id ? staffMemberSchema.array() : staffMemberSchema;
  // Notification center and email settings (FLOW-43).
  if (resource === "notifications") {
    if (id === "preferences") return notificationPreferenceSchema.array();
    if (action === "read") return notificationSchema;
    return notificationInboxSchema;
  }
  // Tasks (FLOW-58): every write answers with the whole task.
  if (resource === "tasks")
    return !id && method === "GET" ? taskSummarySchema.array() : taskSchema;
  // Approval requests (FLOW-44): every decision answers with the whole request.
  if (resource === "approvals")
    return !id ? approvalRequestSchema.array() : approvalRequestSchema;
  throw new Error(`Missing shared response contract for ${method} ${path}`);
}
