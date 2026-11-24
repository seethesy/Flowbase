import { eq } from "drizzle-orm";
import type { z } from "zod";
import type { Actor } from "../../../shared/access";
import type { beoImportInputSchema, BeoImportResult } from "../../../shared/beo-import";
import type { Db, DbLike } from "../../db/client";
import { beoRunOfShow, beos, eventStatusHistory, events } from "../../db/schema";
import { forbidden } from "../../hono";
import { can, eventScope } from "../../policy";
import { writeAudit } from "../../audit/log";
import { emitDomainEvent } from "../../jobs/queue";
import { eventSnapshot, instants, lockVisibleEvent } from "../events/events";
import { ensureBeoDraft, findBeo, syncBeo } from "./beo";

type Input = z.output<typeof beoImportInputSchema>;

// Import BEO (FLOW-338): saves the reviewed values of a Word or PDF BEO to the
// event's BEO, creating the event first when the file is for one that isn't in
// Flowbase yet (Q4) and the BEO when the event has none. Q1: BEO-only. The
// schedule replaces the run of show (switched on), the setup list the setup
// details and the rest the additional notes; event records are left as they
// are. Q2: an approved BEO can be imported into; the changes are logged and
// marked as any edit after approval is (FLOW-144). The file itself is stored in
// Documents by the browser once this answers.
export async function importBeo(db: Db, actor: Actor, input: Input): Promise<BeoImportResult> {
  if (!can(actor, "events.write")) throw forbidden();
  return db.transaction(async (tx) => {
    const eventId = input.newEvent ? await createImportedEvent(tx, actor, input.newEvent) : input.eventId!;
    await lockVisibleEvent(tx, actor, eventId);
    const created = await ensureBeoDraft(tx, actor.userId, eventId);
    const beo = (await findBeo(tx, eventId, true))!;
    const before = { setupDetails: beo.setupDetails, additionalNotes: beo.additionalNotes, runOfShowMode: beo.runOfShowMode };
    await tx.update(beos).set({
      ...(input.setupDetails && { setupDetails: input.setupDetails }),
      ...(input.additionalNotes && { additionalNotes: input.additionalNotes }),
      ...(input.runOfShow.length > 0 && { runOfShowMode: "on" as const }),
      updatedBy: actor.userId,
    }).where(eq(beos.id, beo.id));
    if (input.runOfShow.length) {
      await tx.delete(beoRunOfShow).where(eq(beoRunOfShow.beoId, beo.id));
      await tx.insert(beoRunOfShow).values(input.runOfShow.map((row, index) => ({
        beoId: beo.id, eventId, time: row.time, cue: row.cue, owner: row.owner, notes: row.notes,
        sortOrder: index, createdBy: actor.userId, updatedBy: actor.userId,
      })));
    }
    await syncBeo(tx, actor, eventId);
    await writeAudit(tx, actor, {
      entityType: "beo",
      entityId: beo.id,
      action: "update",
      before,
      after: {
        importedFrom: input.fileName,
        setupDetails: input.setupDetails || before.setupDetails,
        additionalNotes: input.additionalNotes || before.additionalNotes,
        runOfShowRows: input.runOfShow.length,
      },
    });
    return { eventId, beoId: beo.id, created };
  });
}

// Q4: the event a BEO file is for, from its summary. A BEO means the event was
// booked, so it starts at Closed. The client and lead are linked on the event
// page afterwards (the client's name is in the imported notes).
async function createImportedEvent(tx: DbLike, actor: Actor, input: NonNullable<Input["newEvent"]>) {
  const [row] = await tx.insert(events).values({
    title: input.title,
    ...instants({ date: input.date, startTime: input.startTime, endTime: null }),
    address: input.address,
    eventType: input.eventType,
    guestCount: input.guestCount,
    // Someone who works only their own events owns what they import, so they
    // can open it.
    assignedSalespersonId: eventScope(actor) === "all" ? null : actor.userId,
    status: "closed",
    createdBy: actor.userId,
    updatedBy: actor.userId,
  }).returning({ id: events.id });
  await tx.insert(eventStatusHistory).values({
    eventId: row.id, fromStatus: null, toStatus: "closed", createdBy: actor.userId, updatedBy: actor.userId,
  });
  await writeAudit(tx, actor, { entityType: "event", entityId: row.id, action: "create", before: null,
    after: await eventSnapshot(tx, row.id) });
  await emitDomainEvent(tx, { name: "event.created", entityId: row.id });
  return row.id;
}
