import { Hono } from "hono";
import { z } from "zod";
import { matrixProblem, matrixSchema } from "../../shared/role-permissions";
import { requirePermission } from "../auth";
import { ApiError, parseBody, recordRunner, type AppEnv, type RunWithDb } from "../hono";
import { loadMatrix, saveMatrix } from "../records/permissions";

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
  return routes;
}
