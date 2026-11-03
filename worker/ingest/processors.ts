import { collectedLeadSchema, collectorRunSchema } from "../../shared/collector";
import { collectorRuns } from "../db/schema";
import { createLead } from "../records/leads";
import { registerCollectorSite, scanCollectorHealth } from "../records/collector-health";
import type { IngestProcessor } from "./receipts";
import { thumbtackLead } from "./thumbtack";
import { z } from "zod";
import { recordGithubUsage } from "../records/usage";

// Turns stored receipts into records, by ingest source (FLOW-28). A receipt that
// doesn't parse fails its job, so it shows in the admin receipts list for replay.
export const ingestProcessors = new Map<string, IngestProcessor>([
  [
    "actions-usage",
    async (receipt, { db }) => {
      const report = z.object({ sourceRecordId: z.string(),
        period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
        minutes: z.number().finite().nonnegative() }).parse(JSON.parse(receipt.body));
      await recordGithubUsage(db, report.period, report.minutes);
    },
  ],
  // Lead collector (FLOW-102): one lead per receipt, channel "collector".
  [
    "leads",
    async (receipt, { db }) => {
      const { site, raw, sourceRecordId, ...lead } = collectedLeadSchema.parse(
        JSON.parse(receipt.body),
      );
      await createLead(db, {
        ...lead,
        channel: "collector",
        rawPayload: { site, sourceRecordId, ...raw },
      });
    },
  ],
  // Thumbtack lead webhooks (FLOW-108), channel "webhook". A status update for a
  // lead already stored updates that lead (createLead, by source lead id).
  [
    "thumbtack",
    async (receipt, { db }) => {
      const lead = thumbtackLead(JSON.parse(receipt.body));
      if (!lead) throw new Error("The Thumbtack payload has no negotiationID.");
      await createLead(db, lead);
    },
  ],
  [
    "collector-runs",
    async (receipt, { db }) => {
      const run = collectorRunSchema.parse(JSON.parse(receipt.body));
      await db
        .insert(collectorRuns)
        .values({
          runId: run.runId,
          site: run.site,
          startedAt: new Date(run.startedAt),
          finishedAt: new Date(run.finishedAt),
          leadsFound: run.leadsFound,
          status: run.status,
          message: run.message,
        })
        .onConflictDoNothing();
      await registerCollectorSite(db, run.site);
      await scanCollectorHealth(db, new Date(run.finishedAt));
    },
  ],
]);
