import { Hono } from "hono";
import { z } from "zod";
import { matrixProblem, matrixSchema } from "../../shared/role-permissions";
import { navHiddenProblem, navVisibilitySchema } from "../../shared/nav-visibility";
import manifestJson from "../../shared/generated/live-edit-keys.json";
import { requirePermission } from "../auth";
import { ApiError, parseBody, recordRunner, type AppEnv, type RunWithDb } from "../hono";
import { loadMatrix, saveMatrix } from "../records/permissions";
import { loadNavHidden, saveNavHidden } from "../records/nav-visibility";

// Every sidebar heading and tab key (FLOW-284), from the live-edit manifest.
const navKeys = new Set((manifestJson as { nav: string[] }).nav);

// Roles and permissions (FLOW-269). Everyone signed in reads the matrix, because
// the browser evaluates the same policy to show or hide screens; only users.manage
// (Admin) saves it. A saved matrix applies from the next request.
export function permissionRoutes(options: { withDb?: RunWithDb }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  routes.get("/", requirePermission("auth.read"), async (c) =>
    c.json({ matrix: await record(c, (db) => loadMatrix(db)) }));
  routes.put("/", requirePermission("users.manage"), async (c) => {
    const { matrix } = await parseBody(c, z.object({ matrix: matrixSchema }));
    // Admin is locked to Write on every area, and a level must be one the area
    // offers: 400, nothing saved.
    const problem = matrixProblem(matrix);
    if (problem) throw new ApiError(400, "INVALID_PERMISSIONS", problem);
    return c.json({ matrix: await record(c, (db, actor) => saveMatrix(db, actor, matrix)) });
  });
  // Which roles see each sidebar heading and tab (FLOW-284). Everyone signed in
  // reads it, because the browser builds the sidebar from it; only Admin saves.
  // It only hides navigation: the API above still answers by area.
  routes.get("/navigation", requirePermission("auth.read"), async (c) =>
    c.json({ hidden: await record(c, (db) => loadNavHidden(db)) }));
  routes.put("/navigation", requirePermission("users.manage"), async (c) => {
    const { hidden } = await parseBody(c, navVisibilitySchema);
    const problem = navHiddenProblem(hidden, navKeys);
    if (problem) throw new ApiError(400, "INVALID_NAV_VISIBILITY", problem);
    return c.json({ hidden: await record(c, (db, actor) => saveNavHidden(db, actor, hidden)) });
  });
  return routes;
}
