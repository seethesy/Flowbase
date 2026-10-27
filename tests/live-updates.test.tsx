import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  startLiveUpdates,
  type ChangeTransport,
} from "../src/app/liveUpdates";
import { useResource } from "../src/app/useResource";
import { ApiRequestError } from "../src/services/core";
import { POLL_FALLBACK_MS } from "../shared/realtime";

// FLOW-206: one shared "changed" ping subscription (ADR-11) makes visible
// screens refetch through the API; a 30-second poll covers Realtime outages.
let visibility: DocumentVisibilityState = "visible";
const setVisibility = (state: DocumentVisibilityState) => {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
};
beforeEach(() => {
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  delete (document as { visibilityState?: unknown }).visibilityState;
});

// A transport the test drives: ping() and connect(), plus how often it was
// opened and closed.
function fakeTransport() {
  const state = {
    opened: 0,
    closed: 0,
    ping: () => {},
    connect: (connected: boolean) => void connected,
  };
  const transport: ChangeTransport = ({ onPing, onConnected }) => {
    state.opened += 1;
    state.ping = onPing;
    state.connect = onConnected;
    return () => {
      state.closed += 1;
    };
  };
  return { state, transport };
}

// A screen showing data; counts how often it loaded.
function screen(key = "live-test") {
  const loads = { count: 0 };
  const hook = renderHook(() =>
    useResource([key], async () => {
      loads.count += 1;
      return loads.count;
    }),
  );
  return { loads, hook };
}

it("refetches visible screens once per burst of pings while connected, without polling", async () => {
  const { state, transport } = fakeTransport();
  const stop = startLiveUpdates(transport);
  const { loads, hook } = screen();
  await waitFor(() => expect(hook.result.current.data).toBe(1));
  act(() => state.connect(true));
  await vi.advanceTimersByTimeAsync(POLL_FALLBACK_MS * 3);
  expect(loads.count).toBe(1);

  act(() => {
    state.ping();
    state.ping();
    state.ping();
  });
  await vi.advanceTimersByTimeAsync(600);
  await waitFor(() => expect(hook.result.current.data).toBe(2));
  expect(loads.count).toBe(2);
  stop();
});

it("polls every 30 seconds while Realtime is unavailable", async () => {
  const { state, transport } = fakeTransport();
  const stop = startLiveUpdates(transport);
  const { loads, hook } = screen();
  await waitFor(() => expect(hook.result.current.data).toBe(1));
  act(() => state.connect(false));
  await vi.advanceTimersByTimeAsync(POLL_FALLBACK_MS - 1_000);
  expect(loads.count).toBe(1);
  await vi.advanceTimersByTimeAsync(1_000);
  await waitFor(() => expect(hook.result.current.data).toBe(2));
  await vi.advanceTimersByTimeAsync(POLL_FALLBACK_MS);
  await waitFor(() => expect(loads.count).toBe(3));

  // Connecting stops the poll; a later drop starts it again.
  act(() => state.connect(true));
  const connectedLoads = loads.count;
  await vi.advanceTimersByTimeAsync(POLL_FALLBACK_MS * 2);
  expect(loads.count).toBe(connectedLoads);
  stop();
});

it("does no work while hidden and catches up once on return", async () => {
  const { state, transport } = fakeTransport();
  const stop = startLiveUpdates(transport);
  const { loads, hook } = screen();
  await waitFor(() => expect(hook.result.current.data).toBe(1));

  // Realtime down and the tab hidden: no polling.
  act(() => setVisibility("hidden"));
  await vi.advanceTimersByTimeAsync(POLL_FALLBACK_MS * 3);
  expect(loads.count).toBe(1);
  act(() => setVisibility("visible"));
  await waitFor(() => expect(loads.count).toBe(2));

  // Connected: a ping while hidden waits for the tab to return.
  act(() => state.connect(true));
  act(() => setVisibility("hidden"));
  act(() => state.ping());
  await vi.advanceTimersByTimeAsync(5_000);
  expect(loads.count).toBe(2);
  act(() => setVisibility("visible"));
  await waitFor(() => expect(hook.result.current.data).toBe(3));
  expect(loads.count).toBe(3);
  stop();
});

it("refetches once after reconnecting, since pings were lost meanwhile", async () => {
  const { state, transport } = fakeTransport();
  const stop = startLiveUpdates(transport);
  const { loads, hook } = screen();
  await waitFor(() => expect(hook.result.current.data).toBe(1));
  act(() => state.connect(true));
  await vi.advanceTimersByTimeAsync(1_000);
  expect(loads.count).toBe(1);
  act(() => state.connect(false));
  act(() => state.connect(true));
  await waitFor(() => expect(loads.count).toBe(2));
  stop();
});

it("shares one subscription and timer among repeated mounts", async () => {
  const { state, transport } = fakeTransport();
  const releases = [
    startLiveUpdates(transport),
    startLiveUpdates(transport),
    startLiveUpdates(transport),
  ];
  expect(state.opened).toBe(1);
  // Two screens on the same data share one request per refresh.
  const loads = { count: 0 };
  const load = async () => {
    loads.count += 1;
    return loads.count;
  };
  const first = renderHook(() => useResource(["shared-key"], load));
  const second = renderHook(() => useResource(["shared-key"], load));
  await waitFor(() => expect(second.result.current.data).toBe(1));
  expect(first.result.current.data).toBe(1);
  await vi.advanceTimersByTimeAsync(POLL_FALLBACK_MS);
  await waitFor(() => expect(first.result.current.data).toBe(2));
  await vi.advanceTimersByTimeAsync(100);
  expect(loads.count).toBe(2);

  releases[0]();
  releases[0]();
  releases[1]();
  expect(state.closed).toBe(0);
  releases[2]();
  expect(state.closed).toBe(1);
  // Stopped: no timer is left behind.
  await vi.advanceTimersByTimeAsync(POLL_FALLBACK_MS * 3);
  expect(loads.count).toBe(2);
  // A later mount starts a fresh subscription.
  startLiveUpdates(transport)();
  expect(state.opened).toBe(2);
});

it("stops refetching a screen once it unmounts", async () => {
  const { transport } = fakeTransport();
  const stop = startLiveUpdates(transport);
  const { loads, hook } = screen();
  await waitFor(() => expect(hook.result.current.data).toBe(1));
  hook.unmount();
  await vi.advanceTimersByTimeAsync(POLL_FALLBACK_MS * 2);
  expect(loads.count).toBe(1);
  stop();
});

it("drops data the reader may no longer see when a refetch is refused", async () => {
  let allowed = true;
  const hook = renderHook(() =>
    useResource(["revoked-record"], async () => {
      if (!allowed)
        throw new ApiRequestError(403, "FORBIDDEN", "You can't see this.");
      return { name: "Private client" };
    }),
  );
  await waitFor(() =>
    expect(hook.result.current.data).toEqual({ name: "Private client" }),
  );
  allowed = false;
  act(() => hook.result.current.reload());
  await waitFor(() => expect(hook.result.current.error).toBe("You can't see this."));
  expect(hook.result.current.data).toBeUndefined();
});

it("keeps showing data when a refetch fails for another reason", async () => {
  let failing = false;
  const hook = renderHook(() =>
    useResource(["flaky-record"], async () => {
      if (failing) throw new Error("Network down");
      return "Loaded";
    }),
  );
  await waitFor(() => expect(hook.result.current.data).toBe("Loaded"));
  failing = true;
  act(() => hook.result.current.reload());
  await waitFor(() => expect(hook.result.current.error).toBe("Network down"));
  expect(hook.result.current.data).toBe("Loaded");
});
