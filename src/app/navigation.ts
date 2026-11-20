import type { Actor } from "../../shared/access";
import { can, type Action } from "../../shared/policy";

// The app's navigation map (FLOW-246). The sidebar headings, the tabs at the top
// of each heading's pages and the header breadcrumb (FLOW-247) all read it, so a
// page moves in one place. UI convenience only: the API enforces permissions.

type Visibility = Action | ((actor: Actor) => boolean);
export type NavTab = {
  name: string;
  to: string;
  // Other URL prefixes this tab owns, e.g. event pages live under Calendar.
  also?: string[];
  visible?: Visibility;
};
export type NavGroup = { name: string; tabs: NavTab[] };

export const navigationGroups: NavGroup[] = [
  {
    name: "Dashboard",
    tabs: [
      { name: "Overview", to: "/" },
      { name: "Tasks", to: "/tasks", visible: "tasks.read" },
      { name: "Day-of", to: "/day-of", visible: "events.read" },
      { name: "Approvals", to: "/approvals", visible: "approvals.read" },
    ],
  },
  {
    name: "Sales",
    tabs: [
      { name: "Leads", to: "/leads", visible: "leads.read" },
      { name: "Clients", to: "/clients", visible: "clients.read" },
      { name: "Proposals", to: "/proposals", also: ["/sales"], visible: "proposals.read" },
      { name: "Venues", to: "/venues", visible: "venues.read" },
    ],
  },
  {
    name: "Events",
    tabs: [
      { name: "Calendar", to: "/calendar", also: ["/events"], visible: "events.read" },
      { name: "Production", to: "/production", visible: "events.read" },
      { name: "Day-of", to: "/day-of", visible: "events.read" },
    ],
  },
  {
    name: "Staffing",
    tabs: [
      { name: "Schedule", to: "/staffing/schedule", visible: "staff.read" },
      { name: "Staff directory", to: "/staff", visible: "staff.read" },
      { name: "SOPs", to: "/sops", visible: "sops.read" },
    ],
  },
  {
    name: "Inventory",
    tabs: [
      { name: "Inventory", to: "/inventory", also: ["/kitchen/orders"], visible: "inventory.read" },
      { name: "Purchasing", to: "/purchasing", visible: "inventory.read" },
      { name: "Vendors", to: "/vendors", visible: "inventory.read" },
      // Each importer needs its own permission (FLOW-47): inventory or leads.
      {
        name: "Imports",
        to: "/imports",
        visible: (actor) => can(actor, "inventory.write") || can(actor, "leads.update"),
      },
    ],
  },
  {
    name: "Kitchen",
    tabs: [
      { name: "Recipes", to: "/recipes", visible: "recipes.read" },
      { name: "Ingredients", to: "/inventory/ingredients", visible: "inventory.read" },
    ],
  },
  { name: "Marketing", tabs: [{ name: "Marketing", to: "/marketing" }] },
  { name: "Documents", tabs: [{ name: "Documents", to: "/documents" }] },
  {
    name: "Reports",
    tabs: [
      { name: "Time tracking", to: "/reports", visible: "time.read" },
      { name: "Operational reports", to: "/reports/operations", visible: "reports.operations.read" },
    ],
  },
];

// Pages outside the headings: the bottom of the sidebar and the profile link.
const otherPages: Record<string, string> = {
  "/settings": "Settings",
  "/help": "Help & resources",
  "/profile": "Employee profile",
};

// Pages below a tab that aren't records.
const subPages: Record<string, string> = {
  "/events": "All events",
  "/leads/dashboard": "Lead dashboard",
  "/tasks/all": "All tasks",
  "/tasks/templates": "Templates",
  "/sops/new": "New SOP",
  "/sales/reports": "Sales reports",
  "/inventory/master": "Master inventory",
  "/inventory/orders": "Order lists",
  "/inventory/bar": "Bar",
  "/inventory/supplies": "Supplies",
  "/inventory/low-stock": "Low stock",
  "/inventory/counts": "Stock counts",
  "/inventory/sections": "Sections",
  "/kitchen/orders": "Kitchen orders",
  "/recipes/client": "Client recipe book",
  "/settings/users": "Users",
  "/settings/collector": "Collector health",
  "/settings/usage": "Usage",
  "/settings/operations": "Operations",
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
const recordNouns: Record<RecordKind, string> = {
  clients: "Client",
  leads: "Lead",
  events: "Event",
  venues: "Venue",
  vendors: "Vendor",
  inventory: "Item",
  recipes: "Recipe",
  staff: "Staff member",
};
const recordBases: Record<string, RecordKind | { label: string }> = {
  "/clients": "clients",
  "/leads": "leads",
  "/events": "events",
  "/venues": "venues",
  "/vendors": "vendors",
  "/inventory": "inventory",
  "/recipes": "recipes",
  "/staff": "staff",
  "/tasks": { label: "Task" },
  "/sops": { label: "SOP" },
  "/inventory/counts": { label: "Stock count" },
  "/inventory/orders": { label: "Order list" },
  "/imports": { label: "Import" },
};
// Pages below a record, e.g. an event's BEO.
const recordChildren: Record<string, string> = { beo: "BEO" };

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
  const crumbs: Crumb[] = [{ label: "Workspace", to: "/" }];
  const match = matchNavigation(path, preferredGroup);
  let covered: string;
  if (match) {
    // Without a signed-in user (tests, sign-in) every tab is listed.
    const tabs = actor ? visibleTabs(match.group, actor) : match.group.tabs;
    crumbs.push({ label: match.group.name, to: (tabs[0] ?? match.tab).to });
    if (match.group.tabs.length > 1) crumbs.push({ label: match.tab.name, to: match.tab.to });
    covered = match.prefix;
    // A tab's other list page, e.g. All events under Calendar. Its records skip
    // it: Events / Calendar / <event>.
    if (match.prefix !== match.tab.to && path === match.prefix && subPages[path])
      crumbs.push({ label: subPages[path], to: path });
  } else {
    const other = Object.keys(otherPages).find((prefix) => owns(prefix, path));
    if (!other) return finish([...crumbs, { label: "Page not found" }]);
    crumbs.push({ label: otherPages[other], to: other });
    covered = other;
  }
  const rest = path.slice(covered === "/" ? 1 : covered.length + 1).split("/").filter(Boolean);
  let base = covered;
  for (let index = 0; index < rest.length; index += 1) {
    const segment = rest[index];
    const next = `${base}/${segment}`;
    if (subPages[next]) {
      crumbs.push({ label: subPages[next], to: next });
      base = next;
      continue;
    }
    const kind = recordBases[base];
    if (kind) {
      const id = decodeURIComponent(segment);
      crumbs.push(
        typeof kind === "string"
          ? { label: recordNouns[kind], to: next, record: { kind, id } }
          : { label: kind.label, to: next },
      );
      // An event's BEO: /events/:id/beo/:beoId shows as "<event> / BEO".
      const child = rest[index + 1] && recordChildren[rest[index + 1]];
      if (child) crumbs.push({ label: child, to: `${next}/${rest[index + 1]}` });
      break;
    }
    break;
  }
  return finish(crumbs);
}
const finish = (crumbs: Crumb[]) =>
  crumbs.map((crumb, index) => (index === crumbs.length - 1 ? { ...crumb, to: undefined } : crumb));
