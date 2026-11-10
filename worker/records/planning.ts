import { and, asc, eq, isNull } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import {
  planningStepLabels,
  planningSteps,
  type PlanningProgress,
  type PlanningStep,
} from "../../shared/planning";
import { mayEditKitchenMenu, mayStartPlanning, can } from "../../shared/policy";
import { writeAudit } from "../audit/log";
import type { Db, DbLike } from "../db/client";
import { eventPlanning, eventPlanningOutputs, eventPlanningSteps } from "../db/schema";
import { ApiError } from "../hono";
import { enqueueJob, type JobRegistry } from "../jobs/queue";
import { advanceEventStatus, findVisibleEvent, lockVisibleEvent } from "./events";
import { syncEventHolds } from "./holds";
import { generateKitchenMenu } from "./kitchen-menu";
import { generatePullList } from "./pull-list";
import { requestEventRecompute } from "./allocations";
import { applyMatchingProductionTemplates } from "./task-templates";

// "Start planning" (FLOW-133). One confirmation moves a Closed event to Preparation
// and queues one small job per step, so each stays inside the cron's CPU budget.
// Steps for modules that aren't built yet are recorded as skipped.

export const PLANNING_STEP_JOB = "planning.step";

const runners: Partial<
  Record<PlanningStep, (tx: DbLike, eventId: string) => Promise<string>>
> = {
  holds: async (tx, eventId) => {
    await syncEventHolds(tx, eventId, { reevaluateAll: true });
    return "Rental holds are confirmed.";
  },
  pull_list: async (tx, eventId) => {
    const done = await generatePullList(tx, null, eventId);
    return `${done.added} lines added.`;
  },
  kitchen_menu: async (tx, eventId) => {
    const done = await generateKitchenMenu(tx, null, eventId);
    return `${done.added} dishes added.`;
  },
  requirements: async (tx, eventId) => {
    await requestEventRecompute(tx, eventId);
    return "Ingredient, bar and supply allocation queued.";
  },
  production_tasks: async (tx, eventId) => {
    const created = await applyMatchingProductionTemplates(tx, eventId);
    return `${created} production tasks created.`;
  },
};

export const startsAsSkipped = (step: PlanningStep) => !runners[step];

export async function getPlanningProgress(
  db: Db,
  actor: Actor,
  eventId: string,
): Promise<PlanningProgress> {
  const event = await findVisibleEvent(db, actor, eventId);
  const [run] = await db.select().from(eventPlanning).where(eq(eventPlanning.eventId, eventId));
  const rows = await db
    .select()
    .from(eventPlanningSteps)
    .where(eq(eventPlanningSteps.eventId, eventId))
    .orderBy(asc(eventPlanningSteps.createdAt));
  const stale = await db.select().from(eventPlanningOutputs).where(and(eq(eventPlanningOutputs.eventId, eventId), isNull(eventPlanningOutputs.archivedAt)));
  const steps = planningSteps.flatMap((step) => {
    const row = rows.find((candidate) => candidate.step === step);
    if (!row) return [];
    return [
      {
        step,
        label: planningStepLabels[step],
        status: row.status,
        detail: row.detail,
        completedAt: row.completedAt?.toISOString() ?? null,
      },
    ];
  });
  return {
    eventId,
    started: Boolean(run),
    startedAt: run?.startedAt.toISOString() ?? null,
    startedBy: run?.startedBy ?? null,
    steps,
    complete: steps.length > 0 && steps.every((s) => s.status === "done" || s.status === "skipped"),
    canStart: !run && event.status === "closed" && mayStartPlanning(actor, event),
    canRegenerate: can(actor, "events.write") || mayEditKitchenMenu(actor),
    staleOutputs: stale.map((row) => ({ kind: row.kind, cause: row.cause, staleAt: row.staleAt.toISOString() })),
  };
}

export async function startPlanning(db: Db, actor: Actor, eventId: string) {
  await findVisibleEvent(db, actor, eventId);
  await db.transaction(async (tx) => {
    const event = await lockVisibleEvent(tx, actor, eventId);
    if (!mayStartPlanning(actor, event))
      throw new ApiError(403, "FORBIDDEN", "Only an Admin, a Sales Manager or the event's salesperson can start planning.");
    const [run] = await tx.select().from(eventPlanning).where(eq(eventPlanning.eventId, eventId));
    if (run) throw new ApiError(409, "ALREADY_STARTED", "Planning has already started for this event.");
    if (event.status !== "closed")
      throw new ApiError(409, "INVALID_TRANSITION", "Planning starts from a Closed event.");
    await advanceEventStatus(tx, eventId, "preparation", "Planning started");
    const [created] = await tx
      .insert(eventPlanning)
      .values({ eventId, startedBy: actor.userId, createdBy: actor.userId, updatedBy: actor.userId })
      .returning();
    for (const step of planningSteps) {
      const skipped = startsAsSkipped(step);
      await tx.insert(eventPlanningSteps).values({
        eventId,
        step,
        status: skipped ? "skipped" : "pending",
        detail: skipped ? "Not available yet." : "",
        completedAt: skipped ? new Date() : null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      });
      if (!skipped)
        await enqueueJob(tx, {
          type: PLANNING_STEP_JOB,
          payload: { eventId, step },
          idempotencyKey: `${PLANNING_STEP_JOB}:${eventId}:${step}`,
        });
    }
    await writeAudit(tx, actor, {
      entityType: "event_planning",
      entityId: created.id,
      action: "create",
      before: null,
      after: { eventId, startedAt: created.startedAt.toISOString() },
    });
  });
  return getPlanningProgress(db, actor, eventId);
}

// One step's job. Each run is safe to repeat; a failure is recorded and the job
// retries with backoff (FLOW-27).
export function registerPlanning(registry: JobRegistry) {
  registry.register(PLANNING_STEP_JOB, async (job, { db }) => {
    const { eventId, step } = job.payload as { eventId: string; step: PlanningStep };
    const run = runners[step];
    if (!run) return;
    const where = and(eq(eventPlanningSteps.eventId, eventId), eq(eventPlanningSteps.step, step));
    await db.update(eventPlanningSteps).set({ status: "running" }).where(where);
    try {
      await db.transaction(async (tx) => {
        const text = await run(tx, eventId);
        await tx
          .update(eventPlanningSteps)
          .set({ status: "done", detail: text, completedAt: new Date() })
          .where(where);
      });
    } catch (error) {
      await db
        .update(eventPlanningSteps)
        .set({ status: "failed", detail: error instanceof Error ? error.message : "Failed." })
        .where(where);
      throw error;
    }
  });
}
