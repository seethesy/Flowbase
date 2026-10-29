import { and, eq, inArray, isNull } from "drizzle-orm";
import { shiftKindLabels } from "../../shared/event-staff";
import {
  notificationCatalog,
  notificationTypes,
  notifyPayloadSchema,
  type NotificationType,
} from "../../shared/notifications";
import { utcToBusinessTime } from "../../shared/time";
import type { Bindings } from "../bindings";
import type { Db, DbLike } from "../db/client";
import {
  events,
  eventShifts,
  leads,
  notificationPreferences,
  notifications,
  taskAssignees,
  tasks,
  users,
} from "../db/schema";
import {
  enqueueJob,
  type JobContext,
  type JobRegistry,
  type JobRow,
} from "../jobs/queue";
import {
  emailProviderFromEnv,
  notificationEmail,
  type EmailProvider,
} from "./email";

// Notification fan-out (FLOW-43). Each notification type subscribes to its domain
// event (shared/notifications.ts). The subscriber works out who is told and what
// they read, and deliver() stores one notification per recipient. The event job's
// idempotency key is stored with each row and (source_key, user_id) is unique, so
// a retried job never notifies anyone twice (AC1). Email goes out through its own
// job per notification, so a failed send is retried and logged by the jobs system
// without touching the in-app notification (AC3).

export const EMAIL_JOB = "notification.email";

export type Recipient = {
  userId: string;
  title: string;
  body: string;
  link: string | null;
};

const when = (instant: Date) => {
  const { date, time } = utcToBusinessTime(instant);
  return `${date} ${time}`;
};
const ids = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
const payloadOf = (job: JobRow) => (job.payload ?? {}) as Record<string, unknown>;

// Users who turned email off for this type.
async function emailOff(db: DbLike, userIds: string[], type: NotificationType) {
  if (!userIds.length) return new Set<string>();
  const rows = await db
    .select({ userId: notificationPreferences.userId })
    .from(notificationPreferences)
    .where(
      and(
        inArray(notificationPreferences.userId, userIds),
        eq(notificationPreferences.type, type),
        eq(notificationPreferences.email, false),
        isNull(notificationPreferences.archivedAt),
      ),
    );
  return new Set(rows.map((row) => row.userId));
}

// Stores the notifications for one event and queues their emails, in one
// transaction. Returns how many notifications were new.
export async function deliver(
  db: Db,
  job: JobRow,
  type: NotificationType,
  recipients: Recipient[],
): Promise<number> {
  const byUser = new Map(recipients.map((r) => [r.userId, r]));
  if (!byUser.size) return 0;
  return db.transaction(async (tx) => {
    // Only active staff are notified.
    const active = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          inArray(users.id, [...byUser.keys()]),
          eq(users.status, "active"),
          isNull(users.archivedAt),
        ),
      );
    if (!active.length) return 0;
    const created = await tx
      .insert(notifications)
      .values(
        active.map(({ id }) => {
          const recipient = byUser.get(id)!;
          return {
            userId: id,
            type,
            title: recipient.title.slice(0, 200),
            body: recipient.body.slice(0, 1000),
            link: recipient.link,
            sourceKey: job.idempotencyKey,
          };
        }),
      )
      .onConflictDoNothing({
        target: [notifications.sourceKey, notifications.userId],
      })
      .returning({ id: notifications.id, userId: notifications.userId });
    // AC2: in-app always; email only where the person hasn't turned it off.
    const off = await emailOff(
      tx,
      created.map((row) => row.userId),
      type,
    );
    for (const row of created)
      if (!off.has(row.userId))
        await enqueueJob(tx, {
          type: EMAIL_JOB,
          payload: { notificationId: row.id },
          idempotencyKey: `${EMAIL_JOB}:${row.id}`,
        });
    return created.length;
  });
}

type Subscriber = (job: JobRow, db: Db) => Promise<Recipient[]>;

async function openTask(db: DbLike, id: unknown) {
  if (typeof id !== "string") return undefined;
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), isNull(tasks.archivedAt)));
  return task;
}

// task.assigned (FLOW-58): the people just added, except whoever assigned them.
const taskAssigned: Subscriber = async (job, db) => {
  const payload = payloadOf(job);
  const task = await openTask(db, payload.entityId);
  if (!task) return [];
  const body = task.dueAt ? `Due ${when(task.dueAt)}` : "";
  return ids(payload.addedUserIds)
    .filter((userId) => userId !== payload.actorId)
    .map((userId) => ({
      userId,
      title: `Task assigned: ${task.title}`,
      body,
      link: `/tasks/${task.id}`,
    }));
};

// task.due (FLOW-58's due-time scan): the assignees and the overseer of a task
// that is still open.
const taskDue: Subscriber = async (job, db) => {
  const task = await openTask(db, payloadOf(job).entityId);
  if (!task || task.status === "done" || !task.dueAt) return [];
  const assigned = await db
    .select({ userId: taskAssignees.userId })
    .from(taskAssignees)
    .where(and(eq(taskAssignees.taskId, task.id), isNull(taskAssignees.archivedAt)));
  const people = new Set([
    ...assigned.map((row) => row.userId),
    ...(task.overseerId ? [task.overseerId] : []),
  ]);
  return [...people].map((userId) => ({
    userId,
    title: `Task due: ${task.title}`,
    body: `Due ${when(task.dueAt!)}`,
    link: `/tasks/${task.id}`,
  }));
};

