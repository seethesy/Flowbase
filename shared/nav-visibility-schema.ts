import { z } from "zod";
import { roles, type Role } from "./access";
import type { NavHidden } from "./nav-visibility";

// What GET/PUT /api/permissions/navigation carry (FLOW-284), and the checks a
// save must pass. Kept apart from nav-visibility.ts so the browser's first load
// doesn't build these schemas.

const navKeyPattern = /^[a-z0-9-]+(\.[a-z0-9-]+)?$/;
export const navKeySchema = z.string().max(120).regex(navKeyPattern);

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

// Why a setting can't be saved, or null. Admin always sees everything (AC4), and
// every key must be a heading or tab that exists.
export function navHiddenProblem(hidden: NavHidden, known: ReadonlySet<string>): string | null {
  if (hidden.admin.length) return "Admin always sees every heading and tab.";
  for (const role of roles)
    for (const key of hidden[role])
      if (!known.has(key)) return `There is no heading or tab "${key}".`;
  return null;
}
