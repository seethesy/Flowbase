// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import type { Db } from "../../worker/db/client";
import {
  countUsage,
  flushUsage,
  pendingUsage,
  providerMetricsConfigured,
  readProviderMetrics,
  resetPendingUsage,
  storeProviderMetrics,
  USAGE_FLUSH_MS,
  usageFlushDue,
} from "../../worker/records/usage";
import { fakeDb } from "./fake-db";

beforeEach(() => resetPendingUsage());

const cloudflare = (body: unknown, status = 200) =>
  vi.fn<typeof fetch>(async () => Response.json(body, { status }));
const env = { CF_ANALYTICS_TOKEN: "analytics-token", CF_ACCOUNT_ID: "account-id",
  CF_WORKER_NAME: "flowbase", CF_HYPERDRIVE_ID: "hyperdrive-id" };
const answer = { data: { viewer: { accounts: [{ workers: [{ sum: { requests: 4167 } }], hyperdrive: [{ count: 32968 }] }] } }, errors: null };

it("counts in the isolate by metric and day, and is due a flush at most once a minute", async () => {
  const now = new Date("2026-11-24T10:00:00Z");
  countUsage("worker_requests", 1, now);
  countUsage("worker_requests", 1, now);
  countUsage("db_queries", 7, now);
  countUsage("db_queries", 0, now);
  countUsage("worker_requests", 1, new Date("2026-11-25T00:00:01Z"));
  expect(pendingUsage()).toEqual([
    { metric: "worker_requests", period: "2026-11-24", value: 2 },
    { metric: "db_queries", period: "2026-11-24", value: 7 },
    { metric: "worker_requests", period: "2026-11-25", value: 1 },
  ]);
  const fake = fakeDb();
  const flushedAt = Date.now();
  expect(await flushUsage(fake.db, flushedAt)).toBe(3);
  // Every pending count in one statement.
  expect(fake.statements).toEqual([{ kind: "insert", table: "usage_counters" }]);
  expect(pendingUsage()).toEqual([]);
  countUsage("worker_requests", 1);
  expect(usageFlushDue(flushedAt + USAGE_FLUSH_MS - 1)).toBe(false);
  expect(usageFlushDue(flushedAt + USAGE_FLUSH_MS)).toBe(true);
});

it("keeps the counts for the next try when a flush fails", async () => {
  countUsage("db_queries", 5, new Date("2026-11-24T10:00:00Z"));
  const failing = { insert: () => { throw new Error("database unavailable"); } } as unknown as Db;
  await expect(flushUsage(failing)).rejects.toThrow("database unavailable");
  countUsage("db_queries", 2, new Date("2026-11-24T10:01:00Z"));
  expect(pendingUsage()).toEqual([{ metric: "db_queries", period: "2026-11-24", value: 7 }]);
});

it("writes nothing when there is nothing to flush", async () => {
  const fake = fakeDb();
  expect(await flushUsage(fake.db)).toBe(0);
  expect(fake.statements).toEqual([]);
});

it("needs both the token and the account id for Cloudflare's figures", () => {
  expect(providerMetricsConfigured(env)).toBe(true);
  expect(providerMetricsConfigured({ CF_ACCOUNT_ID: "account-id" })).toBe(false);
  expect(providerMetricsConfigured({ CF_ANALYTICS_TOKEN: "analytics-token" })).toBe(false);
  expect(providerMetricsConfigured(undefined)).toBe(false);
});

it("reads today's Worker requests and Hyperdrive queries from the GraphQL Analytics API", async () => {
  const fetcher = cloudflare(answer);
  const now = new Date("2026-11-24T15:30:00Z");
  expect(await readProviderMetrics(env, now, fetcher as unknown as typeof fetch)).toEqual({ requests: 4167, queries: 32968 });
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe("https://api.cloudflare.com/client/v4/graphql");
  expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer analytics-token");
  const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, string> };
  expect(body.query).toContain("workersInvocationsAdaptive");
  expect(body.query).toContain("hyperdriveQueriesAdaptiveGroups");
  expect(body.variables).toEqual({ accountTag: "account-id", start: "2026-11-24T00:00:00.000Z",
    end: "2026-11-24T15:30:00.000Z", script: "flowbase", config: "hyperdrive-id" });
});

it("stores Cloudflare's figures for today (FLOW-305 AC2)", async () => {
  const fake = fakeDb();
  const stored = await storeProviderMetrics(fake.db, env, new Date("2026-11-24T15:00:00Z"),
    cloudflare(answer) as unknown as typeof fetch);
  expect(stored).toBe(true);
  expect(fake.statements).toEqual([
    { kind: "insert", table: "usage_counters" },
    { kind: "insert", table: "usage_counters" },
  ]);
});

it("leaves the estimate alone without the token, and fails loudly on an API error", async () => {
  const fake = fakeDb();
  const fetcher = cloudflare(answer);
  expect(await storeProviderMetrics(fake.db, {}, new Date(), fetcher as unknown as typeof fetch)).toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
  expect(fake.statements).toEqual([]);
  await expect(readProviderMetrics(env, new Date(), cloudflare({ data: null, errors: [{ message: "not authorized" }] }) as unknown as typeof fetch))
    .rejects.toThrow("not authorized");
  await expect(readProviderMetrics(env, new Date(), cloudflare({}, 403) as unknown as typeof fetch))
    .rejects.toThrow("cloudflare_analytics_403");
});
