import { describe, expect, it, vi } from "vitest";
import type { ActivitySessionInput } from "../shared/time-tracking";
import { ApiRequestError } from "../src/services/core";
import {
  ActivityTracker,
  contextForPath,
  type TrackingContext,
} from "../src/services/time-tracking";

// Session logic for automatic time tracking (FLOW-119), driven by a fake clock.
const MIN = 60_000;
const eventId = "e0000000-0000-4000-8000-000000000001";
const proposal: TrackingContext = {
  activity: "proposal_work",
  recordType: null,
  recordId: null,
};
const beo: TrackingContext = {
  activity: "beo_editing",
  recordType: "beo",
  recordId: "b0000000-0000-4000-8000-000000000001",
};
const event: TrackingContext = {
  activity: "event_planning",
  recordType: "event",
  recordId: eventId,
};

function setup(visible = true) {
  let now = Date.parse("2026-11-02T14:00:00.000Z");
  let ids = 0;
  const sent: ActivitySessionInput[][] = [];
  const send = vi.fn(async (sessions: ActivitySessionInput[]) => {
    sent.push(sessions);
  });
  const tracker = new ActivityTracker({
    now: () => now,
    send,
    visible,
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
  });
  return {
    tracker,
    send,
    sent,
    advance: (ms: number) => {
      now += ms;
    },
    // Every session sent, last version of each, with its length in minutes.
    sessions: () => {
      const latest = new Map<string, ActivitySessionInput>();
      for (const batch of sent) for (const s of batch) latest.set(s.id, s);
      return [...latest.values()].map((s) => ({
        activity: s.activity,
        recordId: s.recordId,
        minutes: (Date.parse(s.endedAt) - Date.parse(s.startedAt)) / MIN,
      }));
    },
  };
}

