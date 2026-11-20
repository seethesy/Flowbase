import { useEffect, useRef, useState, type HTMLAttributes } from "react";
import { pipelineLabels, pipelineOptions, type PipelineStatus } from "../../../shared/pipeline";
import type { EventStatus } from "../../../shared/core-records";

type DisplayStatus = PipelineStatus | Extract<EventStatus, "preparation" | "finished">;
const extraLabels = { preparation: "Preparation", finished: "Finished" } as const;

export function StatusPill({ status, ...props }: HTMLAttributes<HTMLSpanElement> & { status: DisplayStatus }) {
  const label = status in extraLabels ? extraLabels[status as keyof typeof extraLabels] : pipelineLabels[status as PipelineStatus];
  return <span {...props} className={["status-pill", `status-pill--${status}`, props.className].filter(Boolean).join(" ")}>{label}</span>;
}

export function StatusSelect({ value, onChange, includeEventStages = false, options, disabled = false, label = "Status" }: {
  value: DisplayStatus;
  onChange: (value: DisplayStatus) => void;
  includeEventStages?: boolean;
  options?: readonly DisplayStatus[];
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const choices = options ?? (includeEventStages
    ? [...pipelineOptions().slice(0, -1).map((option) => option.value), "preparation", "finished", "lost"] as DisplayStatus[]
    : pipelineOptions().map((option) => option.value));
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return <div className="status-select" ref={root}>
    <button type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}>
      <StatusPill status={value} /><span aria-hidden="true">⌄</span>
    </button>
    {open && <div className="status-select__options" role="listbox" aria-label={label}>
      {choices.map((status) => <button type="button" role="option" aria-selected={status === value} key={status} onClick={() => { onChange(status); setOpen(false); }}><StatusPill status={status} /></button>)}
    </div>}
  </div>;
}
