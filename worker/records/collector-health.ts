import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db, DbLike } from "../db/client";
import { collectorRuns, collectorSites, users } from "../db/schema";
import { emitDomainEvent } from "../jobs/queue";

export const collectorSiteNames = ["bark", "perfect_venue", "weddingpro", "eventective"] as const;
export const collectorInstructions = "https://github.com/seethesy/Flowbase/blob/main/collector/README.md#ops-repo-setup";

export function missingRunWindow(now: Date, last: Date | null): boolean {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  const localMinute = hour * 60 + minute;
  return localMinute >= 11 * 60 && localMinute <= 20 * 60 &&
    (!last || now.getTime() - last.getTime() > 3 * 60 * 60_000);
}

export type CollectorHealth = {
  site: string;
  lastSuccessfulAt: string | null;
  lastRunAt: string | null;
  leadsFound: number | null;
  status: string;
  lastError: string | null;
  noLeadsGapHours: number;
  failureThreshold: number;
  recentRuns: { at: string; leadsFound: number; status: string }[];
};

export async function listCollectorHealth(db: DbLike): Promise<CollectorHealth[]> {
  const sites = await db.select().from(collectorSites).where(isNull(collectorSites.archivedAt));
  return Promise.all(sites.map(async (site) => {
    const runs = await db.select().from(collectorRuns)
      .where(and(eq(collectorRuns.site, site.site), isNull(collectorRuns.archivedAt)))
      .orderBy(desc(collectorRuns.finishedAt)).limit(20);
    const lastOk = runs.find((run) => run.status === "ok");
    const lastError = runs.find((run) => run.status !== "ok");
    return { site: site.site, lastSuccessfulAt: lastOk?.finishedAt.toISOString() ?? null,
      lastRunAt: runs[0]?.finishedAt.toISOString() ?? null,
      leadsFound: runs[0]?.leadsFound ?? null, status: site.alertState === "ok"
        ? (runs[0]?.status ?? "no_runs") : site.alertState,
      lastError: lastError?.message || null, noLeadsGapHours: site.noLeadsGapHours,
      failureThreshold: site.failureThreshold,
      recentRuns: runs.map((r) => ({ at: r.finishedAt.toISOString(), leadsFound: r.leadsFound,
        status: r.status })) };
  }));
}

export function alertReason(
  runs: { status: string; finishedAt: Date; leadsFound: number }[],
  now: Date,
  config: { failureThreshold: number; noLeadsGapHours: number },
): string {
  const latest = runs[0];
  if (missingRunWindow(now, latest?.finishedAt ?? null)) return "not_running";
  if (latest?.status === "needs_login" || latest?.status === "blocked") return latest.status;
  if (runs.length >= config.failureThreshold &&
      runs.slice(0, config.failureThreshold).every((run) => run.status === "error"))
    return "repeated_errors";
  if (latest?.status === "ok") {
    const lastLead = runs.find((run) => run.leadsFound > 0);
    const baseline = lastLead?.finishedAt ?? runs[runs.length - 1]?.finishedAt;
    if (baseline && now.getTime() - baseline.getTime() > config.noLeadsGapHours * 60 * 60_000)
      return "no_leads";
  }
  return "ok";
}

export async function scanCollectorHealth(db: Db, now = new Date()) {
  const sites = await db.select().from(collectorSites).where(isNull(collectorSites.archivedAt));
  for (const site of sites) {
    await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(collectorSites)
        .where(eq(collectorSites.id, site.id)).for("update");
      const runs = await tx.select({ status: collectorRuns.status, finishedAt: collectorRuns.finishedAt,
        leadsFound: collectorRuns.leadsFound }).from(collectorRuns)
        .where(and(eq(collectorRuns.site, site.site), isNull(collectorRuns.archivedAt)))
        .orderBy(desc(collectorRuns.finishedAt)).limit(100);
      const reason = alertReason(runs, now, locked);
      if (reason === locked.alertState) return;
      await tx.update(collectorSites).set({ alertState: reason }).where(eq(collectorSites.id, site.id));
      if (reason === "ok") return;
      const admins = await tx.select({ id: users.id }).from(users)
        .where(and(eq(users.role, "admin"), eq(users.status, "active"), isNull(users.archivedAt)));
      if (!admins.length) return;
      await emitDomainEvent(tx, { name: "collector.failed", entityId: site.id,
        data: { recipientIds: admins.map((admin) => admin.id),
          title: `Collector ${site.site}: ${reason.replaceAll("_", " ")}`,
          body: `Check collector health and re-login instructions for ${site.site}.`,
          link: "/settings/collector" },
        idempotencyKey: `collector:${site.id}:${reason}:${now.toISOString()}` });
    });
  }
}

export async function registerCollectorSite(db: DbLike, site: string) {
  await db.insert(collectorSites).values({ site }).onConflictDoNothing({ target: collectorSites.site });
}
