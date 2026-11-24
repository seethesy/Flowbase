import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  onDataChanged,
  sessionRechecks,
  startLiveUpdates,
  type ChangeTransport,
} from "../../src/app/liveUpdates";
import { useResource } from "../../src/app/useResource";
import { ApiRequestError } from "../../src/services/core";
import { POLL_FALLBACK_MS, type ChangeArea } from "../../shared/realtime";
import { affectedBy } from "../../src/app/queryAreas";

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
  const state: {
    opened: number;
    closed: number;
    ping: (areas?: ChangeArea[] | null) => void;
    connect: (connected: boolean) => void;
  } = { opened: 0, closed: 0, ping: () => {}, connect: () => {} };
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
function screen(key = "live-test", ...rest: string[]) {
  const loads = { count: 0 };
  const hook = renderHook(() =>
    useResource([key, ...rest], async () => {
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

// FLOW-304: a ping refetches only the screens its areas cover.
it("refetches only the screens a ping's areas cover (AC1)", async () => {
  const { state, transport } = fakeTransport();
  const stop = startLiveUpdates(transport);
  const leads = screen("leads", "inbox");
  const inventory = screen("inventory-items", "master");
  const kitchen = screen("kitchen-overview");
  await waitFor(() => expect(kitchen.hook.result.current.data).toBe(1));
  await waitFor(() => expect(leads.hook.result.current.data).toBe(1));
  await waitFor(() => expect(inventory.hook.result.current.data).toBe(1));
  act(() => state.connect(true));

  act(() => state.ping(["leads"]));
  await vi.advanceTimersByTimeAsync(600);
  await waitFor(() => expect(leads.hook.result.current.data).toBe(2));
  await vi.advanceTimersByTimeAsync(100);
  expect(inventory.loads.count).toBe(1);
  expect(kitchen.loads.count).toBe(1);

  // Pings that settle together refetch the union of their areas, once.
  act(() => {
    state.ping(["inventory"]);
    state.ping(["kitchen"]);
  });
  await vi.advanceTimersByTimeAsync(600);
  await waitFor(() => expect(kitchen.hook.result.current.data).toBe(2));
  await waitFor(() => expect(inventory.hook.result.current.data).toBe(2));
  expect(leads.loads.count).toBe(2);
  stop();
});

it("refetches everything for a ping without areas (AC4)", async () => {
  const { state, transport } = fakeTransport();
  const stop = startLiveUpdates(transport);
  const leads = screen("leads");
  const inventory = screen("inventory-items");
  await waitFor(() => expect(leads.hook.result.current.data).toBe(1));
  await waitFor(() => expect(inventory.hook.result.current.data).toBe(1));
  act(() => state.connect(true));
  act(() => state.ping());
  await vi.advanceTimersByTimeAsync(600);
  await waitFor(() => expect(leads.hook.result.current.data).toBe(2));
  await waitFor(() => expect(inventory.hook.result.current.data).toBe(2));
  stop();
});

it("reuses a screen's data for 30 seconds unless a ping covers it (AC5)", async () => {
  const { state, transport } = fakeTransport();
  const stop = startLiveUpdates(transport);
  act(() => state.connect(true));
  const loads = { count: 0 };
  const open = () =>
    renderHook(() =>
      useResource(["leads", "list"], async () => {
        loads.count += 1;
        return loads.count;
      }),
    );
  const first = open();
  await waitFor(() => expect(first.result.current.data).toBe(1));
  first.unmount();
  // Back within 30 seconds: the cached copy, no request.
  await vi.advanceTimersByTimeAsync(10_000);
  const second = open();
  await vi.advanceTimersByTimeAsync(100);
  expect(second.result.current.data).toBe(1);
  expect(loads.count).toBe(1);
  second.unmount();
  // A ping for another area leaves it fresh; one for leads marks it stale.
  act(() => state.ping(["inventory"]));
  await vi.advanceTimersByTimeAsync(600);
  const third = open();
  await vi.advanceTimersByTimeAsync(100);
  expect(loads.count).toBe(1);
  third.unmount();
  act(() => state.ping(["leads"]));
  await vi.advanceTimersByTimeAsync(600);
  const fourth = open();
  await waitFor(() => expect(fourth.result.current.data).toBe(2));
  stop();
});

it("tells listeners which areas changed, so a session re-reads only what they cover (AC3)", async () => {
  const { state, transport } = fakeTransport();
  const stop = startLiveUpdates(transport);
  act(() => state.connect(true));
  const heard: (readonly ChangeArea[] | null)[] = [];
  const stopListening = onDataChanged((areas) => heard.push(areas));
  act(() => state.ping(["users"]));
  await vi.advanceTimersByTimeAsync(600);
  act(() => state.ping());
  await vi.advanceTimersByTimeAsync(600);
  expect(heard).toEqual([["users"], null]);
  stopListening();
  // A role or status change re-reads the profile; a roles matrix change the
  // permissions; a lead change neither; an unknown change both.
  expect(sessionRechecks(["users"])).toEqual({ policy: false, profile: true });
  expect(sessionRechecks(["settings"])).toEqual({ policy: true, profile: false });
  expect(sessionRechecks(["leads"])).toEqual({ policy: false, profile: false });
  expect(sessionRechecks(null)).toEqual({ policy: true, profile: true });
  stop();
});

it("maps query keys to areas, refetching unknown keys on any change", () => {
  expect(affectedBy(["leads", "inbox"], ["leads"])).toBe(true);
  expect(affectedBy(["leads", "inbox"], ["inventory"])).toBe(false);
  expect(affectedBy(["leads", "inbox"], [])).toBe(false);
  expect(affectedBy(["leads", "inbox"], null)).toBe(true);
  // Settings (roles and permissions among them) can change any screen.
  expect(affectedBy(["inventory-items"], ["settings"])).toBe(true);
  expect(affectedBy(["some-new-screen"], ["kitchen"])).toBe(true);
  expect(affectedBy(["layout-card", "leads", "card-1", "/api/leads"], ["leads"])).toBe(true);
  expect(affectedBy(["layout-card", "leads", "card-1", "/api/leads"], ["kitchen"])).toBe(false);
});
