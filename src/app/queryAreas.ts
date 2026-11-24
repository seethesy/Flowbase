import type { QueryKey } from "@tanstack/react-query";
import type { ChangeArea } from "../../shared/realtime";
import type { SourceKey } from "../../shared/fields";

// Which areas each cached query shows (FLOW-304), so a "changed" ping or a save
// in this browser refetches only the queries its areas cover. A query key's
// first segment names its data; this maps it to the areas a change to which
// can alter what it shows. A screen that combines several parts of the app
// lists all of them.
//
// A key not listed here (or a key that isn't a string) is refetched on every
// change, as every query was before areas existed: adding a new kind of query
// can never leave a screen stale, only refresh it more often than it needs.
const eventPlanning: ChangeArea[] = ["events", "inventory", "tasks", "kitchen", "vendors", "production"];
const eventPaperwork: ChangeArea[] = ["events", "kitchen", "inventory", "staff", "clients", "proposals"];
const production: ChangeArea[] = ["production", "events", "tasks", "inventory", "staff", "kitchen"];
const proposals: ChangeArea[] = ["proposals", "approvals", "events", "sales"];

export const QUERY_AREAS: Record<string, readonly ChangeArea[]> = {
  "admin-users": ["users", "staff"],
  "approval-queue": ["approvals", "proposals", "events"],
  attachments: ["documents"],
  beo: eventPaperwork,
  beos: eventPaperwork,
  "beo-page-event": eventPaperwork,
  calendar: ["events", "leads", "tasks", "staff", "clients"],
  clients: ["clients"],
  "collector-health": ["leads", "communications", "settings"],
  communications: ["communications"],
  "cost-history": ["inventory", "vendors"],
  counts: ["inventory"],
  "day-of-log": ["events"],
  "document-link-search": ["documents"],
  "document-sop-search": ["documents"],
  documents: ["documents"],
  "event-addendums": proposals,
  "event-bar-plan": eventPlanning,
  "event-beo": eventPaperwork,
  "event-closeout": ["events", "inventory"],
  "event-conflicts": eventPlanning,
  "event-contracts": proposals,
  "event-history": ["events"],
  "event-holds": eventPlanning,
  "event-hub": ["events", "clients", "proposals", "approvals", "tasks", "inventory", "staff", "kitchen", "documents", "production"],
  "event-kitchen-menu": ["events", "kitchen", "inventory"],
  "event-payments": ["events", "proposals"],
  "event-planning-progress": eventPlanning,
  "event-proposals": proposals,
  "event-pull-list": eventPlanning,
  "event-rental-requests": eventPlanning,
  "event-requirements": eventPlanning,
  "event-staff": ["events", "staff"],
  "event-status-history": ["events"],
  "event-timeline": ["events", "staff", "tasks"],
  "event-trucks": ["events", "staff", "inventory"],
  events: ["events", "clients"],
  "free-tier-usage": ["settings"],
  "google-calendar": ["events", "settings"],
  inventory: ["inventory"],
  "inventory-allocations": eventPlanning,
  "inventory-availability": eventPlanning,
  "inventory-categories": ["inventory"],
  "inventory-conflicts": eventPlanning,
  "inventory-items": ["inventory", "vendors"],
  "inventory-pending": ["inventory"],
  "inventory-sections": ["inventory"],
  "kitchen-overview": ["kitchen", "events", "inventory", "tasks"],
  "lead-beos": ["leads", "events"],
  "lead-dashboard": ["leads", "events", "proposals"],
  "lead-events": ["leads", "events"],
  "lead-owners": ["users", "staff"],
  leads: ["leads"],
  movements: ["inventory"],
  "offline-beo": eventPaperwork,
  "offline-beos": eventPaperwork,
  "offline-copy": eventPaperwork,
  "open-addendums": proposals,
  "order-list": ["inventory", "vendors"],
  "order-lists": ["inventory", "vendors"],
  permissions: ["settings"],
  "photo-upload-events": ["documents", "events"],
  photos: ["documents", "events"],
  "production-event": production,
  "production-overview": production,
  "production-readiness": production,
  proposal: proposals,
  "proposal-linked-lead": [...proposals, "leads"],
  "proposal-mapping": proposals,
  proposals,
  recipes: ["kitchen", "inventory"],
  sales: ["sales", "proposals", "events", "leads", "clients"],
  sections: ["inventory"],
  "settings-history": ["settings"],
  "sms-outbox": ["leads", "communications", "settings"],
  sops: ["documents"],
  staff: ["staff", "users", "time"],
  "staff-pay": ["staff", "time"],
  tasks: ["tasks", "events"],
  "time-report": ["time", "staff"],
  "ui-copy": ["copy"],
  "ui-copy-orphans": ["copy", "layout"],
  "ui-layout": ["layout"],
  vendors: ["vendors", "inventory"],
  "venue-events": ["clients", "events"],
  venues: ["clients"],
};

// The areas a custom card's rows come from (key ["layout-card", source, ...]).
export const SOURCE_AREAS: Record<SourceKey, readonly ChangeArea[]> = {
  documents: ["documents"],
  "working-staff": ["time", "staff", "tasks"],
  sops: ["documents"],
  recipes: ["kitchen", "inventory"],
  leads: ["leads"],
  events: ["events", "clients"],
  clients: ["clients"],
  proposals,
  tasks: ["tasks", "events"],
  inventory: ["inventory", "vendors"],
  staff: ["staff", "users"],
  venues: ["clients"],
  vendors: ["vendors", "inventory"],
};

// The areas a query shows, or null when any change may alter it.
export function queryAreas(key: QueryKey): readonly ChangeArea[] | null {
  const [first, second] = key;
  if (typeof first !== "string") return null;
  if (first === "layout-card")
    return typeof second === "string" ? (SOURCE_AREAS[second as SourceKey] ?? null) : null;
  return Object.prototype.hasOwnProperty.call(QUERY_AREAS, first) ? QUERY_AREAS[first] : null;
}

// Does a change to these areas (null: unknown, anything) affect the query?
// A settings change (roles and permissions among them) can change what every
// screen shows, so it affects them all.
export function affectedBy(key: QueryKey, areas: readonly ChangeArea[] | null): boolean {
  if (!areas || areas.includes("settings")) return true;
  const shown = queryAreas(key);
  return !shown || shown.some((area) => areas.includes(area));
}
