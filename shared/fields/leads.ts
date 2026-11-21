import { canSeeField } from "../visibility";
import { leadChannelLabels } from "../leads";
import { pipelineLabels } from "../pipeline";
import { nested, type SourceDef } from "./types";

const pipeline = { labels: pipelineLabels, copyId: "labels.pipeline-status", pill: true };

export const leadFields: SourceDef = {
  key: "leads",
  label: "Leads",
  readAction: "leads.read",
  listPath: "/api/leads",
  detailPath: (id) => `/api/leads/${encodeURIComponent(id)}`,
  recordRoute: (row) => (typeof row.id === "string" ? `/leads/${row.id}` : null),
  titleField: "name",
  relations: [
    {
      key: "events",
      label: "Events",
      source: "events",
      path: (id) => `/api/leads/${encodeURIComponent(id)}/events`,
    },
  ],
  fields: [
    { key: "name", label: "Client", type: "text", required: true, editable: true, sortable: true, filterable: true },
    { key: "status", label: "Status", type: "status", options: pipeline, sortable: true, filterable: true },
    { key: "eventName", label: "Event", type: "text", editable: true, sortable: true, filterable: true },
    { key: "eventDate", label: "Event date", type: "date", editable: true, sortable: true, filterable: true },
    { key: "guestCount", label: "Guests", type: "number", sortable: true, filterable: true },
    { key: "eventType", label: "Event type", type: "text", sortable: true, filterable: true },
    { key: "location", label: "Location", type: "text", sortable: true, filterable: true },
    {
      key: "email",
      label: "Email",
      type: "text",
      editable: true,
      read: (actor) => canSeeField(actor, "lead_contact"),
      filterable: true,
    },
    {
      key: "phone",
      label: "Phone",
      type: "text",
      editable: true,
      read: (actor) => canSeeField(actor, "lead_contact"),
      filterable: true,
    },
    {
      key: "budgetCents",
      label: "Budget",
      type: "money",
      // Financials: managers, and a salesperson on their own leads.
      read: (actor, row) =>
        canSeeField(actor, "financials", {
          assignedSalespersonId: row ? (row.assignedSalespersonId as string | null) : actor.userId,
        }),
      sortable: true,
    },
    { key: "source", label: "Source", type: "text", sortable: true, filterable: true },
    {
      key: "channel",
      label: "Channel",
      type: "status",
      options: { labels: leadChannelLabels, copyId: "labels.lead-channel" },
      sortable: true,
      filterable: true,
    },
    { key: "assignedSalespersonId", label: "Owner", type: "person", sortable: true, filterable: true },
    { key: "message", label: "Message", type: "text" },
    {
      key: "latestProposal",
      label: "Proposal",
      type: "link",
      href: (row) => {
        const proposal = row.latestProposal as { id?: string; eventId?: string } | null | undefined;
        return proposal?.eventId ? `/events/${proposal.eventId}?proposal=${proposal.id}` : null;
      },
    },
    {
      key: "latestEvent",
      label: "Latest event",
      type: "link",
      href: (row) => (nested(row, "latestEvent") ? `/events/${nested(row, "latestEvent")}` : null),
    },
    { key: "needsReview", label: "Needs review", type: "boolean", filterable: true },
    { key: "receivedAt", label: "Received", type: "datetime", sortable: true, filterable: true },
    { key: "firstRespondedAt", label: "First response", type: "datetime", sortable: true, filterable: true },
    { key: "lostReason", label: "Lost reason", type: "text" },
    { key: "createdAt", label: "Created", type: "datetime", sortable: true, filterable: true },
    { key: "updatedAt", label: "Last updated", type: "datetime", sortable: true, filterable: true },
  ],
};
