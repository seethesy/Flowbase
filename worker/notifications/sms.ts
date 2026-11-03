import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { businessDefaultsSchema, defaultBusinessDefaults } from "../../shared/settings";
import type { NotificationType } from "../../shared/notifications";
import type { DbLike } from "../db/client";
import { notifications, settings, smsOutbox, users } from "../db/schema";
import { enqueueJob } from "../jobs/queue";

export type SmsMessage = { notificationId: string; userId: string; mobile: string; body: string };
export interface SmsProvider {
  readonly name: string;
  send(db: DbLike, message: SmsMessage): Promise<void>;
  // A real provider maps inbound STOP and HELP to these actions.
  inbound(command: "STOP" | "HELP", mobile: string): Promise<void>;
}

export const stubSmsProvider: SmsProvider = {
  name: "stub",
  async send(db, message) {
    await db.insert(smsOutbox).values({ ...message, status: "recorded", provider: "stub" })
      .onConflictDoNothing({ target: smsOutbox.notificationId });
  },
  async inbound() { /* No inbound transport in the stub. */ },
};

export function monthBounds(now: Date) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { start, end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) };
}

export async function routeSms(
  db: DbLike,
  type: NotificationType,
  rows: { id: string; userId: string; title: string; body: string }[],
  provider: SmsProvider = stubSmsProvider,
  now = new Date(),
): Promise<Set<string>> {
  const fallback = new Set<string>();
  if (!rows.length) return fallback;
  // Serialize cap decisions, including the first month when no settings row exists.
  await db.execute(sql`select pg_advisory_xact_lock(520052)`);
  const [setting] = await db.select({ value: settings.value }).from(settings)
    .where(eq(settings.key, "defaults"));
  const defaults = businessDefaultsSchema.safeParse(setting?.value ?? {});
  const { urgentNotificationTypes, monthlySmsCap } = defaults.success
    ? defaults.data : defaultBusinessDefaults;
  if (!urgentNotificationTypes.includes(type)) return fallback;
  const recipients = await db.select({ id: users.id, mobile: users.mobile, consent: users.smsConsentAt })
    .from(users).where(and(eq(users.status, "active"), isNull(users.archivedAt)));
  const eligible = new Map(recipients.filter((u) => u.consent && u.mobile.trim())
    .map((u) => [u.id, u.mobile]));
  const { start, end } = monthBounds(now);
  const [{ used }] = await db.select({ used: sql<number>`count(*)::int` }).from(smsOutbox)
    .where(and(gte(smsOutbox.createdAt, start), lt(smsOutbox.createdAt, end)));
  let count = used;
  for (const row of rows) {
    const mobile = eligible.get(row.userId);
    if (!mobile) continue;
    if (count >= monthlySmsCap) { fallback.add(row.id); continue; }
    await provider.send(db, { notificationId: row.id, userId: row.userId, mobile,
      body: `${row.title}${row.body ? `: ${row.body}` : ""}`.slice(0, 1000) });
    count++;
  }
  if (fallback.size) {
    const activeAdmins = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.role, "admin"), eq(users.status, "active"), isNull(users.archivedAt)));
    const sourceKey = `sms-cap:${start.toISOString()}`;
    for (const admin of activeAdmins) {
      const [alert] = await db.insert(notifications).values({ userId: admin.id,
        type: "production_alert", title: "Monthly SMS cap reached",
        body: "Urgent messages are falling back to email. Review the SMS cap in Settings.",
        link: "/settings/defaults", sourceKey })
        .onConflictDoNothing({ target: [notifications.sourceKey, notifications.userId] })
        .returning({ id: notifications.id });
      if (alert) await enqueueJob(db, { type: "notification.email",
        payload: { notificationId: alert.id }, idempotencyKey: `notification.email:${alert.id}` });
    }
  }
  return fallback;
}
