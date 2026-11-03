import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { businessDefaultsSchema, defaultBusinessDefaults } from "../../shared/settings";
import type { Db, DbLike } from "../db/client";
import { attachments, notifications, settings, smsOutbox, usageCounters, users } from "../db/schema";
import { enqueueJob } from "../jobs/queue";

export const usageMetrics = ["worker_requests", "db_queries", "r2_bytes",
  "supabase_bytes", "github_minutes", "sms_messages"] as const;
export type UsageMetric = typeof usageMetrics[number];
export const usageLabels: Record<UsageMetric, string> = {
  worker_requests: "Worker API requests", db_queries: "Database queries",
  r2_bytes: "R2 storage", supabase_bytes: "Supabase database",
  github_minutes: "GitHub Actions minutes", sms_messages: "SMS messages recorded",
};
const monthly = new Set<UsageMetric>(["github_minutes", "sms_messages"]);
const storage = new Set<UsageMetric>(["r2_bytes", "supabase_bytes"]);
export function usagePeriod(metric: UsageMetric, now: Date): string {
  const day = now.toISOString().slice(0, 10);
  return storage.has(metric) ? "current" : monthly.has(metric) ? day.slice(0, 7) : day;
}
export function crossedThresholds(value: number, limit: number): (70 | 90)[] {
  if (limit <= 0) return [];
  return ([70, 90] as const).filter((threshold) => value >= limit * threshold / 100);
}

export async function incrementUsage(db: DbLike, metric: UsageMetric, amount: number, now = new Date()) {
  if (amount <= 0) return;
  await db.insert(usageCounters).values({ metric, period: usagePeriod(metric, now), value: String(amount) })
    .onConflictDoUpdate({ target: [usageCounters.metric, usageCounters.period],
      set: { value: sql`${usageCounters.value} + ${amount}` } });
}
export async function setUsage(db: DbLike, metric: UsageMetric, value: number, now = new Date()) {
  await db.insert(usageCounters).values({ metric, period: usagePeriod(metric, now), value: String(value) })
    .onConflictDoUpdate({ target: [usageCounters.metric, usageCounters.period],
      set: { value: String(value) } });
}

export async function recordGithubUsage(db: DbLike, period: string, minutes: number) {
  await db.insert(usageCounters).values({ metric: "github_minutes", period, value: String(minutes) })
    .onConflictDoUpdate({ target: [usageCounters.metric, usageCounters.period],
      set: { value: sql`greatest(${usageCounters.value}, ${minutes})` } });
}

async function limitsOf(db: DbLike) {
  const [row] = await db.select({ value: settings.value }).from(settings)
    .where(eq(settings.key, "defaults"));
  const parsed = businessDefaultsSchema.safeParse(row?.value ?? {});
  const defaults = parsed.success ? parsed.data : defaultBusinessDefaults;
  return { worker_requests: defaults.freeTierLimits.workerRequests,
    db_queries: defaults.freeTierLimits.dbQueries, r2_bytes: defaults.freeTierLimits.r2Bytes,
    supabase_bytes: defaults.freeTierLimits.supabaseBytes,
    github_minutes: defaults.freeTierLimits.githubMinutes,
    sms_messages: defaults.monthlySmsCap } satisfies Record<UsageMetric, number>;
}

export type UsageRow = { metric: UsageMetric; label: string; value: number;
  limit: number; period: string; percent: number | null };

export async function readUsage(db: DbLike, now = new Date()): Promise<UsageRow[]> {
  const counters = await db.select().from(usageCounters);
  const limits = await limitsOf(db);
  return usageMetrics.map((metric) => {
    const period = usagePeriod(metric, now);
    const value = Number(counters.find((row) => row.metric === metric && row.period === period)?.value ?? 0);
    const limit = limits[metric];
    return { metric, label: usageLabels[metric], value, limit, period,
      percent: limit > 0 ? Math.round(value / limit * 1000) / 10 : null };
  });
}

// Snapshots for external/storage metrics. Attachment variants are an approximate
// bucket total; objects outside Flowbase and pending uploads are not counted.
export async function refreshUsage(db: Db, now = new Date()): Promise<UsageRow[]> {
  const [{ bytes }] = await db.execute<{ bytes: number }>(sql`
    select coalesce(sum((variant.value->>'size')::bigint), 0)::float8 as bytes
    from ${attachments} cross join lateral jsonb_array_elements(${attachments.variants}) variant(value)
    where ${attachments.status} = 'ready' and ${attachments.archivedAt} is null`);
  const [{ dbBytes }] = await db.execute<{ dbBytes: number }>(sql`select pg_database_size(current_database())::float8 as "dbBytes"`);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const [{ sms }] = await db.select({ sms: sql<number>`count(*)::int` }).from(smsOutbox)
    .where(and(gte(smsOutbox.createdAt, start), lt(smsOutbox.createdAt, end)));
  await setUsage(db, "r2_bytes", bytes, now);
  await setUsage(db, "supabase_bytes", dbBytes, now);
  await setUsage(db, "sms_messages", sms, now);
  const rows = await readUsage(db, now);
  const admins = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.role, "admin"), eq(users.status, "active"), isNull(users.archivedAt)));
  for (const row of rows) for (const threshold of crossedThresholds(row.value, row.limit)) {
    const alertPeriod = storage.has(row.metric) ? now.toISOString().slice(0, 7) : row.period;
    const sourceKey = `usage:${row.metric}:${alertPeriod}:${threshold}`;
    for (const admin of admins) {
      const [alert] = await db.insert(notifications).values({ userId: admin.id,
        type: "production_alert", title: `${row.label} reached ${threshold}%`,
        body: `${row.value.toLocaleString()} of ${row.limit.toLocaleString()} used in ${row.period}.`,
        link: "/settings/usage", sourceKey })
        .onConflictDoNothing({ target: [notifications.sourceKey, notifications.userId] })
        .returning({ id: notifications.id });
      if (alert) await enqueueJob(db, { type: "notification.email",
        payload: { notificationId: alert.id, force: true },
        idempotencyKey: `notification.email:${alert.id}` });
    }
  }
  return rows;
}
