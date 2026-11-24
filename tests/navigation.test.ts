import { describe, expect, it } from "vitest";
import type { Actor } from "../shared/access";
import {
  breadcrumbTrail,
  matchNavigation,
  navigationGroups,
  navKey,
  visibleGroups,
} from "../src/app/navigation";
import { copySlug } from "../shared/copy";

// FLOW-246 (sidebar headings and tabs) and FLOW-247 (breadcrumb mapping).
const actor = (role: Actor["role"], employmentType: Actor["employmentType"] = "full_time"): Actor => ({
  userId: "38000000-0000-4000-8000-000000000001",
  role,
  employmentType,
});
const admin = actor("admin");
const salesperson = actor("salesperson");
const staff = actor("part_time_staff");

const headings = (who: Actor) => visibleGroups(who).map((group) => group.name);
const tabs = (who: Actor, heading: string) =>
  visibleGroups(who).find((group) => group.name === heading)?.tabs.map((tab) => tab.name);
// Labels and links, e.g. "Sales>/leads".
const trail = (path: string, who: Actor | null = admin, from?: string) =>
  breadcrumbTrail(path, who, from).map((crumb) => (crumb.to ? `${crumb.label}>${crumb.to}` : crumb.label));

describe("navigation groups", () => {
  it("lists exactly the nine headings with their tabs in order (AC1)", () => {
    expect(navigationGroups.map((group) => group.name)).toEqual([
      "Dashboard", "Sales", "Events", "Staffing", "Inventory", "Kitchen", "Marketing", "Documents", "Reports",
    ]);
    expect(headings(admin)).toHaveLength(9);
    expect(tabs(admin, "Dashboard")).toEqual(["Overview", "Tasks", "Approvals"]);
    expect(tabs(admin, "Sales")).toEqual(["Overview", "Leads", "Clients", "Proposals", "Sales tracker", "Venues"]);
    expect(tabs(admin, "Events")).toEqual(["Overview", "BEOs", "Production"]);
    expect(tabs(admin, "Staffing")).toEqual(["Schedule", "Staff directory", "SOPs", "Payroll"]);
    expect(tabs(admin, "Inventory")).toEqual(["Inventory", "Bar Inventory", "Order", "Vendors", "Photos"]);
    expect(tabs(admin, "Kitchen")).toEqual(["Overview", "Recipes", "Ingredients", "Menus", "Photos"]);
    expect(tabs(admin, "Marketing")).toEqual(["Overview", "Photos"]);
    expect(tabs(admin, "Documents")).toEqual(["Overview", "Documents"]);
    expect(tabs(admin, "Reports")).toEqual(["Overview", "Time tracking", "Operational reports"]);
  });

  it("hides tabs a role can't open, and headings left with none (AC4)", () => {
    expect(tabs(salesperson, "Sales")).toEqual(["Overview", "Leads", "Clients", "Proposals", "Sales tracker", "Venues"]);
    expect(tabs(salesperson, "Inventory")).toEqual(["Inventory", "Bar Inventory", "Order", "Vendors", "Photos"]);
    expect(tabs(salesperson, "Reports")).toEqual(["Overview", "Time tracking"]);
    // Staff can't read leads, clients or proposals, run imports or see operational reports.
    expect(tabs(staff, "Sales")).toEqual(["Overview", "Venues"]);
    expect(tabs(staff, "Inventory")).toEqual(["Inventory", "Bar Inventory", "Order", "Vendors", "Photos"]);
    expect(tabs(staff, "Reports")).toEqual(["Overview", "Time tracking"]);
    // Payroll is Admin and Technical only (FLOW-270 AC2).
    expect(tabs(staff, "Staffing")).toEqual(["Schedule", "Staff directory", "SOPs"]);
    expect(tabs(salesperson, "Staffing")).toEqual(["Schedule", "Staff directory", "SOPs"]);
    expect(tabs(actor("technical"), "Staffing")).toEqual(["Schedule", "Staff directory", "SOPs", "Payroll"]);
    expect(headings(staff)).toHaveLength(9);
    // Signed out, only pages that need no permission remain.
    expect(visibleGroups(null).map((group) => group.name)).toEqual(["Dashboard", "Documents"]);
  });

  it("keeps existing URLs under their heading, including record pages", () => {
    const at = (path: string, from?: string) => {
      const match = matchNavigation(path, from);
      return match && `${match.group.name} › ${match.tab.name}`;
    };
    expect(at("/")).toBe("Dashboard › Overview");
    expect(at("/tasks/all")).toBe("Dashboard › Tasks");
    expect(at("/leads")).toBe("Sales › Leads");
    expect(at("/leads/abc")).toBe("Sales › Leads");
    expect(at("/clients/cli-1")).toBe("Sales › Clients");
    expect(at("/proposals")).toBe("Sales › Proposals");
    expect(at("/sales/reports")).toBe("Sales › Sales tracker");
    expect(at("/events/e-1/beo/b-1")).toBe("Events › Overview");
    // FLOW-294: the calendar is Events › Overview; FLOW-293: Kitchen › Overview.
    expect(at("/events/overview")).toBe("Events › Overview");
    expect(at("/kitchen/overview")).toBe("Kitchen › Overview");
    expect(at("/beos")).toBe("Events › BEOs");
    expect(at("/inventory/counts/c-1")).toBe("Inventory › Inventory");
    // FLOW-291/292: Bar Inventory is its own tab; order lists sit under Order;
    // Ingredients are only under Kitchen.
    expect(at("/inventory/bar")).toBe("Inventory › Bar Inventory");
    expect(at("/inventory/order")).toBe("Inventory › Order");
    expect(at("/inventory/orders/o-1")).toBe("Inventory › Order");
    expect(at("/kitchen/ingredients")).toBe("Kitchen › Ingredients");
    expect(at("/kitchen/menus")).toBe("Kitchen › Menus");
    expect(at("/inventory/photos")).toBe("Inventory › Photos");
    expect(at("/kitchen/photos")).toBe("Kitchen › Photos");
    expect(at("/marketing")).toBe("Marketing › Photos");
    expect(at("/reports/operations")).toBe("Reports › Operational reports");
    // FLOW-295: each heading's Overview, with the old tabs at their URLs.
    expect(at("/sales/overview")).toBe("Sales › Overview");
    expect(at("/sales")).toBe("Sales › Sales tracker");
    expect(at("/marketing/overview")).toBe("Marketing › Overview");
    expect(at("/marketing")).toBe("Marketing › Photos");
    expect(at("/documents/overview")).toBe("Documents › Overview");
    expect(at("/documents")).toBe("Documents › Documents");
    expect(at("/reports/overview")).toBe("Reports › Overview");
    expect(at("/reports")).toBe("Reports › Time tracking");
    expect(at("/settings")).toBeNull();
    // The Day-of board is gone (FLOW-294); /day-of only redirects.
    expect(at("/day-of")).toBeNull();
    expect(at("/calendar")).toBeNull();
  });
});

