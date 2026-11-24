import type { KeyboardEvent, ReactNode } from "react";

// A small two-or-more option switch (FLOW-327): one choice, shown as joined
// buttons with optional icons. A radio group to assistive tech, so arrow keys
// move between options like native radios.
export type SegmentedOption<V extends string> = { value: V; label: string; icon?: ReactNode };

export function SegmentedControl<V extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: V;
  options: readonly SegmentedOption<V>[];
  onChange: (value: V) => void;
  disabled?: boolean;
}) {
  const index = options.findIndex((option) => option.value === value);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step || disabled) return;
    event.preventDefault();
    const next = options[(Math.max(index, 0) + step + options.length) % options.length];
    onChange(next.value);
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button");
    buttons[options.indexOf(next)]?.focus();
  };
  return (
    <div className="segmented-control" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((option, i) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked || (index < 0 && i === 0) ? 0 : -1}
            disabled={disabled}
            className={checked ? "is-selected" : undefined}
            onClick={() => onChange(option.value)}
          >
            {option.icon && <span aria-hidden="true" className="segmented-control__icon">{option.icon}</span>}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
