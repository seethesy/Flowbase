import type { Actor } from "../../shared/access";
import { can, type Action } from "../../shared/policy";
import { navHidden, navHides } from "../../shared/nav-visibility";
import { canSeePayments } from "../../shared/visibility";

// The app's navigation map (FLOW-246). The sidebar headings, the tabs at the top
// of each heading's pages and the header breadcrumb (FLOW-247) all read it, so a
// page moves in one place. UI convenience only: the API enforces permissions.

type Visibility = Action | ((actor: Actor) => boolean);
// A page's name for people. Its wording key is nav.<copyId> (FLOW-277): the id is
// fixed, so renaming the name in code keeps the Admin's saved wording. Never
// change a copyId; to retire one, list it in shared/live-edit-renames.ts.
export type NavLabel = { copyId: string; label: string };
export type NavTab = {
  copyId: string;
  name: string;
  to: string;
  // Other URL prefixes this tab owns, e.g. event pages live under Calendar.
  also?: string[];
  visible?: Visibility;
};
export type NavGroup = { copyId: string; name: string; tabs: NavTab[] };

// The wording key of a nav name (FLOW-240, FLOW-277).
export const navKey = (copyId: string) => `nav.${copyId}`;

// The Overview tab that opens a heading (FLOW-295): shown to anyone who may
// open another tab under it, so a heading with nothing else for a role stays
// hidden. That counts the role's hidden tabs (FLOW-284) as closed. Its copyId is
// the Dashboard's, so the name is edited in one place.
const withOverview = (groupId: string, to: string, tabs: NavTab[]): NavTab[] => [
  {
    copyId: "overview",
    name: "Overview",
    to,
    visible: (actor) => tabs.some((tab) => canSee(tab, actor) && !navHides(navHidden(), actor.role, groupId, tab.copyId)),
  },
  ...tabs,
];

