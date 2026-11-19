import { z } from "zod";

// Live text editing (FLOW-240): the admin rewords the app's built-in screen text.
// Every string has a key ("area.screen.element") and a default in the code; a
// saved override replaces the default for everyone. Overrides are plain text and
// only ever render as text. docs/live-text-editing.md has the conventions.

// Lowercase segments of letters, digits and hyphens, joined by dots, at least two.
export const copyKeySchema = z
  .string()
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/, "Invalid wording key.");
export const COPY_MAX_LENGTH = 500;
export const copyTextSchema = z.string().max(COPY_MAX_LENGTH);

// `{name}` marks a live value in a string.
const placeholderPattern = /\{([A-Za-z0-9_]+)\}/g;

// The distinct placeholder names in a string, sorted.
export function placeholdersOf(text: string): string[] {
  return [...new Set([...text.matchAll(placeholderPattern)].map((m) => m[1]))].sort();
}

// The placeholders an edit lost or invented compared with its default; both
// empty when it keeps exactly the default's.
export function placeholderMismatch(text: string, expected: readonly string[]) {
  const found = placeholdersOf(text);
  return {
    missing: expected.filter((name) => !found.includes(name)),
    unknown: found.filter((name) => !expected.includes(name)),
  };
}

// The message shown under an edit whose placeholders differ from its default.
export function placeholderError(text: string, expected: readonly string[]): string | null {
  const { missing, unknown } = placeholderMismatch(text, expected);
  if (missing.length)
    return `Keep ${missing.map((name) => `{${name}}`).join(", ")} in the text.`;
  if (unknown.length)
    return `${unknown.map((name) => `{${name}}`).join(", ")} isn't a value this text can show.`;
  return null;
}

// GET /api/copy: every override, by key.
export const copyOverridesSchema = z.record(z.string(), z.string());
export type CopyOverrides = z.infer<typeof copyOverridesSchema>;

// PUT /api/copy: the edits to save together. Each carries its default's
// placeholders, which the edit must keep.
export const copyEditSchema = z.object({
  key: copyKeySchema,
  text: copyTextSchema.refine((text) => text.trim().length > 0, "The text can't be empty."),
  placeholders: z.array(z.string().regex(/^[A-Za-z0-9_]+$/)).max(20),
});
export type CopyEdit = z.infer<typeof copyEditSchema>;
export const copyBatchSchema = z
  .array(copyEditSchema)
  .min(1)
  .max(500)
  .superRefine((edits, ctx) => {
    const seen = new Set<string>();
    edits.forEach((edit, index) => {
      if (seen.has(edit.key))
        ctx.addIssue({ code: "custom", path: [index, "key"], message: "Each key once." });
      seen.add(edit.key);
      const error = placeholderError(edit.text, edit.placeholders);
      if (error) ctx.addIssue({ code: "custom", path: [index, "text"], message: error });
    });
  });
