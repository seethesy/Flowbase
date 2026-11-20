import { describe, expect, it } from "vitest";
import type { Actor } from "../shared/access";
import {
  breadcrumbTrail,
  matchNavigation,
  navigationGroups,
  visibleGroups,
} from "../src/app/navigation";

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
    expect(tabs(admin, "Dashboard")).toEqual(["Overview", "Tasks", "Day-of", "Approvals"]);
    expect(tabs(admin, "Sales")).toEqual(["Leads", "Clients", "Proposals", "Venues"]);
    expect(tabs(admin, "Events")).toEqual(["Calendar", "Production", "Day-of"]);
    expect(tabs(admin, "Staffing")).toEqual(["Schedule", "Staff directory", "SOPs"]);
    expect(tabs(admin, "Inventory")).toEqual(["Inventory", "Purchasing", "Vendors", "Imports"]);
    expect(tabs(admin, "Kitchen")).toEqual(["Recipes", "Ingredients"]);
    expect(tabs(admin, "Reports")).toEqual(["Time tracking", "Operational reports"]);
  });

  it("hides tabs a role can't open, and headings left with none (AC4)", () => {
    expect(tabs(salesperson, "Sales")).toEqual(["Leads", "Clients", "Proposals", "Venues"]);
    expect(tabs(salesperson, "Inventory")).toEqual(["Inventory", "Purchasing", "Vendors", "Imports"]);
    expect(tabs(salesperson, "Reports")).toEqual(["Time tracking"]);
    // Staff can't read leads, clients or proposals, run imports or see operational reports.
    expect(tabs(staff, "Sales")).toEqual(["Venues"]);
    expect(tabs(staff, "Inventory")).toEqual(["Inventory", "Purchasing", "Vendors"]);
    expect(tabs(staff, "Reports")).toEqual(["Time tracking"]);
    expect(headings(staff)).toHaveLength(9);
    // Signed out, only pages that need no permission remain.
    expect(visibleGroups(null).map((group) => group.name)).toEqual(["Dashboard", "Marketing", "Documents"]);
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
    expect(at("/sales/reports")).toBe("Sales › Proposals");
    expect(at("/events/e-1/beo/b-1")).toBe("Events › Calendar");
    expect(at("/inventory/counts/c-1")).toBe("Inventory › Inventory");
    expect(at("/inventory/ingredients")).toBe("Kitchen › Ingredients");
    expect(at("/reports/operations")).toBe("Reports › Operational reports");
    expect(at("/settings")).toBeNull();
    // Day-of: one page, two entry points.
    expect(at("/day-of")).toBe("Dashboard › Day-of");
    expect(at("/day-of", "Events")).toBe("Events › Day-of");
  });
});

describe("breadcrumb trail", () => {
  it("builds Workspace / Heading / Tab with every segment but the last linked", () => {
    expect(trail("/approvals")).toEqual(["Workspace>/", "Dashboard>/", "Approvals"]);
    expect(trail("/")).toEqual(["Workspace>/", "Dashboard>/", "Overview"]);
    expect(trail("/leads")).toEqual(["Workspace>/", "Sales>/leads", "Leads"]);
    expect(trail("/inventory/ingredients")).toEqual(["Workspace>/", "Kitchen>/recipes", "Ingredients"]);
    expect(trail("/marketing")).toEqual(["Workspace>/", "Marketing"]);
    expect(trail("/day-of", admin, "Events")).toEqual(["Workspace>/", "Events>/calendar", "Day-of"]);
  });

  it("ends with the record, which the header names once it loads", () => {
    expect(breadcrumbTrail("/leads/lead-1", admin).at(-1)).toEqual({
      label: "Lead",
      record: { kind: "leads", id: "lead-1" },
    });
    expect(trail("/leads/lead-1")).toEqual(["Workspace>/", "Sales>/leads", "Leads>/leads", "Lead"]);
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
    expect(crumbs.map((crumb) => crumb.label)).toEqual(["Workspace", "Events", "Calendar", "Event", "BEO"]);
    expect(crumbs[3]).toEqual({ label: "Event", to: "/events/e-1", record: { kind: "events", id: "e-1" } });
    expect(crumbs[4].to).toBeUndefined();
  });

  it("names sub-pages without loading a record", () => {
    expect(trail("/inventory/counts")).toEqual(["Workspace>/", "Inventory>/inventory", "Inventory>/inventory", "Stock counts"]);
    expect(trail("/inventory/counts/c-1")).toEqual([
      "Workspace>/", "Inventory>/inventory", "Inventory>/inventory", "Stock counts>/inventory/counts", "Stock count",
    ]);
    expect(trail("/sops/new").at(-1)).toBe("New SOP");
    expect(trail("/events")).toEqual(["Workspace>/", "Events>/calendar", "Calendar>/calendar", "All events"]);
    expect(trail("/settings/users")).toEqual(["Workspace>/", "Settings>/settings", "Users"]);
    expect(breadcrumbTrail("/inventory/bar", admin).some((crumb) => crumb.record)).toBe(false);
  });

  it("links a heading to the first tab the user can open", () => {
    expect(trail("/venues", staff)).toEqual(["Workspace>/", "Sales>/venues", "Venues"]);
    // Signed out (e.g. tests rendering the header alone), every tab counts.
    expect(trail("/venues", null)).toEqual(["Workspace>/", "Sales>/leads", "Venues"]);
  });
});