const leadAssigned: Subscriber = async (job, db) => {
  const payload = payloadOf(job);
  if (typeof payload.assignedSalespersonId !== "string" || typeof payload.entityId !== "string")
    return [];
  const [lead] = await db
    .select({ id: leads.id, name: leads.name })
    .from(leads)
    .where(eq(leads.id, payload.entityId));
  if (!lead) return [];
  return [{
    userId: payload.assignedSalespersonId,
    title: `Lead assigned: ${lead.name || "New lead"}`,
    body: "A lead has been assigned to you.",
    link: `/leads/${lead.id}`,
  }];
};

// event.staff_assigned (FLOW-140): the person assigned to the roster slot.
const staffAssigned: Subscriber = async (job, db) => {
  const payload = payloadOf(job);
  if (typeof payload.userId !== "string" || typeof payload.entityId !== "string")
    return [];
  const [event] = await db
    .select({ id: events.id, title: events.title })
    .from(events)
    .where(eq(events.id, payload.entityId));
  if (!event) return [];
  const [shift] =
    typeof payload.shiftId === "string"
      ? await db
          .select()
          .from(eventShifts)
          .where(eq(eventShifts.id, payload.shiftId))
      : [];
  const details = [
    typeof payload.position === "string" ? payload.position : "",
    shift ? `${shiftKindLabels[shift.kind]} ${when(shift.startsAt)}–${when(shift.endsAt)}` : "",
  ].filter(Boolean);
  return [
    {
      userId: payload.userId,
      title: `You're on the staff roster: ${event.title}`,
      body: details.join(" · "),
      link: `/events/${event.id}`,
    },
  ];
};

const staffUnassigned: Subscriber = async (job, db) => {
  const payload = payloadOf(job);
  if (payload.notifyRemovedStaff !== true || typeof payload.previousUserId !== "string" ||
      typeof payload.entityId !== "string") return [];
  const [event] = await db
    .select({ title: events.title })
    .from(events)
    .where(eq(events.id, payload.entityId));
  if (!event) return [];
  const [shift] = typeof payload.shiftId === "string"
    ? await db.select().from(eventShifts).where(eq(eventShifts.id, payload.shiftId))
    : [];
  return [{
    userId: payload.previousUserId,
    title: `Removed from staff roster: ${event.title}`,
    body: [
      typeof payload.position === "string" ? payload.position : "",
      shift ? `${shiftKindLabels[shift.kind]} ${when(shift.startsAt)}–${when(shift.endsAt)}` : "",
    ].filter(Boolean).join(" · "),
    link: null,
  }];
};

// Every other type: the producing module names the recipients and the message
// (notifyPayloadSchema). A malformed payload fails the job so it shows up for an
// admin instead of being dropped.
const fromPayload: Subscriber = async (job) => {
  const parsed = notifyPayloadSchema.safeParse(payloadOf(job));
  if (!parsed.success)
    throw new Error(
      `${job.type} has no valid notification payload: ${parsed.error.issues[0]?.message ?? "invalid"}`,
    );
  const { recipientIds, title, body, link } = parsed.data;
  return recipientIds.map((userId) => ({ userId, title, body, link }));
};

const subscribers: Partial<Record<NotificationType, Subscriber>> = {
  task_assigned: taskAssigned,
  task_due: taskDue,
  lead_assigned: leadAssigned,
  staff_assigned: staffAssigned,
  staff_unassigned: staffUnassigned,
};

export type NotificationOptions = {
  // The email provider for a cron run; the configured Resend account by default.
  emailProvider?: (env: Bindings | undefined) => EmailProvider | undefined;
};

const log = (event: string, fields: Record<string, unknown>) =>
  console.log(JSON.stringify({ event, ...fields }));

// Sends one notification's email. Skips it when the person turned email off
// since, is no longer active, or it was already sent. A failed send is logged and
// thrown, so the jobs system retries it with backoff (AC3).
export async function sendNotificationEmail(
  job: JobRow,
  { db, env }: JobContext,
  provider: EmailProvider | undefined,
) {
  const notificationId = payloadOf(job).notificationId;
  if (typeof notificationId !== "string") return;
  const [row] = await db
    .select({
      notification: notifications,
      email: users.email,
      status: users.status,
      archivedAt: users.archivedAt,
    })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(eq(notifications.id, notificationId));
  if (!row || row.notification.emailedAt || row.notification.archivedAt) return;
  if (row.status !== "active" || row.archivedAt) return;
  const off = await emailOff(db, [row.notification.userId], row.notification.type);
  if (off.size) {
    log("notification_email_skipped", { notificationId, reason: "turned_off" });
    return;
  }
  if (!provider) {
    log("notification_email_skipped", { notificationId, reason: "not_configured" });
    return;
  }
  try {
    await provider.send({
      to: row.email,
      ...notificationEmail(row.notification, env?.APP_URL),
      idempotencyKey: job.idempotencyKey,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "notification_email_failed",
        notificationId,
        jobId: job.id,
        attempt: job.attempts,
        provider: provider.name,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    throw error;
  }
  await db
    .update(notifications)
    .set({ emailedAt: new Date() })
    .where(eq(notifications.id, notificationId));
  log("notification_email_sent", { notificationId, provider: provider.name });
}

// Subscribes every notification type to its domain event and registers the
// email job.
export function registerNotifications(
  registry: JobRegistry,
  options: NotificationOptions = {},
) {
  for (const type of notificationTypes) {
    const subscriber = subscribers[type] ?? fromPayload;
    registry.register(
      `event:${notificationCatalog[type].event}`,
      async (job, { db }) => {
        const created = await deliver(db, job, type, await subscriber(job, db));
        if (created) log("notifications_created", { type, count: created, jobId: job.id });
      },
    );
  }
  const provider = options.emailProvider ?? emailProviderFromEnv;
  registry.register(EMAIL_JOB, (job, context) =>
    sendNotificationEmail(job, context, provider(context.env)),
  );
  return registry;
}