describe("breadcrumb trail", () => {
  it("builds Workspace / Heading / Tab with every segment but the last linked", () => {
    expect(trail("/approvals")).toEqual(["Workspace>/", "Dashboard>/", "Approvals"]);
    expect(trail("/")).toEqual(["Workspace>/", "Dashboard>/", "Overview"]);
    expect(trail("/leads")).toEqual(["Workspace>/", "Sales>/sales/overview", "Leads"]);
    expect(trail("/kitchen/ingredients")).toEqual(["Workspace>/", "Kitchen>/kitchen/overview", "Ingredients"]);
    expect(trail("/marketing")).toEqual(["Workspace>/", "Marketing>/marketing/overview", "Photos"]);
    expect(trail("/reports/overview")).toEqual(["Workspace>/", "Reports>/reports/overview", "Overview"]);
    expect(trail("/events/overview")).toEqual(["Workspace>/", "Events>/events/overview", "Overview"]);
  });

  it("ends with the record, which the header names once it loads", () => {
    expect(breadcrumbTrail("/leads/lead-1", admin).at(-1)).toEqual({
      copyId: "lead",
      label: "Lead",
      record: { kind: "leads", id: "lead-1" },
    });
    expect(trail("/leads/lead-1")).toEqual(["Workspace>/", "Sales>/sales/overview", "Leads>/leads", "Lead"]);
    for (const [path, kind] of [
      ["/clients/c-1", "clients"],
      ["/venues/v-1", "venues"],
      ["/vendors/v-1", "vendors"],
      ["/inventory/i-1", "inventory"],
      ["/recipes/r-1", "recipes"],
      ["/staff/s-1", "staff"],
    ] as const)
      expect(breadcrumbTrail(path, admin).at(-1)?.record).toEqual({ kind, id: path.split("/")[2] });
  });

  it("shows an event's BEO below the event", () => {
    const crumbs = breadcrumbTrail("/events/e-1/beo/b-1", admin);
    expect(crumbs.map((crumb) => crumb.label)).toEqual(["Workspace", "Events", "Overview", "Event", "BEO"]);
    expect(crumbs[3]).toEqual({ copyId: "event", label: "Event", to: "/events/e-1", record: { kind: "events", id: "e-1" } });
    expect(crumbs[4].to).toBeUndefined();
  });

  it("names sub-pages without loading a record", () => {
    // The Counts list is gone (FLOW-291); count mode sits under Inventory.
    expect(trail("/inventory/counts/c-1")).toEqual([
      "Workspace>/", "Inventory>/inventory", "Inventory>/inventory", "Stock count",
    ]);
    expect(trail("/settings/locations")).toEqual(["Workspace>/", "Settings>/settings", "Locations"]);
    expect(trail("/sops/new").at(-1)).toBe("New SOP");
    expect(trail("/events")).toEqual(["Workspace>/", "Events>/events/overview", "Overview>/events/overview", "All events"]);
    expect(trail("/settings/users")).toEqual(["Workspace>/", "Settings>/settings", "Users"]);
    // Settings › Imports and an importer under it (FLOW-290).
    expect(trail("/settings/imports")).toEqual(["Workspace>/", "Settings>/settings", "Imports"]);
    expect(trail("/settings/imports/kitchen_inventory")).toEqual(["Workspace>/", "Settings>/settings", "Imports>/settings/imports", "Import"]);
    expect(breadcrumbTrail("/inventory/bar", admin).some((crumb) => crumb.record)).toBe(false);
  });

  it("links a heading to the first tab the user can open", () => {
    // The heading's Overview first (FLOW-295), for anyone who sees another tab.
    expect(trail("/venues", staff)).toEqual(["Workspace>/", "Sales>/sales/overview", "Venues"]);
    // Signed out (e.g. tests rendering the header alone), every tab counts.
    expect(trail("/venues", null)).toEqual(["Workspace>/", "Sales>/sales/overview", "Venues"]);
  });
});

