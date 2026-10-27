import { z } from "zod";
import { localTime } from "./core-records";
import { id, localDate, text, timestamp } from "./schema-primitives";

// Staff assignment and Production Leads (FLOW-140): the event's staff roster, laid
// out like the BEO's Staff Roster section. An event has shifts (the pull/load day,
// the setup day before and the event day, each with its own times and activities)
// and each shift has staffing slots, open or assigned to one staff member.

export const shiftKinds = ["pull_load", "setup", "event_day"] as const;
export const shiftKindSchema = z.enum(shiftKinds);
export type ShiftKind = z.infer<typeof shiftKindSchema>;
export const shiftKindLabels: Record<ShiftKind, string> = {
  pull_load: "Pull/load day",
  setup: "Setup day",
  event_day: "Event day",
};

// Departments the staffing breakdown counts by ("3 kitchen, 6 decor/setup").
export const departments = [
  "management",
  "kitchen",
  "service",
  "bar",
  "decor_setup",
  "pull_load",
  "transport",
  "other",
] as const;
export const departmentSchema = z.enum(departments);
export type Department = z.infer<typeof departmentSchema>;
export const departmentLabels: Record<Department, string> = {
  management: "Management",
  kitchen: "Kitchen",
  service: "Service",
  bar: "Bar",
  decor_setup: "Decor/Setup",
  pull_load: "Pull/Load",
  transport: "Transport",
  other: "Other",
};
// The department a new slot starts with for the default positions (FLOW-45); any
// other position starts as Other. The slot's department can be changed.
const positionDepartments: Record<string, Department> = {
  "event coordinator": "management",
  "catering lead/captain": "management",
  "chef on site": "kitchen",
  "sous chef": "kitchen",
  server: "service",
  "bathroom attendant": "service",
  bartender: "bar",
  driver: "transport",
  "pull/load crew": "pull_load",
  "decor/setup crew": "decor_setup",
};
export const defaultDepartment = (position: string): Department =>
  positionDepartments[position.trim().toLowerCase()] ?? "other";

export const shiftInputSchema = z.object({
  kind: shiftKindSchema,
  // New York wall-clock date and times, like the event's. An end time earlier than
  // the start runs past midnight.
  date: localDate,
  startTime: localTime,
  endTime: localTime,
  activities: text(2000).default(""),
});
export type ShiftInput = z.input<typeof shiftInputSchema>;

export const slotInputSchema = z.object({
  shiftId: id,
  position: text(100).min(1, "Choose a position."),
  department: departmentSchema,
  // Adds this many open slots of the position at once ("6 servers").
  count: z.number().int().min(1).max(30).default(1),
});
export type SlotInput = z.input<typeof slotInputSchema>;
export const slotUpdateSchema = z
  .object({
    position: text(100).min(1, "Choose a position.").optional(),
    department: departmentSchema.optional(),
    // null opens the slot again.
    assigneeId: id.nullable().optional(),
  })
  .strict();
export type SlotUpdate = z.infer<typeof slotUpdateSchema>;

// PUT /api/events/<id>/production-leads: one full-time primary and optional
// assistants (Q-40). The primary receives the event's production alerts and the
// assistants are copied (FLOW-153).
export const productionLeadsInputSchema = z
  .object({
    productionLeadId: id.nullable(),
    assistantLeadIds: z
      .array(id)
      .max(10)
      .refine(
        (values) => new Set(values).size === values.length,
        "List each assistant once.",
      )
      .default([]),
  })
  .refine(
    (input) => input.productionLeadId !== null || !input.assistantLeadIds.length,
    "Name a primary Production Lead before adding assistants.",
  )
  .refine(
    (input) =>
      !input.productionLeadId ||
      !input.assistantLeadIds.includes(input.productionLeadId),
    "The primary Production Lead can't also be an assistant.",
  );
export type ProductionLeadsInput = z.input<typeof productionLeadsInputSchema>;

const person = z.object({ id, name: z.string() });
// Another shift the same person works at an overlapping time. The event's title is
// null when the viewer can't open that event.
export const shiftConflictSchema = z.object({
  eventId: id,
  eventTitle: z.string().nullable(),
  shiftKind: shiftKindSchema,
  startsAt: timestamp,
  endsAt: timestamp,
});
export type ShiftConflict = z.infer<typeof shiftConflictSchema>;
export const staffSlotSchema = z.object({
  id,
  shiftId: id,
  position: z.string(),
  // "Server #5": numbered when the shift has more than one slot of the position.
  number: z.number().int().nullable(),
  department: departmentSchema,
  assignee: person.nullable(),
  // Double-booking warnings (AC1).
  conflicts: z.array(shiftConflictSchema),
});
export type StaffSlot = z.infer<typeof staffSlotSchema>;
export const eventShiftSchema = z.object({
  id,
  kind: shiftKindSchema,
  date: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  startsAt: timestamp,
  endsAt: timestamp,
  activities: z.string(),
  slots: z.array(staffSlotSchema),
});
export type EventShift = z.infer<typeof eventShiftSchema>;
export const breakdownRowSchema = z.object({
  department: departmentSchema,
  total: z.number().int(),
  filled: z.number().int(),
});
export type BreakdownRow = z.infer<typeof breakdownRowSchema>;
export const eventRosterSchema = z.object({
  eventId: id,
  productionLead: person.nullable(),
  assistantLeads: z.array(person),
  shifts: z.array(eventShiftSchema),
  breakdown: z.array(breakdownRowSchema),
  openSlots: z.number().int(),
  canEdit: z.boolean(),
  // Admin and the Sales Manager name the Production Leads (Q-40).
  canNameLeads: z.boolean(),
});
export type EventRoster = z.infer<typeof eventRosterSchema>;

// Two time ranges overlap when each starts before the other ends; back-to-back
// shifts (one ends at 4 pm, the next starts at 4 pm) don't.
export const overlaps = (
  a: { startsAt: string | Date; endsAt: string | Date },
  b: { startsAt: string | Date; endsAt: string | Date },
) =>
  new Date(a.startsAt).getTime() < new Date(b.endsAt).getTime() &&
  new Date(b.startsAt).getTime() < new Date(a.endsAt).getTime();

// Numbers the slots of each position within a shift in their order, when the
// position appears more than once (Sous Chef #1, Sous Chef #2).
export function slotNumbers(
  slots: { id: string; position: string }[],
): Map<string, number | null> {
  const totals = new Map<string, number>();
  for (const slot of slots)
    totals.set(slot.position, (totals.get(slot.position) ?? 0) + 1);
  const seen = new Map<string, number>();
  return new Map(
    slots.map((slot) => {
      const next = (seen.get(slot.position) ?? 0) + 1;
      seen.set(slot.position, next);
      return [slot.id, totals.get(slot.position)! > 1 ? next : null];
    }),
  );
}

// Headcount by department across every shift, in department order; departments
// with no slots are left out.
export function staffingBreakdown(
  slots: { department: Department; assigneeId: string | null }[],
): BreakdownRow[] {
  return departments.flatMap((department) => {
    const mine = slots.filter((slot) => slot.department === department);
    return mine.length
      ? [
          {
            department,
            total: mine.length,
            filled: mine.filter((slot) => slot.assigneeId !== null).length,
          },
        ]
      : [];
  });
}

export const slotLabel = (slot: Pick<StaffSlot, "position" | "number">) =>
  slot.number ? `${slot.position} #${slot.number}` : slot.position;
