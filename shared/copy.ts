import { z } from "zod";

// Admin live text editing (FLOW-240). The app's built-in wording lives in code as
// each <T>'s default; an admin's override is a row in ui_copy, keyed by the same
// id. See docs/live-text-editing.md for the key convention.

export const COPY_MAX_LENGTH = 500;

// Dotted, lowercase segments: area.screen.element, e.g. leads.inbox.title.
// Segments may hold digits and hyphens (event-staff.shift-form.add-shift).
export const copyKeySchema = z
  .string()
  .max(200)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/,
    "Use a dotted key such as leads.inbox.title.",
  );

// Leading and trailing line breaks go (FLOW-277): pressing Enter in the editor
// must not save "Save Changes\n\n". Spaces are kept as typed, since a default
// can start or end with one (" · automatic").
export function trimLineBreaks(text: string): string {
  return text.replace(/^(?:[ \t]*[\r\n])+/, "").replace(/(?:[\r\n][ \t]*)+$/, "");
}
export const copyTextSchema = z
  .string()
  .max(COPY_MAX_LENGTH)
  .transform(trimLineBreaks)
  .refine((text) => text.trim().length > 0, "The text can't be empty.");

// GET /api/copy: every override, { key: text }.
export const copyOverridesSchema = z.record(copyKeySchema, z.string());
export type CopyOverrides = z.infer<typeof copyOverridesSchema>;

// PUT /api/copy: one batch. Each entry carries its default's placeholder names so
// the Worker can refuse an edit that drops or misspells one.
export const copyEditSchema = z.object({
  key: copyKeySchema,
  text: copyTextSchema,
  placeholders: z.array(z.string().max(60)).max(20).default([]),
});
export const copyBatchSchema = z.array(copyEditSchema).min(1).max(200);
export type CopyEdit = z.infer<typeof copyEditSchema>;

const placeholderPattern = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

// The distinct {name} placeholders in a text, sorted.
export function placeholderNames(text: string): string[] {
  return [...new Set([...text.matchAll(placeholderPattern)].map((match) => match[1]))].sort();
}

// Whether a saved text still fits its default's placeholders (FLOW-277). A later
// release can rename or drop a {placeholder}; an override written for the old
// default would then show "{oldname}" or leave the new value out.
export function placeholdersMatch(defaultText: string, text: string): boolean {
  const expected = placeholderNames(defaultText);
  const found = placeholderNames(text);
  return expected.length === found.length && expected.every((name, index) => name === found[index]);
}

// Names the edit is missing and names it added that the default doesn't have.
export function comparePlaceholders(expected: readonly string[], text: string) {
  const found = placeholderNames(text);
  const want = new Set(expected);
  return {
    missing: [...want].filter((name) => !found.includes(name)).sort(),
    unknown: found.filter((name) => !want.has(name)),
  };
}

// The inline message for a text whose placeholders don't match, or null.
export function placeholderError(expected: readonly string[], text: string): string | null {
  const { missing, unknown } = comparePlaceholders(expected, text);
  if (missing.length) return `Keep ${missing.map((name) => `{${name}}`).join(", ")} in the text`;
  if (unknown.length)
    return `${unknown.map((name) => `{${name}}`).join(", ")} isn't available here. Use ${
      expected.length ? expected.map((name) => `{${name}}`).join(", ") : "plain text"
    }`;
  return null;
}

// Splits a text into literal parts and placeholder names, in order.
export function splitPlaceholders(text: string): ({ text: string } | { name: string })[] {
  const parts: ({ text: string } | { name: string })[] = [];
  let last = 0;
  for (const match of text.matchAll(placeholderPattern)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ name: match[1] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

// A key segment from display text: "Staff & roles" -> "staff-roles".
export function copySlug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/g, "") || "text"
  );
}
