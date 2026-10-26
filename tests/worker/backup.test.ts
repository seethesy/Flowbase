import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");
const DAY = 24 * 60 * 60 * 1000;
const keyAt = (time: number) =>
  `production/flowbase-${new Date(time).toISOString().slice(0, 19).replace(/:/g, "")}Z.dump`;

function retention(keys: string[], args: string[]) {
  const result = spawnSync(process.execPath, ["scripts/backup-retention.mjs", ...args], {
    cwd: root,
    input: keys.join("\n"),
    encoding: "utf8",
  });
  return { status: result.status, keys: result.stdout.split("\n").filter(Boolean) };
}

describe("backup retention (FLOW-30 AC2)", () => {
  const now = "2026-10-22T07:15:00Z";

  it("selects only dumps older than 30 days", () => {
    const keys = [
      "production/flowbase-2026-09-21T071459Z.dump", // 30 days + 1 s
      "production/flowbase-2026-09-22T071500Z.dump", // exactly 30 days
      "production/flowbase-2026-10-21T071500Z.dump",
      "production/flowbase-2025-01-01T000000Z.dump",
    ];
    expect(retention(keys, ["--now", now])).toEqual({
      status: 0,
      keys: [
        "production/flowbase-2026-09-21T071459Z.dump",
        "production/flowbase-2025-01-01T000000Z.dump",
      ],
    });
  });

  it("never selects objects it did not write", () => {
    const keys = [
      "production/notes.txt",
      "production/flowbase-2020-01-01.dump",
      "production/flowbase-2020-02-31T000000Z.dump",
      "production/other-2020-01-01T000000Z.dump",
      "production/flowbase-2020-01-01T000000Z.dump.bak",
    ];
    expect(retention(keys, ["--now", now]).keys).toEqual([]);
  });

  it("honours a custom window and rejects invalid options", () => {
    const keys = ["production/flowbase-2026-10-10T000000Z.dump"];
    expect(retention(keys, ["--now", now, "--days", "7"]).keys).toEqual(keys);
    expect(retention(keys, ["--now", "not-a-date"]).status).toBe(2);
    expect(retention(keys, ["--now", now, "--days", "0"]).status).toBe(2);
  });
});

// The script tests need a POSIX bash (Linux CI, macOS). On Windows, `bash` is
// often missing or WSL, which cannot run these fake binaries, so they are skipped
// there with this reason instead of reporting a misleading result (FLOW-204 AC4).
const posixShell = process.platform !== "win32";

