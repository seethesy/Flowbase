// Shared freshness (ADR-11, FLOW-206). After a write commits, the Worker sends
// a "changed" ping on one Supabase Realtime broadcast channel. The ping carries
// no record data; each open screen refetches what it shows through the API,
// which applies the reader's own access rules.
export const CHANGES_CHANNEL = "flowbase-changes";
export const CHANGED_EVENT = "changed";
// While Realtime is unavailable, visible screens refetch on this interval.
export const POLL_FALLBACK_MS = 30_000;

// The parts of the app a write can change (FLOW-304). A ping names the areas
// its write changed, and an open screen refetches only the data under them.
export const changeAreas = [
  "leads",
  "clients",
  "events",
  "proposals",
  "approvals",
  "sales",
  "communications",
  "inventory",
  "vendors",
  "kitchen",
  "tasks",
  "production",
  "documents",
  "staff",
  "time",
  "users",
  "settings",
  "layout",
  "copy",
] as const;
export type ChangeArea = (typeof changeAreas)[number];
export const isChangeArea = (value: unknown): value is ChangeArea =>
  typeof value === "string" && (changeAreas as readonly string[]).includes(value);

// The only payload a ping may carry: when the write committed and the names of
// the areas it changed. Never record ids, names or other fields — anyone with
// the public key can join the channel. A ping without `areas` (an older Worker,
// or a write no area covers) means "anything may have changed".
export type ChangedPing = { at: string; areas?: ChangeArea[] };

// The Worker answers a write with the areas it changed, so the browser that
// saved marks only those cached screens stale. Empty: nothing shared changed.
// Absent: unknown, so everything is marked stale.
export const CHANGED_AREAS_HEADER = "X-Changed-Areas";

// The areas a ping or header names, or null when it names none (anything may
// have changed). Unknown names are dropped, so a newer Worker's area never
// breaks an older browser; a list with only unknown names counts as none.
export function parseAreas(value: unknown): ChangeArea[] | null {
  const list =
    typeof value === "string"
      ? value.split(",").map((area) => area.trim()).filter(Boolean)
      : value;
  if (!Array.isArray(list)) return null;
  const known = list.filter(isChangeArea);
  return known.length || list.length === 0 ? [...new Set(known)] : null;
}
