import type { Contract, Item, Stage } from "../types";
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
export function transitionContract(
  contract: Contract,
  stage: Stage,
  reason?: string,
): Contract {
  if (stage === contract.stage) return contract;
  if (!permitted[contract.stage].includes(stage))
    throw new Error(
      `Cannot move ${contract.stage} to ${stage}. ${contract.stage === "Signed" ? "Signed contracts are final." : `Allowed next stages: ${permitted[contract.stage].join(", ")}.`}`,
    );
  if (stage === "Lost" && !reason?.trim())
    throw new Error("A loss reason is required.");
  return {
    ...contract,
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
