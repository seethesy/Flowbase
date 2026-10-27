import {
  FLUSH_INTERVAL_MS,
  IDLE_CUTOFF_MS,
  timeReportSchema,
  type ActivitySessionInput,
  type ActivityType,
  type TrackedRecordType,
} from "../../shared/time-tracking";
import { ApiRequestError, query, request } from "./core";

// Automatic activity time tracking in the browser (FLOW-119). ActivityTracker holds
// the session logic with an injected clock and sender, so tests drive it with a fake
// clock; useActivityTracking (src/app) wires it to the page.

export type TrackingContext = {
  activity: ActivityType;
  recordType: TrackedRecordType | null;
  recordId: string | null;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The record on screen and the kind of work the screen is for.
export function contextForPath(pathname: string): TrackingContext {
  const [section = "", id = ""] = pathname.split("/").filter(Boolean);
  const record = (recordType: TrackedRecordType) =>
    uuidPattern.test(id)
      ? { recordType, recordId: id.toLowerCase() }
      : { recordType: null, recordId: null };
  switch (section) {
    case "leads":
      return { activity: "lead_follow_up", ...record("lead") };
    case "clients":
      return { activity: "client_work", ...record("client") };
    // Proposals are demo data until FLOW-122, so only the activity is credited.
    case "proposals":
      return { activity: "proposal_work", recordType: null, recordId: null };
    case "events":
      return { activity: "event_planning", ...record("event") };
    case "venues":
      return { activity: "event_planning", recordType: null, recordId: null };
    case "inventory":
      return {
        activity: id === "ingredients" ? "kitchen" : "inventory",
        recordType: null,
        recordId: null,
      };
    // The recipe book (FLOW-93) is kitchen work.
    case "recipes":
      return { activity: "kitchen", recordType: null, recordId: null };
    default:
      return { activity: "general", recordType: null, recordId: null };
  }
}

const sameContext = (a: TrackingContext | null, b: TrackingContext) =>
  !!a &&
  a.activity === b.activity &&
  a.recordType === b.recordType &&
  a.recordId === b.recordId;

type OpenSession = {
  id: string;
  startedAt: number;
  // Credited up to here so far.
  endedAt: number;
  context: TrackingContext;
};

export type SendSessions = (sessions: ActivitySessionInput[]) => Promise<void>;

// Unsent sessions kept while the API is unreachable; the oldest go first.
const MAX_UNSENT = 100;

export class ActivityTracker {
  private readonly now: () => number;
  private readonly send: SendSessions;
  private readonly idleCutoffMs: number;
  private readonly flushIntervalMs: number;
  private readonly newId: () => string;
  private visible: boolean;
  private lastInputAt: number | null = null;
  private context: TrackingContext | null = null;
  private open: OpenSession | null = null;
  private readonly unsent = new Map<string, ActivitySessionInput>();
  private lastSentAt = Number.NEGATIVE_INFINITY;
  private sending = false;
  private stopped = false;

  constructor(options: {
    now: () => number;
    send: SendSessions;
    visible: boolean;
    idleCutoffMs?: number;
    flushIntervalMs?: number;
    newId?: () => string;
  }) {
    this.now = options.now;
    this.send = options.send;
    this.visible = options.visible;
    this.idleCutoffMs = options.idleCutoffMs ?? IDLE_CUTOFF_MS;
    this.flushIntervalMs = options.flushIntervalMs ?? FLUSH_INTERVAL_MS;
    this.newId = options.newId ?? (() => crypto.randomUUID());
  }

  // The user typed or clicked.
  input() {
    const at = this.now();
    this.settle(at);
    // Typing or clicking into a hidden tab doesn't count.
    if (!this.visible) return;
    this.lastInputAt = at;
    if (!this.open) this.start(at);
  }

  // The tab was shown or hidden. Hiding ends the session; time starts again with
  // the next input after the tab is shown.
  setVisible(visible: boolean) {
    const at = this.now();
    this.settle(at);
    this.visible = visible;
    if (!visible) {
      this.close();
      this.lastInputAt = null;
    }
  }

  // The screen changed. A different record or activity ends one session and starts
  // another straight away.
  setContext(context: TrackingContext) {
    const at = this.now();
    this.settle(at);
    if (sameContext(this.context, context)) return;
    this.close();
    this.context = context;
    this.start(at);
  }

  // Called on a timer: closes an idle session and sends what's due.
  tick() {
    this.settle(this.now());
    return this.flush();
  }

  // Sends finished sessions and the open one's progress, at most once per interval.
  async flush() {
    const at = this.now();
    if (
      this.stopped ||
      this.sending ||
      at - this.lastSentAt < this.flushIntervalMs
    )
      return;
    this.settle(at);
    const batch = [...this.unsent.values()];
    const open = this.open && this.toInput(this.open);
    if (open) batch.push(open);
    if (!batch.length) return;
    this.lastSentAt = at;
    this.sending = true;
    try {
      await this.send(batch);
      for (const session of batch)
        if (this.unsent.get(session.id) === session)
          this.unsent.delete(session.id);
    } catch (error) {
      const status = error instanceof ApiRequestError ? error.status : 0;
      // Not signed in, or not allowed: stop for this page. A rejected batch won't
      // succeed on a retry, so it's dropped; anything else is retried next time.
      if (status === 401 || status === 403) this.stopped = true;
      if (status >= 400 && status < 500) this.unsent.clear();
    } finally {
      this.sending = false;
    }
  }

  // Credits the open session up to `at`, and ends it once the user has been idle
  // longer than the cutoff (at the moment the cutoff passed).
  private settle(at: number) {
    if (!this.open || this.lastInputAt === null) return;
    const idleAt = this.lastInputAt + this.idleCutoffMs;
    this.open.endedAt = Math.max(this.open.endedAt, Math.min(at, idleAt));
    if (at >= idleAt) this.close();
  }

  private start(at: number) {
    if (
      !this.visible ||
      !this.context ||
      this.lastInputAt === null ||
      at - this.lastInputAt >= this.idleCutoffMs
    )
      return;
    this.open = {
      id: this.newId(),
      startedAt: at,
      endedAt: at,
      context: this.context,
    };
  }

  private close() {
    const open = this.open;
    this.open = null;
    const session = open && this.toInput(open);
    if (!session) return;
    this.unsent.set(session.id, session);
    while (this.unsent.size > MAX_UNSENT)
      this.unsent.delete(this.unsent.keys().next().value!);
  }

  private toInput(open: OpenSession): ActivitySessionInput | null {
    if (open.endedAt <= open.startedAt) return null;
    return {
      id: open.id,
      startedAt: new Date(open.startedAt).toISOString(),
      endedAt: new Date(open.endedAt).toISOString(),
      recordType: open.context.recordType,
      recordId: open.context.recordId,
      activity: open.context.activity,
    };
  }
}

// keepalive lets the last batch go out while the page is being closed.
export async function sendSessions(
  sessions: ActivitySessionInput[],
  keepalive = false,
) {
  const response = await authFetch("/api/time/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessions }),
    keepalive,
  });
  if (!response.ok)
    throw new ApiRequestError(
      response.status,
      "TRACKING_FAILED",
      `Time tracking failed (${response.status}).`,
    );
}

export const timeApi = {
  report: (filter: { from?: string; to?: string; userId?: string } = {}) =>
    request(timeReportSchema, `/api/time/report${query(filter)}`),
};
import { authFetch } from "./auth";
