// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { httpIngest, leadRecordId } from "../collector/src/ingest.ts";
import { runCollector } from "../collector/src/run.ts";
import { siteModules } from "../collector/src/sites/index.ts";
import { decryptState, encryptState } from "../collector/src/state.ts";
import { isCollectionSlot, newYorkHour } from "../collector/src/window.ts";
import { collectedLeadSchema, collectorRunSchema } from "../shared/collector.ts";

// The lead collector framework (FLOW-102), without a browser.
describe("collection window (AC4)", () => {
  it("runs every 2 hours from 8am to 8pm New York time, in both EDT and EST", () => {
    // EDT (UTC-4): 12:00 UTC is 8am; EST (UTC-5): 13:00 UTC is 8am.
    expect(newYorkHour(new Date("2026-07-01T12:00:00Z"))).toBe(8);
    expect(newYorkHour(new Date("2026-12-01T13:00:00Z"))).toBe(8);
    const slots = (day: string) =>
      Array.from({ length: 24 }, (_, hour) => hour).filter((hour) =>
        isCollectionSlot(new Date(`${day}T${String(hour).padStart(2, "0")}:05:00Z`)),
      );
    expect(slots("2026-07-01")).toEqual([0, 12, 14, 16, 18, 20, 22]);
    expect(slots("2026-12-01")).toEqual([1, 13, 15, 17, 19, 21, 23]);
  });

  it("exits outside the window without opening a browser", async () => {
    const launch = vi.fn();
    const ingest = { postLeads: vi.fn(), postRun: vi.fn() };
    const result = await runCollector({
      modules: [
        {
          site: "fake",
          source: "Fake",
          checkLogin: vi.fn(),
          listLeads: vi.fn(),
          readLead: vi.fn(),
        },
      ],
      ingest,
      state: { load: vi.fn(), save: vi.fn() },
      launch,
      // 3am New York time.
      now: () => new Date("2026-10-23T07:00:00Z"),
      log: () => undefined,
    });
    expect(result).toEqual({ skipped: true, runs: [] });
    expect(launch).not.toHaveBeenCalled();
    expect(ingest.postRun).not.toHaveBeenCalled();
  });

  it("matches the hours the ops workflow fires on", () => {
    const template = readFileSync("ops-templates/collector.yml", "utf8");
    expect(template).toContain('cron: "0 0,1,12-23 * * *"');
    expect(template).toContain("timeout-minutes: 5");
    expect(template).toContain("retention-days: 3");
  });
});

describe("saved sessions", () => {
  it("encrypts the state and reads it back only with the same key", () => {
    const state = { storageState: { cookies: [{ name: "session", value: "abc" }] }, lastSuccessAt: "2026-10-23T12:00:00.000Z" };
    const sealed = encryptState(state, "key-one");
    expect(sealed).not.toContain("session");
    expect(decryptState(sealed, "key-one")).toEqual(state);
    expect(decryptState(sealed, "key-two")).toBeUndefined();
    expect(decryptState("damaged", "key-one")).toBeUndefined();
  });
});

describe("posting to the Worker", () => {
  it("names each version of a lead and validates the shape the Worker expects", () => {
    const details = { source: "Bark", sourceLeadId: "b-1", name: "Sample" };
    expect(leadRecordId("bark", "b-1", details)).toBe(leadRecordId("bark", "b-1", { ...details }));
    expect(leadRecordId("bark", "b-1", details)).not.toBe(
      leadRecordId("bark", "b-1", { ...details, name: "Changed" }),
    );
    expect(() =>
      collectedLeadSchema.parse({ ...details, site: "bark", sourceRecordId: "bark:b-1:x" }),
    ).not.toThrow();
    expect(() =>
      collectorRunSchema.parse({
        sourceRecordId: "r:bark",
        runId: "8d6f2a4e-5b1c-4e8a-9f3d-2c7b1a0e6d54",
        site: "bark",
        startedAt: "2026-10-23T12:00:00.000Z",
        finishedAt: "2026-10-23T12:01:00.000Z",
        leadsFound: 0,
        status: "sideways",
      }),
    ).toThrow();
  });

  it("posts one lead per request with the service token and retries a server error once", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    let failures = 1;
    const fetchStub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (failures-- > 0) return new Response(null, { status: 503 });
      return new Response("{}", { status: 202 });
    });
    const ingest = httpIngest({
      baseUrl: "https://flowbase.example",
      token: "t0ken",
      fetch: fetchStub as unknown as typeof fetch,
    });
    const lead = { site: "bark", source: "Bark", sourceLeadId: "b-1", sourceRecordId: "bark:b-1:x" };
    await ingest.postLeads([lead, { ...lead, sourceLeadId: "b-2", sourceRecordId: "bark:b-2:x" }]);
    expect(calls.map((call) => call.url)).toEqual([
      "https://flowbase.example/api/ingest/leads",
      "https://flowbase.example/api/ingest/leads",
      "https://flowbase.example/api/ingest/leads",
    ]);
    expect(new Headers(calls[0].init?.headers).get("Authorization")).toBe("Bearer t0ken");
    fetchStub.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(
      ingest.postRun({
        sourceRecordId: "r:bark",
        runId: "8d6f2a4e-5b1c-4e8a-9f3d-2c7b1a0e6d54",
        site: "bark",
        startedAt: "2026-10-23T12:00:00.000Z",
        finishedAt: "2026-10-23T12:01:00.000Z",
        leadsFound: 0,
        status: "ok",
      }),
    ).rejects.toThrow("answered 401");
  });

  it("ships no site modules until FLOW-103 to FLOW-106 add them", () => {
    expect(siteModules).toEqual([]);
  });
});

describe("no credentials in the repo (AC3)", () => {
  const files = (directory: string): string[] =>
    readdirSync(directory).flatMap((name) => {
      const path = join(directory, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    });
  const credential =
    /(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*["'][^"'$]{6,}["']|-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/i;

  it("keeps collector/ and ops-templates/ free of credentials", () => {
    const scanned = [...files("collector"), ...files("ops-templates")];
    expect(scanned.length).toBeGreaterThan(5);
    expect(scanned.filter((path) => credential.test(readFileSync(path, "utf8")))).toEqual([]);
    // Secrets are referenced by name only.
    const template = readFileSync("ops-templates/collector.yml", "utf8");
    for (const line of template.split("\n").filter((l) => /(TOKEN|KEY|PASSWORD|USERNAME|URL):/.test(l)))
      expect(line).toMatch(/\$\{\{ secrets\.[A-Z_]+ \}\}/);
  });

  it("uses no secrets in the Flowbase CI workflow", () => {
    for (const path of files(".github/workflows"))
      expect(readFileSync(path, "utf8")).not.toMatch(/secrets\./);
  });
});
