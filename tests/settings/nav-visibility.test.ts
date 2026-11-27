import { afterEach, describe, expect, it } from "vitest";
import type { Actor } from "../../shared/access";
import { navHiddenProblem } from "../../shared/nav-visibility-schema";
import {
  emptyNavHidden,
  navHides,
  normalizeNavHidden,
  setNavHidden,
  type NavHidden,
} from "../../shared/nav-visibility";
import { breadcrumbTrail, firstVisiblePage, navigationGroups, visibleGroups } from "../../src/app/navigation";
import { headingBlocked, tabBlocked, withCell } from "../../src/app/live-edit/nav-visibility-editor";
import manifest from "../../shared/generated/live-edit-keys.json";

// Which roles see each sidebar heading and tab (FLOW-284).
const actor = (role: Actor["role"]): Actor => ({ userId: "38000000-0000-4000-8000-000000000001", role });
const admin = actor("admin");
const partTime = actor("part_time_staff");
const headings = (who: Actor) => visibleGroups(who).map((group) => group.name);
const tabs = (who: Actor, heading: string) =>
  visibleGroups(who).find((group) => group.name === heading)?.tabs.map((tab) => tab.name);
const hiding = (keys: string[]): NavHidden => ({ ...emptyNavHidden(), part_time_staff: keys });
const group = (copyId: string) => navigationGroups.find((each) => each.copyId === copyId)!;
const tab = (groupId: string, tabId: string) => group(groupId).tabs.find((each) => each.copyId === tabId)!;

afterEach(() => setNavHidden(emptyNavHidden()));

describe("navigation by role", () => {
  it("hides Sales › Network for Part-time Staff only (AC1)", () => {
    expect(tabs(partTime, "Sales")).toEqual(["Overview", "Past Events", "Network", "Time Tracking"]);
    setNavHidden(hiding(["sales.network", "sales.time-tracking"]));
    expect(tabs(partTime, "Sales")).toEqual(["Overview", "Past Events"]);
    setNavHidden(hiding(["sales.past-events", "sales.network", "sales.time-tracking"]));
    // Those were the only other Sales tabs, so Overview (and the heading) goes too.
    expect(headings(partTime)).not.toContain("Sales");
    expect(headings(partTime)).toContain("Events");
    // The breadcrumb's heading link skips a hidden tab.
    expect(breadcrumbTrail("/events/overview", partTime)[1]).toMatchObject({ label: "Events", to: "/events/overview" });
    // Admin and other roles are unchanged.
    expect(tabs(admin, "Sales")).toContain("Time Tracking");
    expect(tabs(actor("staff"), "Sales")).toEqual(["Overview", "Past Events", "Network", "Time Tracking"]);
  });

  it("only narrows: showing a tab a role can't open does nothing (AC3)", () => {
    setNavHidden(emptyNavHidden());
    expect(tabs(partTime, "Leads")).toEqual(["BEO"]);
    expect(tabBlocked(group("leads"), tab("leads", "overview"), "part_time_staff")).toBe("No access to Leads");
    expect(tabBlocked(group("sales"), tab("sales", "network"), "part_time_staff")).toBeNull();
    expect(tabBlocked(group("leads"), tab("leads", "overview"), "admin")).toBeNull();
    expect(headingBlocked(group("sales"), "part_time_staff")).toBeNull();
  });

  it("hides Network and Analytics by their own keys (FLOW-340 AC6)", () => {
    const salesperson = actor("salesperson");
    setNavHidden({ ...emptyNavHidden(), salesperson: ["sales.network", "sales.analytics"] });
    expect(tabs(salesperson, "Sales")).toEqual(["Overview", "Past Events", "Pricing", "Time Tracking"]);
    // A record page under a hidden Network names no heading or tab.
    expect(breadcrumbTrail("/clients/c-1", salesperson).map((crumb) => crumb.label)).toEqual(["Workspace", "Not available"]);
  });

  it("hides the moved Leads tabs by their new keys (FLOW-328 AC4)", () => {
    const salesperson = actor("salesperson");
    expect(tabs(salesperson, "Leads")).toEqual(["Overview", "Proposals", "Contracts", "Payment", "BEO"]);
    setNavHidden({ ...emptyNavHidden(), salesperson: ["leads.proposals"] });
    expect(tabs(salesperson, "Leads")).toEqual(["Overview", "Contracts", "Payment", "BEO"]);
    setNavHidden({ ...emptyNavHidden(), salesperson: ["leads"] });
    expect(headings(salesperson)).not.toContain("Leads");
    expect(headings(salesperson)).toContain("Sales");
  });

  it("hides Documents › Templates from a role the Documents tab is hidden from (FLOW-330 AC3)", () => {
    expect(tabs(partTime, "Documents")).toEqual(["Overview", "Documents", "Templates"]);
    setNavHidden(hiding(["documents.documents"]));
    expect(headings(partTime)).not.toContain("Documents");
    setNavHidden(hiding(["documents.templates"]));
    expect(tabs(partTime, "Documents")).toEqual(["Overview", "Documents"]);
    expect(tabs(admin, "Documents")).toEqual(["Overview", "Documents", "Templates"]);
  });

  it("lands a role on its first visible page when the Dashboard is hidden", () => {
    expect(firstVisiblePage(partTime)).toBe("/");
    setNavHidden(hiding(["dashboard"]));
    expect(firstVisiblePage(partTime)).toBe("/beos");
    expect(firstVisiblePage(admin)).toBe("/");
  });

  it("keeps Admin's list empty and every key a real heading or tab (AC4)", () => {
    const known = new Set(manifest.nav);
    expect(navHiddenProblem({ ...emptyNavHidden(), admin: ["sales"] }, known)).toMatch(/Admin always sees/);
    expect(navHiddenProblem(hiding(["sales.nowhere"]), known)).toMatch(/no heading or tab/);
    expect(navHiddenProblem(hiding(["sales.network", "sales.time-tracking"]), known)).toBeNull();
    expect(navHides(hiding(["sales"]), "admin", "sales")).toBe(false);
    expect(navHides(hiding(["sales"]), "part_time_staff", "sales", "time-tracking")).toBe(true);
  });

  it("changes one cell and keeps lists sorted without duplicates", () => {
    const next = withCell(hiding(["sales.time-tracking"]), "part_time_staff", "sales.network", false);
    expect(next.part_time_staff).toEqual(["sales.network", "sales.time-tracking"]);
    expect(withCell(next, "part_time_staff", "sales.time-tracking", true).part_time_staff).toEqual(["sales.network"]);
    expect(normalizeNavHidden({ part_time_staff: ["b", "a", "b"], admin: ["x"] })).toMatchObject({
      admin: [],
      part_time_staff: ["a", "b"],
    });
  });
});
