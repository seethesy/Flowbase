import type { Proposal, Item, Stage } from "../types";
export const stockStatus = (
  item: Pick<Item, "onHand" | "reserved" | "reorder">,
) =>
  item.onHand - item.reserved <= 0
    ? "Out of Stock"
    : item.onHand - item.reserved <= item.reorder
      ? "Low Stock"
      : "In Stock";
export const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
export const date = (value: string) =>
  value
    ? new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";
export const today = () => new Date().toISOString().slice(0, 10);
const permitted: Record<Stage, Stage[]> = {
  Draft: ["Sent", "Lost"],
  Sent: ["Draft", "Negotiating", "Signed", "Lost"],
  Negotiating: ["Sent", "Signed", "Lost"],
  Signed: [],
  Lost: ["Draft"],
};
export function transitionProposal(
  proposal: Proposal,
  stage: Stage,
  reason?: string,
): Proposal {
  if (stage === proposal.stage) return proposal;
  if (!permitted[proposal.stage].includes(stage))
    throw new Error(
      `Cannot move ${proposal.stage} to ${stage}. ${proposal.stage === "Signed" ? "Signed proposals are final." : `Allowed next stages: ${permitted[proposal.stage].join(", ")}.`}`,
    );
  if (stage === "Lost" && !reason?.trim())
    throw new Error("A loss reason is required.");
  return {
    ...proposal,
    stage,
    lossReason: stage === "Lost" ? reason : undefined,
    updated: today(),
  };
}
export interface RecordService<T extends { id: string }> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | undefined>;
  save(record: T): Promise<void>;
  remove(id: string): Promise<void>;
}
export { createRecordService } from "./api";
