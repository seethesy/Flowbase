// Color contrast for layout styles (FLOW-253), with no imports, so the
// always-loaded live-edit Save check doesn't pull in the layout schemas.

// WCAG AA for normal text.
export const MIN_CONTRAST = 4.5;

// The default text and card colors, for a block that sets only one of them.
export const DEFAULT_TEXT = "#202c27";
export const DEFAULT_BACKGROUND = "#ffffff";

const channel = (value: number) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};
// WCAG contrast ratio, 1 to 21.
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
// Whether a style keeps text readable (4.5:1), checking a single override
// against the default of the other color.
export function styleContrastOk(style: { text?: string; background?: string } | undefined): boolean {
  if (!style || (!style.text && !style.background)) return true;
  return contrastRatio(style.text ?? DEFAULT_TEXT, style.background ?? DEFAULT_BACKGROUND) >= MIN_CONTRAST;
}
