import { describe, expect, it, vi } from "vitest";
import {
  activityBatchSchema,
  MAX_BATCH_SESSIONS,
  type ActivitySessionInput,
} from "../shared/time-tracking";
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

// FLOW-202: a full queue plus the open session never makes an oversized request,
// and only the session versions a request carried leave the queue.
describe("ActivityTracker batches", () => {
  // `count` finished one-minute sessions on alternating screens, then the open one.
  async function queued(t: ReturnType<typeof setup>, count: number) {
    t.send.mockRejectedValueOnce(new TypeError("offline"));
    for (let i = 0; i < count; i++) {
      t.tracker.input();
      t.tracker.setContext(i % 2 ? event : proposal);
      t.advance(1 * MIN);
    }
    t.tracker.input();
    t.tracker.setContext(beo);
    t.advance(1 * MIN);
    // The first try fails while offline, so everything stays queued.
    await t.tracker.flush();
    t.sent.length = 0;
  }
  const valid = (batch: ActivitySessionInput[]) =>
    activityBatchSchema.safeParse({ sessions: batch }).success;
  const minutes = (t: ReturnType<typeof setup>) =>
    t.sessions().reduce((sum, s) => sum + s.minutes, 0);

  // AC1, AC2
  it("sends 100 queued sessions and the open one in valid, rate-limited batches", async () => {
    const t = setup();
    await queued(t, 101);
    for (let i = 0; i < 3; i++) {
      t.advance(1 * MIN);
      await t.tracker.flush();
    }
    // At most 100 per request, the open session included, one request a minute.
    expect(t.sent.map((batch) => batch.length)).toEqual([
      MAX_BATCH_SESSIONS,
      2,
      1,
    ]);
    expect(t.sent.every(valid)).toBe(true);
    expect(t.sent[0].at(-1)!.activity).toBe("beo_editing");
    // The queue keeps 100; the oldest one fell off before the first request.
    const credited = new Set(t.sent.flat().map((s) => s.id));
    expect(credited.size).toBe(101);
    // Nothing credited twice: each finished session went out exactly once.
    const finished = t.sent.flat().filter((s) => s.activity !== "beo_editing");
    expect(new Set(finished.map((s) => s.id)).size).toBe(finished.length);
    expect(minutes(t)).toBe(100 + 4);
  });

  it("waits a full interval between batches while draining the queue", async () => {
    const t = setup();
    await queued(t, 150);
    t.advance(1 * MIN);
    await t.tracker.flush();
    t.advance(30_000);
    await t.tracker.flush();
    expect(t.sent).toHaveLength(1);
  });

  // AC3
  it("keeps everything queued after a retryable failure", async () => {
    for (const failure of [
      new TypeError("offline"),
      new ApiRequestError(503, "UNAVAILABLE", "Try again."),
      new ApiRequestError(429, "RATE_LIMITED", "Slow down."),
    ]) {
      const t = setup();
      await queued(t, 120);
      t.advance(1 * MIN);
      t.send.mockRejectedValueOnce(failure);
      await t.tracker.flush();
      t.sent.length = 0;
      for (let i = 0; i < 3; i++) {
        t.advance(1 * MIN);
        await t.tracker.flush();
      }
      expect(t.sent.every(valid)).toBe(true);
      expect(t.sent.flat().filter((s) => s.activity !== "beo_editing")).toHaveLength(
        100,
      );
    }
  });

  // AC3
  it("drops only the rejected batch, not sessions that weren't in it", async () => {
    const t = setup();
    await queued(t, 120);
    t.advance(1 * MIN);
    t.send.mockRejectedValueOnce(
      new ApiRequestError(400, "INVALID_REQUEST", "Rejected."),
    );
    await t.tracker.flush();
    const rejected = new Set(t.send.mock.calls.at(-1)![0].map((s) => s.id));
    t.advance(1 * MIN);
    await t.tracker.flush();
    // The open session was in the rejected batch too; it's resent as it grows.
    const retried = t.sent.flat().filter((s) => s.activity !== "beo_editing");
    expect(retried).toHaveLength(1);
    expect(rejected.has(retried[0].id)).toBe(false);
  });

  // AC3
  it("keeps progress made while a request is in flight", async () => {
    const t = setup();
    t.tracker.setContext(event);
    t.tracker.input();
    t.advance(1 * MIN);
    let release!: () => void;
    t.send.mockImplementationOnce(async (sessions) => {
      t.sent.push(sessions);
      // While the request is out, the open session grows and then closes.
      t.tracker.input();
      t.advance(1 * MIN);
      t.tracker.setContext(proposal);
      await new Promise<void>((resolve) => (release = resolve));
    });
    const inFlight = t.tracker.flush();
    release();
    await inFlight;
    t.tracker.input();
    t.advance(1 * MIN);
    await t.tracker.flush();
    expect(t.sessions()).toEqual([
      { activity: "event_planning", recordId: eventId, minutes: 2 },
      { activity: "proposal_work", recordId: null, minutes: 1 },
    ]);
  });

  // AC4
  it("stops on 401 or 403 without sending again", async () => {
    for (const status of [401, 403]) {
      const t = setup();
      await queued(t, 120);
      t.advance(1 * MIN);
      t.send.mockRejectedValueOnce(new ApiRequestError(status, "DENIED", "No."));
      await t.tracker.flush();
      const calls = t.send.mock.calls.length;
      t.tracker.input();
      t.advance(5 * MIN);
      await t.tracker.tick();
      expect(t.send.mock.calls.length).toBe(calls);
    }
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
    ["/recipes/" + eventId, "kitchen", null, null],
    ["/venues", "event_planning", null, null],
    ["/", "general", null, null],
  ])("%s", (path, activity, recordType, recordId) => {
    expect(contextForPath(path)).toEqual({ activity, recordType, recordId });
  });

  // FLOW-167: task time is prep for Sales Managers, assigning for everyone else.
  it.each([
    ["sales_manager", "prep"],
    ["admin", "assigning"],
    ["salesperson", "assigning"],
    ["kitchen_staff", "assigning"],
    [null, "assigning"],
  ] as const)("/tasks/<id> as %s", (role, activity) => {
    expect(contextForPath(`/tasks/${eventId}`, "", role)).toEqual({
      activity,
      recordType: "task",
      recordId: eventId,
    });
  });

  // FLOW-167: an event's proposal drawer credits the proposal.
  const proposalId = "c0000000-0000-4000-8000-000000000001";
  it.each([
    [`?proposal=${proposalId.toUpperCase()}`, "proposal_work", "proposal", proposalId],
    ["?proposal=draft", "event_planning", "event", eventId],
    ["?tab=files", "event_planning", "event", eventId],
  ])("/events/<id>%s", (search, activity, recordType, recordId) => {
    expect(contextForPath(`/events/${eventId}`, search)).toEqual({
      activity,
      recordType,
      recordId,
    });
  });

  // AC1: switching from a proposal back to its event is two sessions, one each.
  it("splits time between a proposal and its event", async () => {
    const t = setup();
    t.tracker.input();
    t.tracker.setContext(contextForPath(`/events/${eventId}`, `?proposal=${proposalId}`));
    t.advance(2 * MIN);
    t.tracker.input();
    t.tracker.setContext(contextForPath(`/events/${eventId}`));
    t.advance(1 * MIN);
    await t.tracker.flush();
    expect(t.sessions()).toEqual([
      { activity: "proposal_work", recordId: proposalId, minutes: 2 },
      { activity: "event_planning", recordId: eventId, minutes: 1 },
    ]);
  });
});
