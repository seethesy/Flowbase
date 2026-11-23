import { z } from "zod";
import { roles, type Role } from "./access";

// Which roles see each sidebar heading and tab (FLOW-284). Each role has a list
// of hidden nav keys. A heading's key is its copyId ("sales"), and a tab's key is
// "<heading copyId>.<tab copyId>" ("sales.venues"). Keys come from copyIds, which
// never change (src/app/navigation.ts), so renaming a tab in live edit keeps the
// setting. Hiding only narrows what a role sees: a tab still needs its own rule
// (area permission) to show. It is UI only and is not a security boundary. The
// API answers by area permissions, as before.

export const navTabKey = (groupId: string, tabId: string) => `${groupId}.${tabId}`;

const navKeyPattern = /^[a-z0-9-]+(\.[a-z0-9-]+)?$/;
export const navKeySchema = z.string().max(120).regex(navKeyPattern);

export type NavHidden = Record<Role, string[]>;

export const emptyNavHidden = (): NavHidden =>
  Object.fromEntries(roles.map((role) => [role, []])) as unknown as NavHidden;

// What GET/PUT /api/permissions/navigation carry: a list for every role.
export const navHiddenSchema = z
  .object(
    Object.fromEntries(roles.map((role) => [role, z.array(navKeySchema).max(500)])) as unknown as Record<
      Role,
      z.ZodType<string[]>
    >,
  )
  .strict() as unknown as z.ZodType<NavHidden>;
export const navVisibilitySchema = z.object({ hidden: navHiddenSchema });

// Sorted and without duplicates, so a save compares and audits cleanly.
export const normalizeNavHidden = (hidden: Partial<Record<Role, readonly string[]>>): NavHidden =>
  Object.fromEntries(
    roles.map((role) => [role, role === "admin" ? [] : [...new Set(hidden[role] ?? [])].sort()]),
  ) as unknown as NavHidden;

// Why a setting can't be saved, or null. Admin always sees everything (AC4), and
// every key must be a heading or tab that exists.
export function navHiddenProblem(hidden: NavHidden, known: ReadonlySet<string>): string | null {
  if (hidden.admin.length) return "Admin always sees every heading and tab.";
  for (const role of roles)
    for (const key of hidden[role])
      if (!known.has(key)) return `There is no heading or tab "${key}".`;
  return null;
}

// The setting the browser uses. It stays empty (everything shown) until it
// loads, and also outside the app, in unit tests.
let current: NavHidden = emptyNavHidden();
export const navHidden = (): NavHidden => current;
export function setNavHidden(next: NavHidden) {
  current = normalizeNavHidden(next);
}

// Whether a role's setting hides a heading, or a tab under it. Admin never
// hides anything.
export function navHides(hidden: NavHidden, role: Role, groupId: string, tabId?: string) {
  if (role === "admin") return false;
  const list = hidden[role] ?? [];
  return list.includes(groupId) || (tabId !== undefined && list.includes(navTabKey(groupId, tabId)));
}
