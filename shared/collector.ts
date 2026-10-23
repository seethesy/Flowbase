import { z } from "zod";
import { leadIntakeSchema } from "./leads.ts";

// What the lead collector (FLOW-102, `collector/`) posts to the ingestion endpoint
// (FLOW-28). Shared by the collector and the Worker so both validate the same shape.
// The collector runs this file directly under Node, so its imports name the .ts file.

// One lead, as POST /api/ingest/leads. sourceRecordId names this version of the
// lead (site, lead id and a hash of its details), so an updated lead is a new
// receipt while a re-posted unchanged one is ignored; createLead then updates the
// stored lead by source and source lead id (FLOW-110).
export const collectedLeadSchema = leadIntakeSchema
  .omit({ channel: true, rawPayload: true })
  .extend({
    sourceRecordId: z.string().min(1).max(200),
    // The site module's name, e.g. "bark".
    site: z.string().min(1).max(50),
    // What the module read from the page, kept as the lead's raw payload.
    raw: z.record(z.string(), z.unknown()).default({}),
  });
export type CollectedLead = z.input<typeof collectedLeadSchema>;

export const collectorRunStatusSchema = z.enum([
  "ok",
  "needs_login",
  "blocked",
  "error",
]);
export type CollectorRunStatus = z.infer<typeof collectorRunStatusSchema>;

// One site's result for one run, as POST /api/ingest/collector-runs. FLOW-107 reads
// these for collector health and alerts.
export const collectorRunSchema = z.object({
  // `<runId>:<site>`: one record per site per run.
  sourceRecordId: z.string().min(1).max(200),
  runId: z.string().uuid(),
  site: z.string().min(1).max(50),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  leadsFound: z.number().int().min(0),
  status: collectorRunStatusSchema,
  // Why a site stopped; never contains client details.
  message: z.string().max(1000).default(""),
});
export type CollectorRun = z.input<typeof collectorRunSchema>;
