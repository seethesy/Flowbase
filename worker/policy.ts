import type { Actor } from "../shared/access";

// Stand-in for the FLOW-38 permission matrix: it covers only the actions built so
// far, and FLOW-38 replaces it with the full role map. Admin can do everything.
export type Action = "jobs.manage" | "ingest.manage";

const isAdmin = (actor: Actor) => actor.role === "admin";
const rules: Record<Action, (actor: Actor) => boolean> = {
  "jobs.manage": isAdmin,
  "ingest.manage": isAdmin,
};

export const can = (actor: Actor, action: Action) =>
  isAdmin(actor) || rules[action](actor);
