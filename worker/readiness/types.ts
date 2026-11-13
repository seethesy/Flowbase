import type { ReadinessKind } from "../../shared/readiness";

export type Finding = { key: string; kind: ReadinessKind; question: string; signature: string };
export type TaskFact = { id: string; title: string; assigneeIds: string[] };
export type PullFact = { id: string; scheduledAt: string | null; updatedAt?: string; lines: { id: string; name: string; quantity: number | null; ratio: number | null; basis: string | null }[] };
export type TruckFact = { id: string; name: string; loaderIds: string[]; conflictMessage: string | null };
export type StaffFact = { id: string; position: string; assigneeId: string | null };
export type DishFact = { id: string; name: string; yieldServings: number | null };
export type ProposalFact = { id: string; name: string; catalogId: string | null; notTracked: boolean; kind: string };
export type ReadinessFacts = { eventTitle: string; guestCount: number | null; tasks: TaskFact[]; pull: PullFact | null;
  trucks: TruckFact[]; slots: StaffFact[]; dishes: DishFact[]; proposalLines: ProposalFact[] };
