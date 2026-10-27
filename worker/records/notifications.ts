import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import {
  NOTIFICATION_INBOX_SIZE,
  notificationCatalog,
  notificationTypes,
  type Notification,
  type NotificationInbox,
  type NotificationPreference,
  type NotificationPreferencesInput,
} from "../../shared/notifications";
import { businessDefaultsSchema } from "../../shared/settings";
import type { Db, DbLike } from "../db/client";
import { notificationPreferences, notifications, settings } from "../db/schema";
import { notFound } from "../hono";

// The proposed value in an upsert's ON CONFLICT DO UPDATE.
const excluded = (column: string) => sql.raw(`excluded."${column}"`);

// The signed-in user's notification center and email preferences (FLOW-43).
// Everyone sees only their own notifications.

type NotificationRow = typeof notifications.$inferSelect;
const toNotification = (row: NotificationRow): Notification => ({
  id: row.id,
  type: row.type,
  title: row.title,
  body: row.body,
  link: row.link,
  readAt: row.readAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

const mine = (actor: Actor) =>
  and(eq(notifications.userId, actor.userId), isNull(notifications.archivedAt));

export async function getInbox(db: DbLike, actor: Actor): Promise<NotificationInbox> {
  const rows = await db
    .select()
    .from(notifications)
    .where(mine(actor))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(NOTIFICATION_INBOX_SIZE);
  const [{ unread }] = await db
    .select({ unread: count() })
    .from(notifications)
    .where(and(mine(actor), isNull(notifications.readAt)));
  return { unreadCount: unread, notifications: rows.map(toNotification) };
}

export async function markRead(db: DbLike, actor: Actor, id: string) {
  const [row] = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.id, id), mine(actor)));
  if (!row) throw notFound("Notification");
  if (row.readAt) return toNotification(row);
  const [updated] = await db
    .update(notifications)
    .set({ readAt: new Date(), updatedBy: actor.userId })
    .where(eq(notifications.id, id))
    .returning();
  return toNotification(updated);
}

export async function markAllRead(db: DbLike, actor: Actor) {
  await db
    .update(notifications)
    .set({ readAt: new Date(), updatedBy: actor.userId })
    .where(and(mine(actor), isNull(notifications.readAt)));
  return getInbox(db, actor);
}

// Types marked urgent in business settings (FLOW-45 defaults).
async function urgentTypes(db: DbLike) {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, "defaults"));
  const parsed = businessDefaultsSchema.safeParse(row?.value ?? {});
  return new Set(parsed.success ? parsed.data.urgentNotificationTypes : []);
}

export async function getPreferences(
  db: DbLike,
  actor: Actor,
): Promise<NotificationPreference[]> {
  const rows = await db
    .select()
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, actor.userId),
        isNull(notificationPreferences.archivedAt),
      ),
    );
  const email = new Map(rows.map((row) => [row.type, row.email]));
  const urgent = await urgentTypes(db);
  return notificationTypes.map((type) => ({
    type,
    label: notificationCatalog[type].label,
    description: notificationCatalog[type].description,
    email: email.get(type) ?? true,
    urgent: urgent.has(type),
  }));
}

// Sets email on or off for the given types; types left out keep their setting.
export async function setPreferences(
  db: Db,
  actor: Actor,
  input: NotificationPreferencesInput,
) {
  const changes = Object.entries(input.email).filter(
    (entry): entry is [keyof typeof notificationCatalog, boolean] =>
      typeof entry[1] === "boolean",
  );
  if (changes.length)
    await db
      .insert(notificationPreferences)
      .values(
        changes.map(([type, email]) => ({
          userId: actor.userId,
          type,
          email,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        })),
      )
      .onConflictDoUpdate({
        target: [notificationPreferences.userId, notificationPreferences.type],
        set: {
          email: excluded("email"),
          updatedBy: actor.userId,
          updatedAt: new Date(),
          archivedAt: null,
        },
      });
  return getPreferences(db, actor);
}
