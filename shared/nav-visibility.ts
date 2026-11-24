import { roles, type Role } from "./access";

// Which roles see each sidebar heading and tab (FLOW-284). Each role has a list
// of hidden nav keys. A heading's key is its copyId ("sales"), and a tab's key is
// "<heading copyId>.<tab copyId>" ("sales.venues"). Keys come from copyIds, which
// never change (src/app/navigation.ts), so renaming a tab in live edit keeps the
// setting. Hiding only narrows what a role sees: a tab still needs its own rule
// (area permission) to show. It is UI only and is not a security boundary. The
// API answers by area permissions, as before. The API's schemas and checks are
// in shared/nav-visibility-schema.ts.

export const navTabKey = (groupId: string, tabId: string) => `${groupId}.${tabId}`;

export type NavHidden = Record<Role, string[]>;

export const emptyNavHidden = (): NavHidden =>
  Object.fromEntries(roles.map((role) => [role, []])) as unknown as NavHidden;

// Sorted and without duplicates, so a save compares and audits cleanly. Keeps
// only strings, so the browser can take the API's answer without a schema
// (the schemas are in nav-visibility-schema.ts, off the first load).
export const normalizeNavHidden = (hidden: Partial<Record<Role, readonly unknown[]>>): NavHidden =>
  Object.fromEntries(
    roles.map((role) => [
      role,
      role === "admin" || !Array.isArray(hidden[role])
        ? []
        : [...new Set(hidden[role]!.filter((key): key is string => typeof key === "string"))].sort(),
    ]),
  ) as unknown as NavHidden;

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
