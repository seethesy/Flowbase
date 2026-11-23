import { useState, type CSSProperties } from "react";
import {
  contrastRatio,
  DEFAULT_BACKGROUND,
  DEFAULT_TEXT,
  MIN_CONTRAST,
  paddingOptions,
  radiusOptions,
  styleContrastOk,
  titleSizeOptions,
  type BlockStyle,
} from "../../shared/layout";
import { Button } from "../components/ui/button";
import { RoundCheck } from "../components/ui/round-check";
import { roles, type Role } from "../../shared/access";
import { roleLabel } from "../services/users";

// The look of a block or box: text and background colors (FLOW-253), border,
// corners, padding, title bar, accent stripe and presets (FLOW-278). Colors: a swatch palette of
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
  if (!style) return undefined;
  const vars = {
    ...(style.text ? { "--layout-text": style.text } : {}),
    ...(style.background ? { "--layout-bg": style.background } : {}),
    ...(style.border && style.border !== "none" ? { "--layout-border": style.border } : {}),
    ...(style.accent ? { "--layout-accent": style.accent } : {}),
  };
  return Object.keys(vars).length ? (vars as CSSProperties) : undefined;
}
export const styleClass = (style: BlockStyle | undefined) =>
  [
    style?.text && "layout-styled-text",
    style?.background && "layout-styled-bg",
    style?.border === "none" ? "layout-border-none" : style?.border && "layout-styled-border",
    style?.radius && `layout-radius-${style.radius}`,
    style?.padding && `layout-padding-${style.padding}`,
    style?.titleHidden && "layout-title-hidden",
    style?.titleSize && `layout-title-${style.titleSize}`,
    style?.accent && "layout-styled-accent",
  ]
    .filter(Boolean)
    .join(" ");

// Named looks (FLOW-278): each sets the whole style; Default clears it.
export const stylePresets: { name: string; style: BlockStyle }[] = [
  { name: "Plain", style: { border: "none", padding: "compact", radius: "none" } },
  { name: "Card", style: { border: "#d6ddd8", radius: "large", padding: "normal" } },
  { name: "Highlight", style: { background: "#edf3ee", accent: "#327459", radius: "large", padding: "roomy" } },
  { name: "Warning", style: { text: "#92400e", background: "#fef3c7", accent: "#b45309", border: "#f59e0b", radius: "small" } },
];

// Drops undefined options; no option left means the default look.
export function cleanStyle(style: BlockStyle): BlockStyle | undefined {
  const next = Object.fromEntries(Object.entries(style).filter(([, value]) => value !== undefined && value !== false)) as BlockStyle;
  return Object.keys(next).length ? next : undefined;
}

function Choice<V extends string>({
  label,
  value,
  options,
  names,
  onChange,
}: {
  label: string;
  value: V | undefined;
  options: readonly V[];
  names: Record<V, string>;
  onChange: (value: V | undefined) => void;
}) {
  return (
    <fieldset className="layout-style-choice">
      <legend>{label}</legend>
      {options.map((option) => (
        <button
          type="button"
          key={option}
          aria-pressed={value === option}
          onClick={() => onChange(value === option ? undefined : option)}
        >
          {names[option]}
        </button>
      ))}
    </fieldset>
  );
}

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
  // Bumped by a preset or Default, so the hex inputs show the new colors.
  const [version, setVersion] = useState(0);
  const set = <K extends keyof BlockStyle>(key: K, value: BlockStyle[K] | undefined) =>
    onChange(cleanStyle({ ...style, [key]: value }));
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
      <fieldset className="layout-style-choice">
        <legend>Presets</legend>
        {stylePresets.map((preset) => (
          <button
            type="button"
            key={preset.name}
            onClick={() => {
              onChange({ ...preset.style });
              setVersion((n) => n + 1);
            }}
          >
            {preset.name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            onChange(undefined);
            setVersion((n) => n + 1);
          }}
        >
          Default look
        </button>
      </fieldset>
      <ColorControl key={`text-${version}`} label="Text color" value={style?.text} onChange={(value) => set("text", value)} />
      <ColorControl key={`background-${version}`} label="Background color" value={style?.background} onChange={(value) => set("background", value)} />
      <fieldset className="layout-style-choice">
        <legend>Border</legend>
        <button type="button" aria-pressed={style?.border === "none"} onClick={() => set("border", style?.border === "none" ? undefined : "none")}>
          No border
        </button>
      </fieldset>
      {style?.border !== "none" && (
        <ColorControl key={`border-${version}`} label="Border color" value={style?.border} onChange={(value) => set("border", value)} />
      )}
      <ColorControl key={`accent-${version}`} label="Accent stripe" value={style?.accent} onChange={(value) => set("accent", value)} />
      <Choice
        label="Corners"
        value={style?.radius}
        options={radiusOptions}
        names={{ none: "Square", small: "Small", large: "Large" }}
        onChange={(value) => set("radius", value)}
      />
      <Choice
        label="Padding"
        value={style?.padding}
        options={paddingOptions}
        names={{ compact: "Compact", normal: "Normal", roomy: "Roomy" }}
        onChange={(value) => set("padding", value)}
      />
      <Choice
        label="Title size"
        value={style?.titleSize}
        options={titleSizeOptions}
        names={{ small: "Small", normal: "Normal", large: "Large" }}
        onChange={(value) => set("titleSize", value)}
      />
      <label className="layout-visible-to">
        <RoundCheck
          checked={Boolean(style?.titleHidden)}
          onChange={(event) => set("titleHidden", event.target.checked || undefined)}
        />{" "}
        Hide title bar
      </label>
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
                <RoundCheck
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
