import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  nextUserStatus,
  userSchema,
  type InviteInput,
  type UserAction,
} from "../../../shared/users";
import type { Actor } from "../../../shared/access";
import type { Db } from "../../db/client";
import { users } from "../../db/schema";
import { ApiError, notFound } from "../../hono";
import { emitDomainEvent } from "../../jobs/queue";
import { writeAudit } from "../../audit/log";

export const toUser = (row: typeof users.$inferSelect) =>
  userSchema.parse({
    ...row,
    name: row.name || row.email,
    invitedAt: row.invitedAt.toISOString(),
    activatedAt: row.activatedAt?.toISOString() ?? null,
  });
// Settings › Users lists accounts; staff without one live only in the directory
// (FLOW-270 A3).
export const listUsers = async (db: Db) =>
  (await db.select().from(users).where(eq(users.hasAccount, true)).orderBy(desc(users.createdAt))).map(toUser);

export async function inviteUser(db: Db, actor: Actor, input: InviteInput) {
  // Only revoked invitations may be reissued. Preserve their stable staff id.
  return db.transaction(async (tx) => {
    const existsError = () =>
      new ApiError(
        409,
        "USER_EXISTS",
        "This email already has an account or pending invitation.",
      );
    const [existing] = await tx
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${input.email.toLowerCase()}`)
      .for("update");
    if (existing) {
      if (existing.status !== "revoked") throw existsError();
      const [updated] = await tx
        .update(users)
        .set({
          ...input,
          status: "pending",
          invitedAt: new Date(),
          updatedBy: actor.userId,
        })
        .where(eq(users.id, existing.id))
        .returning();
      return toUser(updated);
    }
    const [row] = await tx
      .insert(users)
      .values({ ...input, createdBy: actor.userId, updatedBy: actor.userId })
      .onConflictDoNothing()
      .returning();
    if (!row) throw existsError();
    return toUser(row);
  });
}

export async function changeUser(
  db: Db,
  actor: Actor,
  id: string,
  action: UserAction,
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(users)
      .where(eq(users.id, id))
      .for("update");
    // Staff without an account have no invite or sign-in to change (FLOW-270 A3).
    if (!row || !row.hasAccount) throw notFound("User");
    const status = nextUserStatus(row.status, action);
    if (!status)
      throw new ApiError(
        409,
        "INVALID_USER_STATE",
        "This action isn't available for this user's current status.",
      );
    if (id === actor.userId && action === "deactivate")
      throw new ApiError(
        409,
        "SELF_DEACTIVATION",
        "Ask another Admin to deactivate your account.",
      );
    const [updated] = await tx
      .update(users)
      .set({
        status,
        updatedBy: actor.userId,
        ...(action === "resend" ? { invitedAt: new Date() } : {}),
      })
      .where(eq(users.id, id))
      .returning();
    return toUser(updated);
  });
}

export async function changeUserEmail(db: Db, actor: Actor, id: string, email: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(users).where(eq(users.id, id)).for("update");
    if (!row || !row.hasAccount || row.archivedAt || row.status === "revoked") throw notFound("User");
    const [taken] = await tx.select({ id: users.id }).from(users)
      .where(and(sql`lower(${users.email}) = ${email.toLowerCase()}`, isNull(users.archivedAt)));
    if (taken && taken.id !== id) throw new ApiError(409, "USER_EXISTS", "This email already belongs to another user.");
    if (row.email.toLowerCase() === email.toLowerCase()) return toUser(row);
    const [updated] = await tx.update(users).set({ email, updatedBy: actor.userId }).where(eq(users.id, id)).returning();
  await writeAudit(tx, actor, { entityType: "user", entityId: id, action: "update",
    before: { email: row.email }, after: { email: updated.email } });
    await emitDomainEvent(tx, { name: "user.email_changed", entityId: id,
      data: { recipientIds: [id], title: "Account email changed",
        body: `Your account contact email changed from ${row.email} to ${email}. Your existing Google sign-in remains linked.`,
        link: "/profile" } });
    return toUser(updated);
  });
}

export const identitySchema = z.object({
  sub: z.uuid(),
  email: z.email(),
  name: z.string().max(200).optional(),
});
export type GoogleIdentity = z.infer<typeof identitySchema>;

export async function resolveUser(
  db: Db,
  identity: GoogleIdentity,
): Promise<Actor | null> {
  return db.transaction(async (tx) => {
    // Lock the invitation: concurrent first requests cannot claim it twice, and
    // revocation/deactivation cannot be overwritten by a sign-in.
    // Staff without a Flowbase account never sign in (FLOW-270 A3).
    const [byIdentity] = await tx.select().from(users)
      .where(and(eq(users.authId, identity.sub), eq(users.hasAccount, true), isNull(users.archivedAt))).for("update");
    const [byEmail] = byIdentity ? [] : await tx
      .select()
      .from(users)
      .where(
        and(
          sql`lower(${users.email}) = ${identity.email.toLowerCase()}`,
          eq(users.hasAccount, true),
          isNull(users.archivedAt),
        ),
      )
      .for("update");
    const row = byIdentity ?? byEmail;
    if (!row || !["active", "pending"].includes(row.status)) return null;
    if (row.authId && row.authId !== identity.sub) return null;
    if (row.status === "pending") {
      await tx
        .update(users)
        .set({
          authId: identity.sub,
          status: "active",
          activatedAt: new Date(),
          // A name Admin set in the staff directory (FLOW-40) wins.
          name: row.name || identity.name || row.email,
          updatedBy: row.id,
        })
        .where(eq(users.id, row.id));
    } else if (row.authId !== identity.sub) return null;
    return {
      userId: row.id,
      role: row.role,
    };
  });
}
