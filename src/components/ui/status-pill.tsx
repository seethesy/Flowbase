import type { HTMLAttributes } from "react";
import { Dropdown } from "./Dropdown";
import { pipelineLabels, pipelineOptions, type PipelineStatus } from "../../../shared/pipeline";
import type { EventStatus } from "../../../shared/core-records";

type DisplayStatus = PipelineStatus | Extract<EventStatus, "preparation" | "finished">;
const extraLabels = { preparation: "Preparation", finished: "Finished" } as const;

export function StatusPill({ status, ...props }: HTMLAttributes<HTMLSpanElement> & { status: DisplayStatus }) {
  const label = statusLabel(status);
  return <span {...props} className={["status-pill", `status-pill--${status}`, props.className].filter(Boolean).join(" ")}>{label}</span>;
}

// The status pill dropdown (FLOW-251 colors) on the shared Dropdown (FLOW-259).
export const statusPillClass = (status: string) => `status-pill status-pill--${status}`;
export function statusLabel(status: DisplayStatus): string {
  return status in extraLabels ? extraLabels[status as keyof typeof extraLabels] : pipelineLabels[status as PipelineStatus];
}
export function StatusSelect({ value, onChange, includeEventStages = false, options, disabled = false, label = "Status" }: {
  value: DisplayStatus;
  onChange: (value: DisplayStatus) => void;
  includeEventStages?: boolean;
  options?: readonly DisplayStatus[];
  disabled?: boolean;
  label?: string;
}) {
  const choices = options ?? (includeEventStages
    ? [...pipelineOptions().slice(0, -1).map((option) => option.value), "preparation", "finished", "lost"] as DisplayStatus[]
    : pipelineOptions().map((option) => option.value));
  // The current value always shows, even when it isn't one of the choices.
  const all = choices.includes(value) ? choices : [value, ...choices];
  return <Dropdown
    variant="pill"
    aria-label={label}
    disabled={disabled}
    value={value}
    pill={statusPillClass}
    options={all.map((status) => ({ value: status, label: statusLabel(status), disabled: status === value && !choices.includes(value) }))}
    onValueChange={(next) => onChange(next as DisplayStatus)}
  />;
}