export const navigationGroups: NavGroup[] = [
  {
    copyId: "dashboard",
    name: "Dashboard",
    tabs: [
      { copyId: "overview", name: "Overview", to: "/" },
      { copyId: "tasks", name: "Tasks", to: "/tasks", visible: "tasks.read" },
      { copyId: "approvals", name: "Approvals", to: "/approvals", visible: "approvals.read" },
    ],
  },
  // FLOW-328: getting and pitching leads (Leads) and closing them (Sales) have
  // their own headings. Leads › Overview is the leads table at /leads, limited to
  // the early stages; Sales › Overview lists the late ones. Who saw the old
  // Sales › Leads and Sales › Proposals tabs moved with them (migration 0083).
  {
    copyId: "leads",
    name: "Leads",
    tabs: [
      { copyId: "overview", name: "Overview", to: "/leads", visible: "leads.read" },
      { copyId: "proposals", name: "Proposals", to: "/proposals", visible: "proposals.read" },
      { copyId: "contracts", name: "Contracts", to: "/leads/contracts", visible: "proposals.read" },
      { copyId: "payment", name: "Payment", to: "/leads/payment", visible: (actor) => can(actor, "events.read") && canSeePayments(actor, { assignedSalespersonId: actor.userId }) },
      { copyId: "beos", name: "BEO", to: "/beos", visible: "beos.read" },
    ],
  },
  {
    copyId: "sales",
    name: "Sales",
    tabs: withOverview("sales", "/sales/overview", [
      { copyId: "clients", name: "Clients", to: "/clients", visible: "clients.read" },
      // The Sales tracker moved off /proposals (FLOW-276); its reports sit below it.
      { copyId: "sales-tracker", name: "Sales tracker", to: "/sales", visible: "proposals.read" },
      { copyId: "venues", name: "Venues", to: "/venues", visible: "venues.read" },
      // The price list salespeople quote from (FLOW-329).
      { copyId: "pricing", name: "Pricing", to: "/sales/pricing", visible: "proposals.read" },
      { copyId: "time-tracking", name: "Time Tracking", to: "/sales/time-tracking", visible: (actor) => can(actor, "time.read") || can(actor, "reports.operations.read") },
    ]),
  },
  {
    copyId: "events",
    name: "Events",
    // The calendar with its events table is the Overview (FLOW-294); /calendar
    // and the removed Day-of board redirect to it.
    tabs: [
      { copyId: "overview", name: "Overview", to: "/events/overview", also: ["/events"], visible: "events.read" },
      // Every event's BEO (FLOW-265).
      { copyId: "production", name: "Production", to: "/production", visible: "production.read" },
    ],
  },
  {
    copyId: "staffing",
    name: "Staffing",
    tabs: [
      { copyId: "schedule", name: "Schedule", to: "/staffing/schedule", visible: "staff.read" },
      { copyId: "staff-directory", name: "Staff directory", to: "/staff", visible: "staff.read" },
      { copyId: "sops", name: "SOPs", to: "/sops", visible: "sops.read" },
      // Pay (FLOW-270): Admin and Technical by default (the Staff pay area).
      { copyId: "payroll", name: "Payroll", to: "/staffing/payroll", visible: "staff.pay.read" },
    ],
  },
  {
    copyId: "inventory",
    name: "Inventory",
    tabs: [
      // FLOW-291: Inventory | Bar Inventory | Order | Vendors (and Photos, FLOW-298).
      { copyId: "inventory", name: "Inventory", to: "/inventory", visible: "inventory.read" },
      // Bar stock's tab keeps its address, /inventory/bar, and its key "bar"
      // (saved wording and who sees it, FLOW-284) now it reads Bar Inventory.
      { copyId: "bar", name: "Bar Inventory", to: "/inventory/bar", visible: "inventory.read" },
      // Ordering (FLOW-292): order lists, approvals and what needs reordering.
      // Replaces Purchasing and Low stock.
      { copyId: "order", name: "Order", to: "/inventory/order", also: ["/inventory/orders"], visible: "inventory.read" },
      { copyId: "vendors", name: "Vendors", to: "/vendors", visible: "vendors.read" },
      // Inventory photos (FLOW-298).
      { copyId: "photos", name: "Photos", to: "/inventory/photos", visible: "inventory.read" },
    ],
  },
  {
    copyId: "kitchen",
    name: "Kitchen",
    // Kitchen opens on its Overview (FLOW-293): the next 14 days' menu items.
    tabs: [
      { copyId: "overview", name: "Overview", to: "/kitchen/overview", visible: (actor) => can(actor, "events.read") && can(actor, "recipes.read") },
      { copyId: "recipes", name: "Recipes", to: "/recipes", visible: "recipes.read" },
      // Kitchen Ingredients (FLOW-289/291) are only under Kitchen.
      { copyId: "ingredients", name: "Ingredients", to: "/kitchen/ingredients", visible: "recipes.read" },
      // Every menu PDF (FLOW-267): Documents of type Menu and the client recipe book.
      { copyId: "menus", name: "Menus", to: "/kitchen/menus", visible: "recipes.read" },
      // Kitchen photos (FLOW-298).
      { copyId: "photos", name: "Photos", to: "/kitchen/photos", visible: "recipes.read" },
    ],
  },
  // Marketing › Photos (FLOW-271) keeps the old Marketing tab's URL.
  {
    copyId: "marketing",
    name: "Marketing",
    tabs: withOverview("marketing", "/marketing/overview", [{ copyId: "photos", name: "Photos", to: "/marketing", visible: "marketing.read" }]),
  },
  {
    copyId: "documents",
    name: "Documents",
    tabs: withOverview("documents", "/documents/overview", [
      { copyId: "documents", name: "Documents", to: "/documents" },
      // Template documents only (FLOW-330): hidden from a role the Admin hid the
      // Documents tab from (FLOW-284), and can be hidden on its own too.
      { copyId: "templates", name: "Templates", to: "/documents/templates",
        visible: (actor) => !navHides(navHidden(), actor.role, "documents", "documents") },
    ]),
  },
];

// Pages outside the headings: the bottom of the sidebar and the profile link.
const otherPages: Record<string, NavLabel> = {
  "/settings": { copyId: "settings", label: "Settings" },
  "/help": { copyId: "help-resources", label: "Help & resources" },
  "/profile": { copyId: "employee-profile", label: "Employee profile" },
};

