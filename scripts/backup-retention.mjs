// Prints the backup object keys that are older than the retention window
// (FLOW-30). Reads one key per line on stdin. Ages come from the timestamp in
// the key name, so only keys written by scripts/backup.sh are ever selected;
// anything else in the bucket is left alone.
//
// Usage: node scripts/backup-retention.mjs [--now <ISO time>] [--days <n>] < keys
import { pathToFileURL } from "node:url";

const KEY = /^(?:.*\/)?flowbase-(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})Z\.dump$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export function backupTime(key) {
  const match = KEY.exec(key);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number);
  const time = Date.UTC(y, mo - 1, d, h, mi, s);
  // Reject impossible dates such as 2026-02-31 instead of letting Date roll them over.
  return new Date(time).getUTCDate() === d ? time : null;
}

export function expiredKeys(keys, now, days = 30) {
  const cutoff = now.getTime() - days * DAY_MS;
  return keys.filter((key) => {
    const time = backupTime(key);
    return time !== null && time < cutoff;
  });
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const now = new Date(option(args, "--now", new Date().toISOString()));
  const days = Number(option(args, "--days", "30"));
  if (Number.isNaN(now.getTime()) || !Number.isInteger(days) || days < 1) {
    console.error("Invalid --now or --days");
    process.exit(2);
  }
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const keys = input.split(/\s+/).filter(Boolean);
  for (const key of expiredKeys(keys, now, days)) console.log(key);
}
