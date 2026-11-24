import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CHANGED_EVENT,
  CHANGES_CHANNEL,
  parseAreas,
  POLL_FALLBACK_MS,
  type ChangeArea,
} from "../../shared/realtime";
import { queryClient } from "./queryClient";
import { affectedBy, markStale } from "./queryAreas";

// Shared freshness (ADR-11, FLOW-206): an open screen shows another user's
// committed change without navigating. A "changed" ping from Supabase Realtime
// (no record data) names the areas the write changed (FLOW-304), and every
// screen on view that shows one of them refetches what it shows through the
// API, so the reader's access rules apply to what comes back. A ping without
// areas refetches every screen on view. While Realtime isn't connected, visible
// screens refetch every 30 seconds instead.
//
// One connection serves the whole app: every useResource / usePagedList screen
// takes part with nothing to opt into, and mounting the service again only
// counts another user of the same channel and timer.

// Connects to the ping source. Calls onPing for each ping, with the areas it
// names (null or undefined: anything may have changed), and onConnected with
// whether pings can currently arrive; returns a function that disconnects.
export type ChangeTransport = (handlers: {
  onPing: (areas?: readonly ChangeArea[] | null) => void;
  onConnected: (connected: boolean) => void;
}) => () => void;

// The Supabase Realtime broadcast channel the Worker pings (worker/realtime.ts).
export const supabaseTransport =
  (client: SupabaseClient): ChangeTransport =>
  ({ onPing, onConnected }) => {
    const channel = client
      .channel(CHANGES_CHANNEL)
      .on("broadcast", { event: CHANGED_EVENT }, (message) =>
        onPing(parseAreas((message as { payload?: { areas?: unknown } }).payload?.areas)),
      )
      .subscribe((status) => onConnected(status === "SUBSCRIBED"));
    return () => {
      onConnected(false);
      void client.removeChannel(channel);
    };
  };

type Options = {
  client?: QueryClient;
  pollMs?: number;
  // Pings within this window cause one refetch: a save that writes several
  // records, or several users saving at once.
  settleMs?: number;
};

// Called after each refresh of visible data with the areas that changed (null:
// anything), e.g. to re-check the signed-in user's own role and status on a
// users change (see AuthGate).
type ChangeListener = (areas: readonly ChangeArea[] | null) => void;
const changeListeners = new Set<ChangeListener>();
export function onDataChanged(listener: ChangeListener) {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

// What the signed-in user's own session must re-read after a change (FLOW-304):
// the roles and permissions matrix after a settings change, their profile (role
// and status) after a users change, and both when the change names no areas.
export function sessionRechecks(areas: readonly ChangeArea[] | null) {
  return {
    policy: !areas || areas.includes("settings"),
    profile: !areas || areas.includes("users"),
  };
}

function createLiveUpdates(transport: ChangeTransport, options: Options = {}) {
  const client = options.client ?? queryClient;
  const pollMs = options.pollMs ?? POLL_FALLBACK_MS;
  const settleMs = options.settleMs ?? 500;
  let connected = false;
  let wasConnected = false;
  // Changes not yet refetched: areas, or null for "anything". Kept while the
  // page is hidden and while pings settle.
  let missed: Set<ChangeArea> | null | undefined;
  let stopped = false;
  let poll: ReturnType<typeof setInterval> | undefined;
  let settle: ReturnType<typeof setTimeout> | undefined;
  const hidden = () => document.visibilityState === "hidden";
  const note = (areas: readonly ChangeArea[] | null) => {
    if (!areas) missed = null;
    else if (missed !== null) missed = new Set([...(missed ?? []), ...areas]);
  };

  const refresh = () => {
    if (missed === undefined) return;
    const areas = missed === null ? null : [...missed];
    const predicate = (query: { queryKey: readonly unknown[] }) => affectedBy(query.queryKey, areas);
    if (hidden()) {
      // Nothing on view to update: mark it stale and catch up on return.
      markStale(client, areas);
      return;
    }
    missed = undefined;
    void client.invalidateQueries({ predicate, refetchType: "active" });
    for (const listener of changeListeners) listener(areas);
  };
  // Anything may have changed (a poll, lost pings): refetch everything on view.
  const refreshAll = () => {
    note(null);
    refresh();
  };
  // Polls only while Realtime is down and the page is visible.
  const schedulePolling = () => {
    const wanted = !stopped && !connected && !hidden();
    if (wanted && !poll) poll = setInterval(refreshAll, pollMs);
    if (!wanted && poll) {
      clearInterval(poll);
      poll = undefined;
    }
  };
  const onPing = (areas?: readonly ChangeArea[] | null) => {
    if (stopped) return;
    note(areas ?? null);
    if (hidden()) return refresh();
    clearTimeout(settle);
    settle = setTimeout(refresh, settleMs);
  };
  const onConnected = (now: boolean) => {
    if (stopped) return;
    // Pings sent while disconnected were lost: refetch once on reconnecting.
    if (now && !connected && wasConnected) note(null);
    connected = now;
    if (now) wasConnected = true;
    schedulePolling();
    if (now && missed !== undefined && !hidden()) refresh();
  };
  const onVisibility = () => {
    schedulePolling();
    // Back on view after missing changes (or with no Realtime to tell us):
    // refetch at once rather than waiting for the next ping or poll.
    if (hidden()) return;
    if (!connected) refreshAll();
    else if (missed !== undefined) {
      clearTimeout(settle);
      refresh();
    }
  };

  document.addEventListener("visibilitychange", onVisibility);
  // Polling covers the time until Realtime confirms the subscription.
  schedulePolling();
  const disconnect = transport({ onPing, onConnected });
  return () => {
    stopped = true;
    document.removeEventListener("visibilitychange", onVisibility);
    clearTimeout(settle);
    clearInterval(poll);
    poll = undefined;
    disconnect();
  };
}

let users = 0;
let stopShared: (() => void) | undefined;
// Starts the shared service on first use and stops it when its last user does.
export function startLiveUpdates(
  transport: ChangeTransport,
  options?: Options,
) {
  users += 1;
  if (users === 1) stopShared = createLiveUpdates(transport, options);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    users -= 1;
    if (users === 0) {
      stopShared?.();
      stopShared = undefined;
    }
  };
}

// Keeps the signed-in workspace's data fresh (AuthGate passes its Supabase
// client only while someone is signed in; null stops the service).
export function useLiveUpdates(client: SupabaseClient | null) {
  useEffect(
    () => (client ? startLiveUpdates(supabaseTransport(client)) : undefined),
    [client],
  );
}