// Pages below a tab that aren't records.
const subPages: Record<string, NavLabel> = {
  "/leads/dashboard": { copyId: "lead-dashboard", label: "Lead dashboard" },
  "/tasks/all": { copyId: "all-tasks", label: "All tasks" },
  "/tasks/templates": { copyId: "templates", label: "Templates" },
  "/sops/new": { copyId: "new-sop", label: "New SOP" },
  "/sales/reports": { copyId: "sales-reports", label: "Sales reports" },
  "/inventory/orders": { copyId: "order-lists", label: "Order lists" },
  "/settings/locations": { copyId: "locations", label: "Locations" },
  "/settings/imports": { copyId: "imports", label: "Imports" },
  "/recipes/client": { copyId: "client-recipe-book", label: "Client recipe book" },
  "/settings/users": { copyId: "users", label: "Users" },
  "/settings/permissions": { copyId: "roles-permissions", label: "Roles & permissions" },
  "/settings/collector": { copyId: "collector-health", label: "Collector health" },
  "/settings/usage": { copyId: "usage", label: "Usage" },
  "/settings/operations": { copyId: "operations", label: "Operations" },
  "/settings/archived": { copyId: "archived", label: "Archived" },
};

// `<base>/<id>` is a record page. Named kinds are looked up for their name; the
// others show a fixed label.
export const namedRecordKinds = [
  "clients",
  "leads",
  "events",
  "venues",
  "vendors",
  "inventory",
  "recipes",
  "staff",
] as const;
export type RecordKind = (typeof namedRecordKinds)[number];
// Shown until the record's name loads, or if it can't.
const recordNouns: Record<RecordKind, NavLabel> = {
  clients: { copyId: "client", label: "Client" },
  leads: { copyId: "lead", label: "Lead" },
  events: { copyId: "event", label: "Event" },
  venues: { copyId: "venue", label: "Venue" },
  vendors: { copyId: "vendor", label: "Vendor" },
  inventory: { copyId: "item", label: "Item" },
  recipes: { copyId: "recipe", label: "Recipe" },
  staff: { copyId: "staff-member", label: "Staff member" },
};
const recordBases: Record<string, RecordKind | NavLabel> = {
  "/clients": "clients",
  "/leads": "leads",
  "/events": "events",
  "/venues": "venues",
  "/vendors": "vendors",
  "/inventory": "inventory",
  "/recipes": "recipes",
  "/staff": "staff",
  "/tasks": { copyId: "task", label: "Task" },
  "/sops": { copyId: "sop", label: "SOP" },
  "/inventory/counts": { copyId: "stock-count", label: "Stock count" },
  "/inventory/orders": { copyId: "order-list", label: "Order list" },
  "/settings/imports": { copyId: "import", label: "Import" },
};
// Path segments with no page of their own: count mode (/inventory/counts/:id)
// sits under Inventory now the Counts list is gone (FLOW-291).
const passThrough = new Set(["/inventory/counts"]);
// Pages below a record, e.g. an event's BEO.
const recordChildren: Record<string, NavLabel> = { beo: { copyId: "beo", label: "BEO" } };

// The tab's own rule: its area permission or `visible` check.
export function canSee(tab: NavTab, actor: Actor | null) {
  if (!tab.visible) return true;
  if (!actor) return false;
  return typeof tab.visible === "function" ? tab.visible(actor) : can(actor, tab.visible);
}
// Whether the Admin hid this tab, or its heading, from the actor's role in
// Settings › Roles & permissions (FLOW-284). It only narrows: a tab that isn't
// hidden still needs canSee.
export const navHiddenFor = (group: NavGroup, tab: NavTab, actor: Actor | null) =>
  !!actor && navHides(navHidden(), actor.role, group.copyId, tab.copyId);
export const visibleTabs = (group: NavGroup, actor: Actor | null) =>
  group.tabs.filter((tab) => canSee(tab, actor) && !navHiddenFor(group, tab, actor));
// Headings with no tab the user may open are hidden (FLOW-246 AC4).
export const visibleGroups = (actor: Actor | null) =>
  navigationGroups
    .map((group) => ({ ...group, tabs: visibleTabs(group, actor) }))
    .filter((group) => group.tabs.length > 0);

// The first page a role may open: its landing page when the Dashboard's
// Overview is hidden from it (FLOW-284).
export const firstVisiblePage = (actor: Actor | null): string | null =>
  visibleGroups(actor)[0]?.tabs[0]?.to ?? null;

const owns = (prefix: string, pathname: string) =>
  prefix === "/" ? pathname === "/" : pathname === prefix || pathname.startsWith(`${prefix}/`);

