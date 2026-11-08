import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

// Runs scripts/check-health.mjs against a local server that plays the production
// Worker (FLOW-173).
const root = fileURLToPath(new URL("../../", import.meta.url));
let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
});

type Reply = { status?: number; body?: unknown; raw?: string };
async function serve(replies: Reply[]) {
  const seen: string[] = [];
  const local = createServer((request, response) => {
    seen.push(request.url ?? "");
    const reply = replies[Math.min(seen.length - 1, replies.length - 1)];
    response.writeHead(reply.status ?? 200, { "content-type": "application/json" });
    response.end(reply.raw ?? JSON.stringify(reply.body ?? {}));
  });
  server = local;
  await new Promise<void>((resolve) => local.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(local.address() as AddressInfo).port}`,
    seen,
  };
}

function runCheck(env: Record<string, string>) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve) => {
      const child = spawn(process.execPath, ["scripts/check-health.mjs"], {
        cwd: root,
        env: { PATH: process.env.PATH ?? "", HEALTH_RETRY_MS: "10", ...env },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    },
  );
}

describe("deploy health check (FLOW-173)", () => {
  it("passes when production reports a reachable database", async () => {
    const { url, seen } = await serve([{ body: { status: "ok", database: "reachable" } }]);
    const result = await runCheck({ HEALTH_URL: url });
    expect(result.code).toBe(0);
    expect(seen).toEqual(["/api/health"]);
    expect(result.stdout).toContain("Deploy verified");
  });

  it("retries while the new version activates, then passes", async () => {
    const { url, seen } = await serve([
      { status: 503, body: { error: "starting" } },
      { body: { status: "ok", database: "unreachable" } },
      { body: { status: "ok", database: "reachable" } },
    ]);
    const result = await runCheck({ HEALTH_URL: url, HEALTH_ATTEMPTS: "5" });
    expect(result.code).toBe(0);
    expect(seen).toHaveLength(3);
  });

  it.each([
    ["unreachable", { status: "ok", database: "unreachable" }],
    ["not configured", { status: "ok", database: "not_configured" }],
    ["no database field", { status: "ok" }],
  ])("exits non-zero when the database is %s after every try", async (_name, body) => {
    const { url, seen } = await serve([{ body }]);
    const result = await runCheck({ HEALTH_URL: url, HEALTH_ATTEMPTS: "3" });
    expect(result.code).toBe(1);
    expect(seen).toHaveLength(3);
    expect(result.stderr).toContain("Deploy verification failed");
    expect(result.stderr).toContain("wrangler rollback");
  });

  it("exits non-zero when the response is not JSON or the server is down", async () => {
    const { url } = await serve([{ status: 502, raw: "<html>bad gateway</html>" }]);
    const bad = await runCheck({ HEALTH_URL: url, HEALTH_ATTEMPTS: "2" });
    expect(bad.code).toBe(1);

    server?.close();
    server = undefined;
    const down = await runCheck({ HEALTH_URL: url, HEALTH_ATTEMPTS: "2" });
    expect(down.code).toBe(1);
    expect(down.stderr).toContain("request failed");
  });

  it("does not accept a reachable database behind a failing status code", async () => {
    const { url } = await serve([{ status: 500, body: { database: "reachable" } }]);
    const result = await runCheck({ HEALTH_URL: url, HEALTH_ATTEMPTS: "2" });
    expect(result.code).toBe(1);
  });
});
