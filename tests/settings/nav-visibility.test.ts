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
  it("hides Sales › Venues and the whole Reports heading for Part-time Staff only (AC1)", () => {
    expect(tabs(partTime, "Sales")).toEqual(["Overview", "Venues"]);
    expect(headings(partTime)).toContain("Reports");
    setNavHidden(hiding(["sales.venues", "reports"]));
    // Venues was the only other Sales tab, so Overview (and the heading) goes too.
    expect(headings(partTime)).not.toContain("Sales");
    expect(headings(partTime)).not.toContain("Reports");
    expect(headings(partTime)).toContain("Events");
    // The breadcrumb's heading link skips a hidden tab.
    expect(breadcrumbTrail("/events/overview", partTime)[1]).toMatchObject({ label: "Events", to: "/events/overview" });
    // Admin and other roles are unchanged.
    expect(headings(admin)).toContain("Reports");
    expect(tabs(actor("staff"), "Sales")).toEqual(["Overview", "Venues"]);
  });

  it("only narrows: showing a tab a role can't open does nothing (AC3)", () => {
    setNavHidden(emptyNavHidden());
    expect(tabs(partTime, "Sales")).not.toContain("Leads");
    expect(tabBlocked(group("sales"), tab("sales", "leads"), "part_time_staff")).toBe("No access to Leads");
    expect(tabBlocked(group("sales"), tab("sales", "venues"), "part_time_staff")).toBeNull();
    expect(tabBlocked(group("sales"), tab("sales", "leads"), "admin")).toBeNull();
    expect(headingBlocked(group("sales"), "part_time_staff")).toBeNull();
  });

  it("lands a role on its first visible page when the Dashboard is hidden", () => {
    expect(firstVisiblePage(partTime)).toBe("/");
    setNavHidden(hiding(["dashboard"]));
    expect(firstVisiblePage(partTime)).toBe("/sales/overview");
    expect(firstVisiblePage(admin)).toBe("/");
  });

  it("keeps Admin's list empty and every key a real heading or tab (AC4)", () => {
    const known = new Set(manifest.nav);
    expect(navHiddenProblem({ ...emptyNavHidden(), admin: ["sales"] }, known)).toMatch(/Admin always sees/);
    expect(navHiddenProblem(hiding(["sales.nowhere"]), known)).toMatch(/no heading or tab/);
    expect(navHiddenProblem(hiding(["sales.venues", "reports"]), known)).toBeNull();
    expect(navHides(hiding(["reports"]), "admin", "reports")).toBe(false);
    expect(navHides(hiding(["reports"]), "part_time_staff", "reports", "time-tracking")).toBe(true);
  });

  it("changes one cell and keeps lists sorted without duplicates", () => {
    const next = withCell(hiding(["reports"]), "part_time_staff", "sales.venues", false);
    expect(next.part_time_staff).toEqual(["reports", "sales.venues"]);
    expect(withCell(next, "part_time_staff", "reports", true).part_time_staff).toEqual(["sales.venues"]);
    expect(normalizeNavHidden({ part_time_staff: ["b", "a", "b"], admin: ["x"] })).toMatchObject({
      admin: [],
      part_time_staff: ["a", "b"],
    });
  });
});
