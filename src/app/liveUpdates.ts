import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CHANGED_EVENT,
  CHANGES_CHANNEL,
  POLL_FALLBACK_MS,
} from "../../shared/realtime";
import { queryClient } from "./queryClient";

// Shared freshness (ADR-11, FLOW-206): an open screen shows another user's
// committed change without navigating. A "changed" ping from Supabase Realtime
// (no record data) makes every screen on view refetch what it shows through the
// API, so the reader's access rules apply to what comes back. While Realtime
// isn't connected, visible screens refetch every 30 seconds instead.
//
// One connection serves the whole app: every useResource / usePagedList screen
// takes part with nothing to opt into, and mounting the service again only
// counts another user of the same channel and timer.

// Connects to the ping source. Calls onPing for each ping and onConnected with
// whether pings can currently arrive; returns a function that disconnects.
export type ChangeTransport = (handlers: {
  onPing: () => void;
  onConnected: (connected: boolean) => void;
}) => () => void;

// The Supabase Realtime broadcast channel the Worker pings (worker/realtime.ts).
export const supabaseTransport =
  (client: SupabaseClient): ChangeTransport =>
  ({ onPing, onConnected }) => {
    const channel = client
      .channel(CHANGES_CHANNEL)
      .on("broadcast", { event: CHANGED_EVENT }, () => onPing())
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

// Called after each refresh of visible data, e.g. to re-check the signed-in
// user's own role and status (see AuthGate).
const changeListeners = new Set<() => void>();
export function onDataChanged(listener: () => void) {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

function createLiveUpdates(transport: ChangeTransport, options: Options = {}) {
  const client = options.client ?? queryClient;
  const pollMs = options.pollMs ?? POLL_FALLBACK_MS;
  const settleMs = options.settleMs ?? 500;
  let connected = false;
  let wasConnected = false;
  let missed = false;
  let stopped = false;
  let poll: ReturnType<typeof setInterval> | undefined;
  let settle: ReturnType<typeof setTimeout> | undefined;
  const hidden = () => document.visibilityState === "hidden";

  const refresh = () => {
    if (hidden()) {
      // Nothing on view to update: remember it and catch up on return.
      missed = true;
      void client.invalidateQueries({ refetchType: "none" });
      return;
    }
    missed = false;
    void client.invalidateQueries({ refetchType: "active" });
    for (const listener of changeListeners) listener();
  };
  // Polls only while Realtime is down and the page is visible.
  const schedulePolling = () => {
    const wanted = !stopped && !connected && !hidden();
    if (wanted && !poll) poll = setInterval(refresh, pollMs);
    if (!wanted && poll) {
      clearInterval(poll);
      poll = undefined;
    }
  };
  const onPing = () => {
    if (stopped) return;
    if (hidden()) return refresh();
    clearTimeout(settle);
    settle = setTimeout(refresh, settleMs);
  };
  const onConnected = (now: boolean) => {
    if (stopped) return;
    // Pings sent while disconnected were lost: refetch once on reconnecting.
    if (now && !connected && wasConnected) missed = true;
    connected = now;
    if (now) wasConnected = true;
    schedulePolling();
    if (now && missed && !hidden()) refresh();
  };
  const onVisibility = () => {
    schedulePolling();
    // Back on view after missing changes (or with no Realtime to tell us):
    // refetch at once rather than waiting for the next ping or poll.
    if (!hidden() && (missed || !connected)) refresh();
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
