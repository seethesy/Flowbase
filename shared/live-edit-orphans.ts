import { z } from "zod";
import { copyKeySchema } from "./copy";
import type { LayoutDoc } from "./layout";
import { liveEditRenames, resolveBlockId, resolveCopyKey, type LiveEditRenames } from "./live-edit-renames";

// Saved edits that no longer match a screen (FLOW-277): wording rows whose key
// no screen renders, and layout blocks or field cards whose id the page no
// longer has. The Admin sees them in edit mode and deletes or moves each one.

export type LiveEditManifest = {
  version: number;
  copy: Record<string, string[]>;
  copyPrefixes: string[];
  layout: Record<string, { blocks: string[]; fieldCards: string[] }>;
  tables: string[];
};
// The manifest itself (shared/generated/live-edit-keys.json) is read by the
// Worker only, so the app's bundle doesn't carry it.

export const orphanCopySchema = z.object({ key: z.string(), text: z.string() });
export const orphanBlockSchema = z.object({
  pageKey: z.string(),
  id: z.string(),
  // A page block, or a field card's boxes.
  kind: z.enum(["block", "fieldCard"]),
});
export const orphansSchema = z.object({ copy: orphanCopySchema.array(), blocks: orphanBlockSchema.array() });
export type Orphans = z.infer<typeof orphansSchema>;

// The same rule as layoutKeySchema in shared/layout.ts, kept here so the app's
// first load doesn't carry the layout schemas (this file loads with copy.tsx).
const layoutKey = z
  .string()
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/);
const blockRef = { pageKey: layoutKey, id: layoutKey };
// POST /api/copy/orphans: delete one, or move it to a key a screen renders.
export const orphanActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("delete"), type: z.literal("copy"), key: copyKeySchema }).strict(),
  z.object({ action: z.literal("move"), type: z.literal("copy"), key: copyKeySchema, to: copyKeySchema }).strict(),
  z.object({ action: z.literal("delete"), type: z.literal("block"), ...blockRef }).strict(),
  z.object({ action: z.literal("move"), type: z.literal("block"), ...blockRef, to: layoutKeySchema }).strict(),
]);
export type OrphanAction = z.infer<typeof orphanActionSchema>;

export function copyKeyKnown(key: string, manifest: LiveEditManifest): boolean {
  return Object.hasOwn(manifest.copy, key) || manifest.copyPrefixes.some((prefix) => key.startsWith(prefix));
}

export function findOrphans(
  copy: Record<string, string>,
  layouts: { pageKey: string; layout: LayoutDoc }[],
  manifest: LiveEditManifest,
  renames: LiveEditRenames = liveEditRenames,
): Orphans {
  const copyOrphans = Object.entries(copy)
    .filter(([key]) => {
      const next = resolveCopyKey(key, renames);
      // A renamed row shadowed by a row under the new key is never read either.
      return !copyKeyKnown(next, manifest) || (next !== key && Object.hasOwn(copy, next));
    })
    .map(([key, text]) => ({ key, text }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const blocks: Orphans["blocks"] = [];
  for (const { pageKey, layout } of layouts) {
    const page = manifest.layout[pageKey];
    for (const block of layout.blocks ?? [])
      if (block.kind === "builtin" && !page?.blocks.includes(resolveBlockId(pageKey, block.id, renames)))
        blocks.push({ pageKey, id: block.id, kind: "block" });
    for (const key of Object.keys(layout.fieldBoxes ?? {}))
      if (!page?.fieldCards.includes(resolveBlockId(pageKey, key, renames))) blocks.push({ pageKey, id: key, kind: "fieldCard" });
  }
  blocks.sort((a, b) => a.pageKey.localeCompare(b.pageKey) || a.id.localeCompare(b.id));
  return { copy: copyOrphans, blocks };
}

// A saved layout with one orphaned block or field card removed, or moved to an
// id the page has (replacing what was saved under that id).
export function withoutOrphan(doc: LayoutDoc, id: string): LayoutDoc {
  const fieldBoxes = { ...doc.fieldBoxes };
  delete fieldBoxes[id];
  return { ...doc, blocks: doc.blocks.filter((block) => !(block.kind === "builtin" && block.id === id)), fieldBoxes };
}
export function moveOrphan(doc: LayoutDoc, id: string, to: string): LayoutDoc {
  const block = doc.blocks.find((b) => b.kind === "builtin" && b.id === id);
  if (block)
    return {
      ...doc,
      blocks: doc.blocks.filter((b) => b.id !== to).map((b) => (b === block ? { ...b, id: to } : b)),
    };
  if (!(id in doc.fieldBoxes)) return doc;
  const fieldBoxes = { ...doc.fieldBoxes, [to]: doc.fieldBoxes[id] };
  delete fieldBoxes[id];
  return { ...doc, fieldBoxes };
}
