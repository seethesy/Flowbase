import { z } from "zod";
import { id, timestamp } from "./schema-primitives";

// "Start planning" (FLOW-133): one confirmation moves a Closed event to
// Preparation and queues one small job per step. Steps whose module isn't built
// yet are recorded as skipped, so the hub shows the whole workflow from the start
// and each later ticket only has to register its step.
export const planningSteps = [
  "holds",
  "pull_list",
  "requirements",
  "production_tasks",
  "kitchen_menu",
  "beo_draft",
  "calendar",
] as const;
export const planningStepSchema = z.enum(planningSteps);
export type PlanningStep = z.infer<typeof planningStepSchema>;
export const planningStepLabels: Record<PlanningStep, string> = {
  holds: "Confirm rental holds",
  pull_list: "Generate the pull list",
  requirements: "Work out ingredient, bar and supply needs",
  production_tasks: "Create production tasks",
  kitchen_menu: "Generate the kitchen menu",
  beo_draft: "Create the BEO draft",
  calendar: "Refresh the calendar",
};

export const planningStepStatuses = [
  "pending",
  "running",
  "done",
  "skipped",
  "failed",
] as const;
export const planningStepStatusSchema = z.enum(planningStepStatuses);
export type PlanningStepStatus = z.infer<typeof planningStepStatusSchema>;
export const planningStepStatusLabels: Record<PlanningStepStatus, string> = {
  pending: "Waiting",
  running: "Running",
  done: "Done",
  skipped: "Not available yet",
  failed: "Failed, will retry",
};

export const planningStepProgressSchema = z.object({
  step: planningStepSchema,
  label: z.string(),
  status: planningStepStatusSchema,
  detail: z.string(),
  completedAt: timestamp.nullable(),
});
export type PlanningStepProgress = z.infer<typeof planningStepProgressSchema>;

export const planningProgressSchema = z.object({
  eventId: id,
  started: z.boolean(),
  startedAt: timestamp.nullable(),
  startedBy: id.nullable(),
  steps: z.array(planningStepProgressSchema),
  // Every step has finished (done or skipped).
  complete: z.boolean(),
  // The event is Closed (or in Preparation without a run) and the viewer may
  // start planning: Admin, Sales Manager or the event's salesperson.
  canStart: z.boolean(),
  // The viewer may regenerate the pull list and the kitchen menu.
  canRegenerate: z.boolean(),
});
export type PlanningProgress = z.infer<typeof planningProgressSchema>;

// --- Regeneration (FLOW-133 AC3) ------------------------------------------------
// A generated list (pull list, kitchen menu) is rebuilt from the mapped proposal.
// Lines are matched by their source key. Lines added by hand have none and are
// never touched. A generated line someone edited or removed is kept as it is,
// unless the user chooses to discard those edits.

export type RegenRow<V> = {
  id: string;
  sourceKey: string;
  // Changed by hand after it was generated.
  edited: boolean;
  // Removed by hand.
  removed: boolean;
  value: V;
};
export type RegenPlan<V> = {
  add: { sourceKey: string; value: V }[];
  // Includes restored lines and edited lines reset to the generated values.
  update: { id: string; sourceKey: string; before: V; value: V; restore: boolean }[];
  remove: { id: string; sourceKey: string; before: V }[];
  kept: {
    id: string;
    sourceKey: string;
    reason: "edited" | "removed";
    before: V;
    generated: V | null;
  }[];
};

export function planRegeneration<V>(
  existing: readonly RegenRow<V>[],
  generated: readonly { sourceKey: string; value: V }[],
  same: (a: V, b: V) => boolean,
  discardEdits: boolean,
): RegenPlan<V> {
  const plan: RegenPlan<V> = { add: [], update: [], remove: [], kept: [] };
  const rows = new Map(existing.map((row) => [row.sourceKey, row]));
  const wanted = new Map(generated.map((line) => [line.sourceKey, line.value]));
  for (const [sourceKey, value] of wanted) {
    const row = rows.get(sourceKey);
    if (!row) {
      plan.add.push({ sourceKey, value });
    } else if (row.removed) {
      if (discardEdits)
        plan.update.push({ id: row.id, sourceKey, before: row.value, value, restore: true });
      else
        plan.kept.push({ id: row.id, sourceKey, reason: "removed", before: row.value, generated: value });
    } else if (row.edited) {
      if (discardEdits)
        plan.update.push({ id: row.id, sourceKey, before: row.value, value, restore: false });
      else if (!same(row.value, value))
        plan.kept.push({ id: row.id, sourceKey, reason: "edited", before: row.value, generated: value });
    } else if (!same(row.value, value)) {
      plan.update.push({ id: row.id, sourceKey, before: row.value, value, restore: false });
    }
  }
  for (const row of existing) {
    if (wanted.has(row.sourceKey) || row.removed) continue;
    // No longer in the proposal. Edited lines stay unless discarded.
    if (row.edited && !discardEdits)
      plan.kept.push({ id: row.id, sourceKey: row.sourceKey, reason: "edited", before: row.value, generated: null });
    else plan.remove.push({ id: row.id, sourceKey: row.sourceKey, before: row.value });
  }
  return plan;
}

export const regenerateInputSchema = z.object({
  // Throw away manual edits and removals of generated lines.
  discardEdits: z.boolean().default(false),
});
export type RegenerateInput = z.input<typeof regenerateInputSchema>;

export const regenerateChangeKinds = ["added", "changed", "removed", "kept"] as const;
export const regenerateChangeSchema = z.object({
  kind: z.enum(regenerateChangeKinds),
  label: z.string(),
  // What the line says now and what regenerating would make it (null when it
  // would not exist).
  current: z.string().nullable(),
  generated: z.string().nullable(),
  // Why a kept line is kept: edited or removed by hand.
  reason: z.enum(["edited", "removed"]).nullable(),
});
export type RegenerateChange = z.infer<typeof regenerateChangeSchema>;
export const regeneratePreviewSchema = z.object({
  changes: z.array(regenerateChangeSchema),
  // Nothing would change.
  upToDate: z.boolean(),
});
export type RegeneratePreview = z.infer<typeof regeneratePreviewSchema>;

// The preview shown to the user: the plan in words.
export function describeRegeneration<V>(
  plan: RegenPlan<V>,
  label: (value: V) => string,
  summary: (value: V) => string,
): RegeneratePreview {
  const changes: RegenerateChange[] = [
    ...plan.add.map((line): RegenerateChange => ({
      kind: "added", label: label(line.value), current: null, generated: summary(line.value), reason: null,
    })),
    ...plan.update.map((line): RegenerateChange => ({
      kind: "changed", label: label(line.value), current: summary(line.before), generated: summary(line.value), reason: null,
    })),
    ...plan.remove.map((line): RegenerateChange => ({
      kind: "removed", label: label(line.before), current: summary(line.before), generated: null, reason: null,
    })),
    ...plan.kept.map((line): RegenerateChange => ({
      kind: "kept", label: label(line.before), current: summary(line.before),
      generated: line.generated === null ? null : summary(line.generated), reason: line.reason,
    })),
  ];
  return { changes, upToDate: changes.length === 0 };
}