// Runs scripts/backup.sh with fake pg_dump and aws binaries that log their
// arguments. Throws when the shell never ran the script to an exit code, so a
// launch failure can never satisfy a failure-path assertion (FLOW-204).
function runBackup(pgDump: string, listedKeys: string[], shell = "bash") {
  const dir = mkdtempSync(join(tmpdir(), "flowbase-backup-"));
  try {
    const log = join(dir, "aws.log");
    const ran = join(dir, "pg_dump.ran");
    const fake = (name: string, body: string) => {
      writeFileSync(join(dir, name), `#!/usr/bin/env bash\n${body}\n`);
      chmodSync(join(dir, name), 0o755);
    };
    fake("pg_dump", `: > "${ran}"\n${pgDump}`);
    fake(
      "aws",
      `echo "$*" >> "${log}"
if [[ "$1 $2" == "s3api list-objects-v2" ]]; then printf '%s\\t' ${listedKeys.map((k) => `'${k}'`).join(" ")}; echo; fi`,
    );
    const result = spawnSync(shell, [join(root, "scripts/backup.sh")], {
      encoding: "utf8",
      env: {
        PATH: `${dir}:${process.env.PATH ?? ""}`,
        DATABASE_URL: "postgres://example",
        R2_ACCOUNT_ID: "account",
        R2_ACCESS_KEY_ID: "id",
        R2_SECRET_ACCESS_KEY: "secret",
      },
    });
    if (result.error || typeof result.status !== "number") {
      throw new Error(
        `scripts/backup.sh did not run to an exit code with "${shell}" ` +
          `(${result.error?.message ?? `signal ${result.signal}`}). ` +
          "These tests need a POSIX bash on PATH (Linux CI or macOS).",
      );
    }
    const calls = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
    return { status: result.status, stderr: result.stderr, dumpRan: existsSync(ran), calls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("backup test harness (FLOW-204)", () => {
  it("fails loudly instead of returning a status when the shell cannot launch", () => {
    expect(() => runBackup("exit 1", [], join(tmpdir(), "flowbase-missing-bash"))).toThrow(
      /did not run to an exit code/,
    );
  });
});

describe.skipIf(!posixShell)("backup script (FLOW-30 AC1; needs a POSIX bash, skipped on Windows)", () => {
  it("exits non-zero and uploads nothing when the dump fails", () => {
    const result = runBackup("exit 1", []);
    expect(result.dumpRan).toBe(true);
    expect(result.status).toBeGreaterThan(0);
    expect(result.stderr).toContain("pg_dump failed; nothing was uploaded.");
    expect(result.calls).toEqual([]);
  });

  it("exits non-zero and uploads nothing when the dump is empty", () => {
    const writeEmpty = 'for a in "$@"; do [[ "$a" == --file=* ]] && : > "${a#--file=}"; done; exit 0';
    const result = runBackup(writeEmpty, []);
    expect(result.dumpRan).toBe(true);
    expect(result.status).toBeGreaterThan(0);
    expect(result.stderr).toContain("pg_dump produced an empty file; nothing was uploaded.");
    expect(result.calls).toEqual([]);
  });

  it("uploads, then deletes only expired dumps", () => {
    const old = keyAt(Date.now() - 31 * DAY);
    const recent = keyAt(Date.now() - 2 * DAY);
    const writeDump = 'for a in "$@"; do [[ "$a" == --file=* ]] && echo dump > "${a#--file=}"; done; exit 0';
    const { status, dumpRan, calls } = runBackup(writeDump, [old, recent, "production/readme.txt"]);
    expect(dumpRan).toBe(true);
    expect(status).toBe(0);
    expect(calls[0]).toMatch(
      /^s3 cp .*flowbase-\d{4}-\d{2}-\d{2}T\d{6}Z\.dump s3:\/\/flowbase-backups\/production\/flowbase-/,
    );
    expect(calls[0]).toContain("--endpoint-url https://account.r2.cloudflarestorage.com");
    expect(calls[1]).toMatch(/^s3api list-objects-v2 --bucket flowbase-backups --prefix production\//);
    expect(calls.slice(2)).toEqual([
      `s3 rm s3://flowbase-backups/${old} --endpoint-url https://account.r2.cloudflarestorage.com --only-show-errors`,
    ]);
  });
});

describe("ops backup template (FLOW-30 AC3, FLOW-175)", () => {
  const template = read("ops-templates/backup.yml");
  const restore = read("docs/restore.md");
  const secretsTable = restore.slice(restore.indexOf("| Secret |"), restore.indexOf("3. Make sure"));

  it("references secrets by name only", () => {
    const envValues = [...template.matchAll(/^\s+[A-Z][A-Z0-9_]+: (.+)$/gm)].map((m) => m[1]);
    const secretNames = [...template.matchAll(/\$\{\{ secrets\.([A-Z0-9_]+) \}\}/g)].map((m) => m[1]);
    expect(secretNames).toEqual([
      "FLOWBASE_READ_TOKEN",
      "FLOWBASE_PROD_DATABASE_URL",
      "R2_ACCOUNT_ID",
      "R2_BACKUP_ACCESS_KEY_ID",
      "R2_BACKUP_SECRET_ACCESS_KEY",
    ]);
    for (const value of envValues) {
      expect(value).toMatch(/^\$\{\{ secrets\.[A-Z0-9_]+ \}\}$|^flowbase-backups$|^\/usr\/lib\/postgresql\//);
    }
    expect(template).not.toMatch(/postgres(ql)?:\/\//);
  });

  it("lists exactly the secrets the template reads in the docs/restore.md table", () => {
    expect(restore).toContain("ops-templates/backup.yml");
    const used = new Set([...template.matchAll(/\$\{\{ secrets\.([A-Z0-9_]+) \}\}/g)].map((m) => m[1]));
    const documented = new Set([...secretsTable.matchAll(/^\s*\| `([A-Z0-9_]+)` \|/gm)].map((m) => m[1]));
    expect(documented).toEqual(used);
  });

  it("runs the Flowbase script from the reviewed ops-v1 tag", () => {
    expect(template).toContain("repository: seethesy/Flowbase");
    expect(template).toContain("bash flowbase/scripts/backup.sh");
  });
});

describe("ops templates check out a pinned ref with a read token (FLOW-175)", () => {
  // Returns the `with:` block of the actions/checkout step.
  const checkout = (path: string) => {
    const template = read(path);
    const step = template.slice(template.indexOf("uses: actions/checkout@"));
    return step.slice(0, step.search(/\n\s+- /));
  };

  for (const path of ["ops-templates/backup.yml", "ops-templates/collector.yml"]) {
    it(`${path} checks out ops-v1 with FLOWBASE_READ_TOKEN`, () => {
      const step = checkout(path);
      expect(step).toContain("repository: seethesy/Flowbase");
      expect(step).toContain("ref: ops-v1");
      expect(step).not.toMatch(/ref: main/);
      expect(step).toContain("token: ${{ secrets.FLOWBASE_READ_TOKEN }}");
      expect(step).toContain("persist-credentials: false");
    });
  }

  it("documents how to move the tag", () => {
    for (const path of ["docs/restore.md", "collector/README.md"]) {
      expect(read(path)).toContain("ops-v1");
      expect(read(path)).toContain("Update the scripts the ops repo runs");
    }
    expect(read("docs/restore.md")).toContain("git push origin -f refs/tags/ops-v1");
  });
});
