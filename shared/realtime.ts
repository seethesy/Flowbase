// Shared freshness (ADR-11, FLOW-206). After a write commits, the Worker sends
// a "changed" ping on one Supabase Realtime broadcast channel. The ping carries
// no record data; each open screen refetches what it shows through the API,
// which applies the reader's own access rules.
export const CHANGES_CHANNEL = "flowbase-changes";
export const CHANGED_EVENT = "changed";
// While Realtime is unavailable, visible screens refetch on this interval.
export const POLL_FALLBACK_MS = 30_000;

// The only payload a ping may carry: when the write committed. Never record ids,
// names or other fields — anyone with the public key can join the channel.
export type ChangedPing = { at: string };