describe("ActivityTracker", () => {
  it("credits active time to the screen on show", async () => {
    const t = setup();
    t.tracker.setContext(event);
    t.tracker.input();
    t.advance(1 * MIN);
    t.tracker.input();
    t.advance(1 * MIN);
    await t.tracker.flush();
    expect(t.sessions()).toEqual([
      { activity: "event_planning", recordId: eventId, minutes: 2 },
    ]);
  });

  it("accrues nothing without input", async () => {
    const t = setup();
    t.tracker.setContext(event);
    t.advance(10 * MIN);
    await t.tracker.tick();
    expect(t.send).not.toHaveBeenCalled();
  });

  // AC1
  // The cutoff is 5 minutes.
  it("stops accruing after the idle cutoff, at the moment it passed", async () => {
    const t = setup();
    t.tracker.setContext(event);
    t.tracker.input();
    t.advance(12 * MIN);
    await t.tracker.tick();
    expect(t.sessions()).toEqual([
      { activity: "event_planning", recordId: eventId, minutes: 5 },
    ]);
    // Coming back starts a new session from the new input.
    t.tracker.input();
    t.advance(2 * MIN);
    await t.tracker.flush();
    expect(t.sessions().map((s) => s.minutes)).toEqual([5, 2]);
  });

  // AC1
  it("accrues nothing while the tab is hidden", async () => {
    const t = setup();
    t.tracker.setContext(event);
    t.tracker.input();
    t.advance(1 * MIN);
    t.tracker.setVisible(false);
    t.advance(1 * MIN);
    t.tracker.input();
    t.advance(1 * MIN);
    await t.tracker.flush();
    expect(t.sessions().map((s) => s.minutes)).toEqual([1]);
    // Shown again: nothing until the user types or clicks.
    t.tracker.setVisible(true);
    t.advance(2 * MIN);
    await t.tracker.tick();
    expect(t.sessions().map((s) => s.minutes)).toEqual([1]);
  });

  it("starts nothing in a tab that opened hidden", async () => {
    const t = setup(false);
    t.tracker.setContext(event);
    t.tracker.input();
    t.advance(2 * MIN);
    await t.tracker.flush();
    expect(t.send).not.toHaveBeenCalled();
  });

  // AC2
  it("closes one session and starts another when the screen changes", async () => {
    const t = setup();
    t.tracker.setContext(proposal);
    t.tracker.input();
    t.advance(2 * MIN);
    t.tracker.input();
    t.tracker.setContext(beo);
    t.advance(1 * MIN);
    t.tracker.input();
    t.advance(30_000);
    await t.tracker.flush();
    expect(t.sessions()).toEqual([
      { activity: "proposal_work", recordId: null, minutes: 2 },
      { activity: "beo_editing", recordId: beo.recordId, minutes: 1.5 },
    ]);
  });

  it("keeps one session when the same screen is set again", async () => {
    const t = setup();
    t.tracker.setContext(event);
    t.tracker.input();
    t.advance(1 * MIN);
    t.tracker.setContext({ ...event });
    t.tracker.input();
    t.advance(1 * MIN);
    await t.tracker.flush();
    expect(t.sessions().map((s) => s.minutes)).toEqual([2]);
  });

  // AC3
  it("sends at most one request per minute", async () => {
    const t = setup();
    t.tracker.setContext(event);
    for (let second = 0; second < 5 * 60; second += 5) {
      t.tracker.input();
      if (second % 20 === 0) t.tracker.setContext(second % 40 ? proposal : event);
      await t.tracker.tick();
      t.advance(5_000);
    }
    expect(t.send.mock.calls.length).toBeGreaterThan(1);
    expect(t.send.mock.calls.length).toBeLessThanOrEqual(5);
    // Every session still arrives, in a later batch if it closed between sends.
    t.tracker.setVisible(false);
    t.advance(MIN);
    await t.tracker.flush();
    const total = t.sessions().reduce((sum, s) => sum + s.minutes, 0);
    expect(total).toBeCloseTo(5, 5);
  });

  it("resends an open session with a later end under the same id", async () => {
    const t = setup();
    t.tracker.setContext(event);
    t.tracker.input();
    t.advance(1 * MIN);
    await t.tracker.flush();
    t.tracker.input();
    t.advance(1 * MIN);
    await t.tracker.flush();
    expect(t.sent).toHaveLength(2);
    expect(t.sent[0][0].id).toBe(t.sent[1][0].id);
    expect(t.sessions().map((s) => s.minutes)).toEqual([2]);
  });

  it("retries after a network failure and stops when not signed in", async () => {
    const t = setup();
    t.send.mockRejectedValueOnce(new TypeError("offline"));
    t.tracker.setContext(proposal);
    t.tracker.input();
    t.advance(1 * MIN);
    t.tracker.setContext(event);
    await t.tracker.flush();
    expect(t.sent).toHaveLength(0);
    t.advance(1 * MIN);
    t.tracker.input();
    await t.tracker.flush();
    expect(t.sessions().map((s) => s.activity)).toEqual([
      "proposal_work",
      "event_planning",
    ]);

    t.send.mockRejectedValue(
      new ApiRequestError(401, "UNAUTHENTICATED", "Sign-in is required."),
    );
    t.advance(1 * MIN);
    await t.tracker.flush();
    const calls = t.send.mock.calls.length;
    t.tracker.input();
    t.advance(5 * MIN);
    await t.tracker.tick();
    expect(t.send.mock.calls.length).toBe(calls);
  });
});

describe("contextForPath", () => {
  it.each([
    ["/events/E0000000-0000-4000-8000-000000000001", "event_planning", "event", eventId],
    ["/events", "event_planning", null, null],
    ["/leads/" + eventId, "lead_follow_up", "lead", eventId],
    ["/clients/" + eventId, "client_work", "client", eventId],
    ["/clients/cli-1", "client_work", null, null],
    ["/proposals", "proposal_work", null, null],
    ["/inventory/ingredients", "kitchen", null, null],
    ["/inventory/" + eventId, "inventory", null, null],
    ["/venues", "event_planning", null, null],
    ["/", "general", null, null],
  ])("%s", (path, activity, recordType, recordId) => {
    expect(contextForPath(path)).toEqual({ activity, recordType, recordId });
  });
});