export type NavMatch = { group: NavGroup; tab: NavTab; prefix: string };
// The heading and tab a URL belongs to: the longest owned prefix wins, so
// /inventory/orders/<id> is Inventory › Order, not Inventory. A page under
// two headings goes to `preferredGroup` (the heading it was opened from), and
// otherwise to the first heading.
export function matchNavigation(pathname: string, preferredGroup?: string): NavMatch | null {
  let best: NavMatch | null = null;
  for (const group of navigationGroups)
    for (const tab of group.tabs)
      for (const prefix of [tab.to, ...(tab.also ?? [])]) {
        if (!owns(prefix, pathname)) continue;
        const longer = !best || prefix.length > best.prefix.length;
        const preferred =
          best && prefix.length === best.prefix.length && group.name === preferredGroup;
        if (longer || preferred) best = { group, tab, prefix };
      }
  return best;
}

// Whether every heading and tab that owns a page is hidden from the actor's role
// (FLOW-284). A page under two headings stays open while one still shows it.
export function pageHiddenFrom(match: NavMatch, actor: Actor | null) {
  if (!actor) return false;
  const owners = navigationGroups.flatMap((group) =>
    group.tabs
      .filter((tab) => [tab.to, ...(tab.also ?? [])].includes(match.prefix))
      .map((tab) => ({ group, tab })),
  );
  return owners.every(({ group, tab }) => navHiddenFor(group, tab, actor));
}

export type Crumb = {
  label: string;
  // The label's wording key is nav.<copyId> (FLOW-277).
  copyId: string;
  // Omitted on the last crumb, which is the current page.
  to?: string;
  // A record whose name replaces the label once it loads.
  record?: { kind: RecordKind; id: string };
};

// Workspace / <Heading> / <Tab> / <Record> (FLOW-247). Every crumb but the last
// links to its page.
export function breadcrumbTrail(
  pathname: string,
  actor: Actor | null,
  preferredGroup?: string,
): Crumb[] {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const crumbs: Crumb[] = [{ copyId: "workspace", label: "Workspace", to: "/" }];
  const match = matchNavigation(path, preferredGroup);
  let covered: string;
  // A page hidden from the role names no heading or tab (FLOW-284).
  if (match && pageHiddenFrom(match, actor))
    return finish([...crumbs, { copyId: "not-available", label: "Not available" }]);
  if (match) {
    // Without a signed-in user (tests, sign-in) every tab is listed.
    const tabs = actor ? visibleTabs(match.group, actor) : match.group.tabs;
    crumbs.push({ copyId: match.group.copyId, label: match.group.name, to: (tabs[0] ?? match.tab).to });
    if (match.group.tabs.length > 1) crumbs.push({ copyId: match.tab.copyId, label: match.tab.name, to: match.tab.to });
    covered = match.prefix;
    // A tab's other list page, e.g. All events under Calendar. Its records skip
    // it: Events / Calendar / <event>.
    if (match.prefix !== match.tab.to && path === match.prefix && subPages[path])
      crumbs.push({ ...subPages[path], to: path });
  } else {
    const other = Object.keys(otherPages).find((prefix) => owns(prefix, path));
    if (!other) return finish([...crumbs, { copyId: "page-not-found", label: "Page not found" }]);
    crumbs.push({ ...otherPages[other], to: other });
    covered = other;
  }
  const rest = path.slice(covered === "/" ? 1 : covered.length + 1).split("/").filter(Boolean);
  let base = covered;
  for (let index = 0; index < rest.length; index += 1) {
    const segment = rest[index];
    const next = `${base}/${segment}`;
    if (subPages[next] || passThrough.has(next)) {
      if (subPages[next]) crumbs.push({ ...subPages[next], to: next });
      base = next;
      continue;
    }
    const kind = recordBases[base];
    if (kind) {
      const id = decodeURIComponent(segment);
      crumbs.push(
        typeof kind === "string"
          ? { ...recordNouns[kind], to: next, record: { kind, id } }
          : { ...kind, to: next },
      );
      // An event's BEO: /events/:id/beo/:beoId shows as "<event> / BEO".
      const child = rest[index + 1] && recordChildren[rest[index + 1]];
      if (child) crumbs.push({ ...child, to: `${next}/${rest[index + 1]}` });
      break;
    }
    break;
  }
  return finish(crumbs);
}
const finish = (crumbs: Crumb[]) =>
  crumbs.map((crumb, index) => (index === crumbs.length - 1 ? { ...crumb, to: undefined } : crumb));

// The sidebar's bottom links (Settings, Help).
export const secondaryPages = [
  { copyId: "settings", name: "Settings", to: "/settings" },
  { copyId: "help-resources", name: "Help & resources", to: "/help" },
] as const;