// FLOW-277: nav wording is keyed by a fixed id, not the slug of the display name.
describe("nav wording keys", () => {
  it("keeps the keys the Admin's saved nav wording already uses", () => {
    // Every copyId was the slug of its name when keys moved to fixed ids, so
    // saved nav.* rows still match.
    for (const group of navigationGroups) {
      expect(group.copyId).toBe(copySlug(group.name));
      // Bar became Bar Inventory (FLOW-291) and kept its key.
      for (const tab of group.tabs) expect(tab.copyId).toBe(tab.copyId === "bar" ? "bar" : copySlug(tab.name));
    }
    expect(navKey("legacy")).toBe("nav.legacy");
  });

  it("gives one name per key", () => {
    const names = new Map<string, string>();
    const clash: string[] = [];
    for (const group of navigationGroups)
      for (const item of [group, ...group.tabs]) {
        const seen = names.get(item.copyId);
        if (seen !== undefined && seen !== item.name) clash.push(`${item.copyId}: ${seen} / ${item.name}`);
        names.set(item.copyId, item.name);
      }
    expect(clash).toEqual([]);
  });

  it("keys a crumb by its id, so renaming its name keeps the key", () => {
    expect(breadcrumbTrail("/approvals", admin).map((crumb) => crumb.copyId)).toEqual(["workspace", "dashboard", "approvals"]);
  });
});
