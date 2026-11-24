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

// Isolate-local counts (FLOW-305). Without the Cloudflare Analytics token the
// Worker counts requests and queries in memory and writes them in one multi-row
// upsert at most once a minute per isolate (USAGE_FLUSH_MS), and at the end of
// every cron run. Counts held by an isolate that is evicted before it flushes
// are lost, so the figure is an estimate. With the token, the hourly sweep reads
// the real totals from Cloudflare and nothing is counted here.
export const USAGE_FLUSH_MS = 60_000;
type PendingCount = { metric: UsageMetric; period: string; value: number };
let pending = new Map<string, PendingCount>();
let lastFlushAt = 0;

export function countUsage(metric: UsageMetric, amount: number, now = new Date()) {
  if (!(amount > 0)) return;
  const period = usagePeriod(metric, now);
  const key = `${metric}|${period}`;
  const current = pending.get(key);
  if (current) current.value += amount;
  else pending.set(key, { metric, period, value: amount });
}
export const pendingUsage = (): PendingCount[] => [...pending.values()].map((row) => ({ ...row }));
// Tests only: forget the isolate's counts and flush clock.
export function resetPendingUsage() {
  pending = new Map();
  lastFlushAt = 0;
}
export const usageFlushDue = (now = Date.now()) =>
  pending.size > 0 && now - lastFlushAt >= USAGE_FLUSH_MS;

// Writes every pending count in one statement, adding to the day's total. On
// failure the counts go back into the isolate for the next try.
export async function flushUsage(db: DbLike, now = Date.now()): Promise<number> {
  const rows = [...pending.values()];
  pending = new Map();
  lastFlushAt = now;
  if (!rows.length) return 0;
  try {
    await db.insert(usageCounters)
      .values(rows.map((row) => ({ metric: row.metric, period: row.period, value: String(row.value) })))
      .onConflictDoUpdate({ target: [usageCounters.metric, usageCounters.period],
        set: { value: sql`${usageCounters.value} + excluded.value` } });
  } catch (error) {
    for (const row of rows) countUsageIn(row);
    throw error;
  }
  return rows.length;
}
function countUsageIn(row: PendingCount) {
  const key = `${row.metric}|${row.period}`;
  const current = pending.get(key);
  if (current) current.value += row.value;
  else pending.set(key, { ...row });
}

// Request and query totals come from Cloudflare when both are configured.
export const providerMetricsConfigured = (env: { CF_ANALYTICS_TOKEN?: string; CF_ACCOUNT_ID?: string } | undefined) =>
  Boolean(env?.CF_ANALYTICS_TOKEN && env?.CF_ACCOUNT_ID);

// Today's Worker requests and Hyperdrive queries from Cloudflare's GraphQL
// Analytics API (workersInvocationsAdaptive, hyperdriveQueriesAdaptiveGroups).
// "Today" is the UTC day, matching usagePeriod. The token is account-scoped
// with Account Analytics: Read only.
export type ProviderMetricsEnv = {
  CF_ANALYTICS_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  CF_WORKER_NAME?: string;
  CF_HYPERDRIVE_ID?: string;
};
const providerQuery = `query FlowbaseUsage($accountTag: string!, $start: Time!, $end: Time!, $script: string!, $config: string!) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    workers: workersInvocationsAdaptive(limit: 10000, filter: { scriptName: $script, datetime_geq: $start, datetime_leq: $end }) { sum { requests } }
    hyperdrive: hyperdriveQueriesAdaptiveGroups(limit: 10000, filter: { configId: $config, datetime_geq: $start, datetime_leq: $end }) { count }
  } }
}`;
export async function readProviderMetrics(env: ProviderMetricsEnv, now = new Date(),
  fetcher: typeof fetch = fetch): Promise<{ requests: number; queries: number | null }> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const response = await fetcher("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: providerQuery, variables: { accountTag: env.CF_ACCOUNT_ID,
      start: start.toISOString(), end: now.toISOString(), script: env.CF_WORKER_NAME ?? "flowbase",
      // Without a Hyperdrive id the filter matches nothing; queries stay unknown.
      config: env.CF_HYPERDRIVE_ID ?? "" } }),
  });
  if (!response.ok) throw new Error(`cloudflare_analytics_${response.status}`);
  const body = await response.json() as {
    data?: { viewer?: { accounts?: { workers?: { sum?: { requests?: number } }[]; hyperdrive?: { count?: number }[] }[] } };
    errors?: { message?: string }[] | null;
  };
  if (body.errors?.length) throw new Error(`cloudflare_analytics: ${body.errors[0]?.message ?? "error"}`);
  const account = body.data?.viewer?.accounts?.[0];
  if (!account) throw new Error("cloudflare_analytics: account not found");
  const requests = (account.workers ?? []).reduce((sum, row) => sum + (row.sum?.requests ?? 0), 0);
  const queries = env.CF_HYPERDRIVE_ID
    ? (account.hyperdrive ?? []).reduce((sum, row) => sum + (row.count ?? 0), 0) : null;
  return { requests, queries };
}

// Hourly (FLOW-307): stores Cloudflare's totals for today. Returns false when the
// token isn't configured, so the isolate estimate stands.
export async function storeProviderMetrics(db: DbLike, env: ProviderMetricsEnv, now = new Date(),
  fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!providerMetricsConfigured(env)) return false;
  const { requests, queries } = await readProviderMetrics(env, now, fetcher);
  await setUsage(db, "worker_requests", requests, now);
  if (queries !== null) await setUsage(db, "db_queries", queries, now);
  return true;
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

// Requests and queries are read from Cloudflare when the Analytics token is set,
// otherwise estimated from isolate counts (FLOW-305).
export type UsageSource = "cloudflare" | "estimate";
export type UsageRow = { metric: UsageMetric; label: string; value: number;
  limit: number; period: string; percent: number | null; source?: UsageSource };
const counted = new Set<UsageMetric>(["worker_requests", "db_queries"]);
export type UsageOptions = { provider?: boolean };

export async function readUsage(db: DbLike, now = new Date(), options: UsageOptions = {}): Promise<UsageRow[]> {
  const counters = await db.select().from(usageCounters);
  const limits = await limitsOf(db);
  return usageMetrics.map((metric) => {
    const period = usagePeriod(metric, now);
    const value = Number(counters.find((row) => row.metric === metric && row.period === period)?.value ?? 0);
    const limit = limits[metric];
    return { metric, label: usageLabels[metric], value, limit, period,
      percent: limit > 0 ? Math.round(value / limit * 1000) / 10 : null,
      ...(counted.has(metric) ? { source: options.provider ? "cloudflare" as const : "estimate" as const } : {}) };
  });
}

// Snapshots for external/storage metrics. Attachment variants are an approximate
// bucket total; objects outside Flowbase and pending uploads are not counted.
export async function refreshUsage(db: Db, now = new Date(), options: UsageOptions = {}): Promise<UsageRow[]> {
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
  const rows = await readUsage(db, now, options);
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
