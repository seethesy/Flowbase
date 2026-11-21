import { useState, type CSSProperties } from "react";
import { contrastRatio, DEFAULT_BACKGROUND, DEFAULT_TEXT, MIN_CONTRAST, styleContrastOk, type BlockStyle } from "../../shared/layout";
import { Button } from "../components/ui/button";
import { roles, type Role } from "../../shared/access";
import { roleLabel } from "../services/users";

// Text and background colors of a block or box (FLOW-253): a swatch palette of
// Flowbase tokens and the eight pipeline colors (FLOW-251), a custom hex, and
// Default. Text color reaches headings, labels, values and free text; links,
// status pills and buttons keep their own colors (see .layout-styled in
// globals.css). Edit chrome, so its wording isn't wrapped in <T>.

export const swatches: { name: string; hex: string }[] = [
  { name: "Text", hex: "#202c27" },
  { name: "Muted", hex: "#64746b" },
  { name: "Primary", hex: "#327459" },
  { name: "Success", hex: "#166534" },
  { name: "Warning", hex: "#92400e" },
  { name: "Error", hex: "#b91c1c" },
  { name: "Info", hex: "#1d4ed8" },
  { name: "White", hex: "#ffffff" },
  { name: "Soft green", hex: "#edf3ee" },
  { name: "Inquiry", hex: "#e8e7e7" },
  { name: "Pitching", hex: "#f8d5cc" },
  { name: "P Creation", hex: "#c9d9df" },
  { name: "P Sent", hex: "#d9d3fb" },
  { name: "Negotiation", hex: "#fbe4a7" },
  { name: "Closing", hex: "#f7d0c9" },
  { name: "Closed", hex: "#a1261d" },
  { name: "Lost", hex: "#3f3f3f" },
];

// CSS custom properties for a styled block or box.
export function styleVars(style: BlockStyle | undefined): CSSProperties | undefined {
  if (!style?.text && !style?.background) return undefined;
  return {
    ...(style.text ? { "--layout-text": style.text } : {}),
    ...(style.background ? { "--layout-bg": style.background } : {}),
  } as CSSProperties;
}
export const styleClass = (style: BlockStyle | undefined) =>
  [style?.text && "layout-styled-text", style?.background && "layout-styled-bg"].filter(Boolean).join(" ");

function ColorControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const valid = /^#[0-9a-fA-F]{6}$/.test(draft);
  return (
    <fieldset className="layout-color">
      <legend>{label}</legend>
      <div className="layout-swatches">
        {swatches.map((swatch) => (
          <button
            type="button"
            key={swatch.hex}
            className="layout-swatch"
            style={{ background: swatch.hex }}
            aria-label={`${label}: ${swatch.name}`}
            aria-pressed={value === swatch.hex}
            title={swatch.name}
            onClick={() => {
              setDraft(swatch.hex);
              onChange(swatch.hex);
            }}
          />
        ))}
      </div>
      <div className="layout-color-row">
        <input
          aria-label={`${label} hex`}
          value={draft}
          maxLength={7}
          placeholder="#rrggbb"
          aria-invalid={draft !== "" && !valid ? true : undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            if (/^#[0-9a-fA-F]{6}$/.test(event.target.value)) onChange(event.target.value.toLowerCase());
          }}
        />
        <Button
          variant="ghost"
          onClick={() => {
            setDraft("");
            onChange(undefined);
          }}
        >
          Default
        </Button>
      </div>
    </fieldset>
  );
}

export function StylePopover({
  style,
  onChange,
  visibleTo,
  onVisibleToChange,
  onClose,
}: {
  style: BlockStyle | undefined;
  onChange: (style: BlockStyle | undefined) => void;
  // Dashboard and custom cards only (FLOW-269): the roles the card is shown to;
  // undefined means every role.
  visibleTo?: Role[];
  onVisibleToChange?: (visibleTo: Role[] | undefined) => void;
  onClose: () => void;
}) {
  const set = (key: keyof BlockStyle, value: string | undefined) => {
    const next = { ...style, [key]: value };
    if (!value) delete next[key];
    onChange(next.text || next.background ? next : undefined);
  };
  const ok = styleContrastOk(style);
  const ratio = contrastRatio(style?.text ?? DEFAULT_TEXT, style?.background ?? DEFAULT_BACKGROUND);
  return (
    <div
      className="layout-style-popover"
      role="dialog"
      aria-label="Style"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <ColorControl label="Text color" value={style?.text} onChange={(value) => set("text", value)} />
      <ColorControl label="Background color" value={style?.background} onChange={(value) => set("background", value)} />
      <p className="layout-style-preview" style={{ color: style?.text ?? DEFAULT_TEXT, background: style?.background ?? DEFAULT_BACKGROUND }}>
        Sample text
      </p>
      {!ok && (
        <p role="alert" className="live-copy-error">
          {`These colors are hard to read (${ratio.toFixed(1)}:1; needs ${MIN_CONTRAST}:1). Pick colors further apart to save.`}
        </p>
      )}
      {onVisibleToChange && (
        <fieldset className="layout-color">
          <legend>Visible to</legend>
          {roles.map((role) => {
            const shown = !visibleTo || visibleTo.includes(role);
            return (
              <label key={role} className="layout-visible-to">
                <input
                  type="checkbox"
                  checked={shown}
                  onChange={(event) => {
                    const current = visibleTo ?? [...roles];
                    const next = event.target.checked
                      ? roles.filter((r) => r === role || current.includes(r))
                      : current.filter((r) => r !== role);
                    // Every role again is the same as no limit.
                    onVisibleToChange(next.length === roles.length ? undefined : next);
                  }}
                />{" "}
                {roleLabel(role)}
              </label>
            );
          })}
        </fieldset>
      )}
      <div className="form-actions">
        <Button variant="outline" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}
