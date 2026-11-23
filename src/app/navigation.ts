import type { Actor } from "../../shared/access";
import { can, type Action } from "../../shared/policy";

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
// hidden. Its copyId is the Dashboard's, so the name is edited in one place.
const withOverview = (to: string, tabs: NavTab[]): NavTab[] => [
  { copyId: "overview", name: "Overview", to, visible: (actor) => tabs.some((tab) => canSee(tab, actor)) },
  ...tabs,
];

export const navigationGroups: NavGroup[] = [
  {
    copyId: "dashboard",
    name: "Dashboard",
    tabs: [
      { copyId: "overview", name: "Overview", to: "/" },
      { copyId: "tasks", name: "Tasks", to: "/tasks", visible: "tasks.read" },
      { copyId: "day-of", name: "Day-of", to: "/day-of", visible: "dayof.read" },
      { copyId: "approvals", name: "Approvals", to: "/approvals", visible: "approvals.read" },
    ],
  },
  {
    copyId: "sales",
    name: "Sales",
    tabs: withOverview("/sales/overview", [
      { copyId: "leads", name: "Leads", to: "/leads", visible: "leads.read" },
      { copyId: "clients", name: "Clients", to: "/clients", visible: "clients.read" },
      { copyId: "proposals", name: "Proposals", to: "/proposals", visible: "proposals.read" },
      // The Sales tracker moved off /proposals (FLOW-276); its reports sit below it.
      { copyId: "sales-tracker", name: "Sales tracker", to: "/sales", visible: "proposals.read" },
      { copyId: "venues", name: "Venues", to: "/venues", visible: "venues.read" },
    ]),
  },
  {
    copyId: "events",
    name: "Events",
    tabs: [
      { copyId: "calendar", name: "Calendar", to: "/calendar", also: ["/events"], visible: "events.read" },
      // Every event's BEO (FLOW-265).
      { copyId: "beos", name: "BEOs", to: "/beos", visible: "beos.read" },
      { copyId: "production", name: "Production", to: "/production", visible: "production.read" },
      { copyId: "day-of", name: "Day-of", to: "/day-of", visible: "dayof.read" },
    ],
  },
  {
    copyId: "staffing",
    name: "Staffing",
    tabs: [
      { copyId: "schedule", name: "Schedule", to: "/staffing/schedule", visible: "staff.read" },
      { copyId: "staff-directory", name: "Staff directory", to: "/staff", visible: "staff.read" },
      { copyId: "sops", name: "SOPs", to: "/sops", visible: "sops.read" },
    ],
  },
  {
    copyId: "inventory",
    name: "Inventory",
    tabs: [
      { copyId: "inventory", name: "Inventory", to: "/inventory", also: ["/kitchen/orders"], visible: "inventory.read" },
      // Bar stock has its own tab (FLOW-266); its address stays /inventory/bar.
      { copyId: "bar", name: "Bar", to: "/inventory/bar", visible: "inventory.read" },
      // Order lists live under Purchasing (FLOW-266).
      { copyId: "purchasing", name: "Purchasing", to: "/purchasing", also: ["/inventory/orders"], visible: "inventory.read" },
      { copyId: "vendors", name: "Vendors", to: "/vendors", visible: "vendors.read" },
      // Each importer needs its own permission (FLOW-47): inventory or leads.
      {
        copyId: "imports",
        name: "Imports",
        to: "/imports",
        visible: (actor) => can(actor, "inventory.write") || can(actor, "leads.update"),
      },
    ],
  },
  {
    copyId: "kitchen",
    name: "Kitchen",
    tabs: [
      { copyId: "recipes", name: "Recipes", to: "/recipes", visible: "recipes.read" },
      { copyId: "ingredients", name: "Ingredients", to: "/inventory/ingredients", visible: "inventory.read" },
    ],
  },
  // The Photos tab (FLOW-271) keeps the old Marketing tab's URL.
  {
    copyId: "marketing",
    name: "Marketing",
    tabs: withOverview("/marketing/overview", [{ copyId: "photos", name: "Photos", to: "/marketing" }]),
  },
  {
    copyId: "documents",
    name: "Documents",
    tabs: withOverview("/documents/overview", [{ copyId: "documents", name: "Documents", to: "/documents" }]),
  },
  {
    copyId: "reports",
    name: "Reports",
    tabs: withOverview("/reports/overview", [
      { copyId: "time-tracking", name: "Time tracking", to: "/reports", visible: "time.read" },
      { copyId: "operational-reports", name: "Operational reports", to: "/reports/operations", visible: "reports.operations.read" },
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
  "/events": { copyId: "all-events", label: "All events" },
  "/leads/dashboard": { copyId: "lead-dashboard", label: "Lead dashboard" },
  "/tasks/all": { copyId: "all-tasks", label: "All tasks" },
  "/tasks/templates": { copyId: "templates", label: "Templates" },
  "/sops/new": { copyId: "new-sop", label: "New SOP" },
  "/sales/reports": { copyId: "sales-reports", label: "Sales reports" },
  "/inventory/master": { copyId: "master-inventory", label: "Master inventory" },
  "/inventory/orders": { copyId: "order-lists", label: "Order lists" },
  "/inventory/bar": { copyId: "bar", label: "Bar" },
  "/inventory/supplies": { copyId: "supplies", label: "Supplies" },
  "/inventory/low-stock": { copyId: "low-stock", label: "Low stock" },
  "/inventory/counts": { copyId: "stock-counts", label: "Stock counts" },
  "/inventory/sections": { copyId: "sections", label: "Sections" },
  "/kitchen/orders": { copyId: "kitchen-orders", label: "Kitchen orders" },
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
  "/imports": { copyId: "import", label: "Import" },
};
// Pages below a record, e.g. an event's BEO.
const recordChildren: Record<string, NavLabel> = { beo: { copyId: "beo", label: "BEO" } };

export function canSee(tab: NavTab, actor: Actor | null) {
  if (!tab.visible) return true;
  if (!actor) return false;
  return typeof tab.visible === "function" ? tab.visible(actor) : can(actor, tab.visible);
}
export const visibleTabs = (group: NavGroup, actor: Actor | null) =>
  group.tabs.filter((tab) => canSee(tab, actor));
// Headings with no tab the user may open are hidden (FLOW-246 AC4).
export const visibleGroups = (actor: Actor | null) =>
  navigationGroups
    .map((group) => ({ ...group, tabs: visibleTabs(group, actor) }))
    .filter((group) => group.tabs.length > 0);

const owns = (prefix: string, pathname: string) =>
  prefix === "/" ? pathname === "/" : pathname === prefix || pathname.startsWith(`${prefix}/`);

export type NavMatch = { group: NavGroup; tab: NavTab; prefix: string };
// The heading and tab a URL belongs to: the longest owned prefix wins, so
// /inventory/ingredients is Kitchen › Ingredients, not Inventory. Day-of sits
// under two headings; `preferredGroup` (the heading it was opened from) decides,
// and otherwise the first heading does.
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
    if (subPages[next]) {
      crumbs.push({ ...subPages[next], to: next });
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
