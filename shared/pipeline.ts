import { z } from "zod";

export const pipelineStatuses = [
  "inquiry", "pitching", "p_creation", "p_sent", "negotiation", "closing", "closed", "lost",
] as const;
export const pipelineStatusSchema = z.enum(pipelineStatuses);
export type PipelineStatus = z.infer<typeof pipelineStatusSchema>;

export const pipelineLabels: Record<PipelineStatus, string> = {
  inquiry: "Inquiry", pitching: "Pitching", p_creation: "P Creation", p_sent: "P Sent",
  negotiation: "Negotiation", closing: "Closing", closed: "Closed", lost: "Lost",
};

const forwardStatuses: readonly PipelineStatus[] = pipelineStatuses.slice(0, -1);

export function isForward(from: PipelineStatus, to: PipelineStatus): boolean {
  return from !== "lost" && to !== "lost" && forwardStatuses.indexOf(to) > forwardStatuses.indexOf(from);
}

export function pipelineOptions(): { value: PipelineStatus; label: string }[] {
  return pipelineStatuses.map((value) => ({ value, label: pipelineLabels[value] }));
}
