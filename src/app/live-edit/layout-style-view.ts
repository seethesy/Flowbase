import type { CSSProperties } from "react";
import type { BlockStyle } from "../../../shared/layout";

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

