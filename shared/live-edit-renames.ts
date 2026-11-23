import type { CopyOverrides } from "./copy";
import type { LayoutDoc } from "./layout";

// Keeping the Admin's live edits across releases (FLOW-277). Saved wording
// (ui_copy) and page layouts (ui_layout) are matched to the code by key: a
// wording key, or a block or field-card id inside a page's layout. When code
// renames one, list it here so the saved edit follows it. When code drops one
// for good, list it under `removed`. The CI guard (tests/live-edit-keys.test.ts)
// fails when a key or block id disappears from shared/generated/live-edit-keys.json
// without either entry. See docs/live-text-editing.md.

export type LiveEditRenames = {
  // Old wording key -> new wording key, e.g. "staff.staff-form.save-profile": "staff.staff-form.save".
  copy: Record<string, string>;
  // "<page key>/<old block or field-card id>" -> new id on the same page,
  // e.g. "events.detail/notes": "event-notes".
  blocks: Record<string, string>;
  // Keys and ids that are gone on purpose. Saved edits on them show in the
  // Admin's "no longer match a screen" notice, to delete or move.
  removed: { copy: string[]; blocks: string[] };
};

export const liveEditRenames: LiveEditRenames = {
  copy: {},
  blocks: {},
  removed: { copy: [], blocks: [] },
};

// A rename's final key: follows a chain (a -> b -> c), stops on a loop.
function follow(map: Record<string, string>, key: string): string {
  const seen = new Set<string>();
  let current = key;
  while (Object.hasOwn(map, current) && !seen.has(current)) {
    seen.add(current);
    current = map[current];
  }
  return current;
}

export const resolveCopyKey = (key: string, renames: LiveEditRenames = liveEditRenames) => follow(renames.copy, key);

// The old keys that now resolve to this key.
export function copyAliases(key: string, renames: LiveEditRenames = liveEditRenames): string[] {
  return Object.keys(renames.copy).filter((old) => old !== key && resolveCopyKey(old, renames) === key);
}

// Saved wording as the code reads it now: an override saved under an old key
// shows under its new key. A row saved under the new key itself wins.
export function renameCopyOverrides(overrides: CopyOverrides, renames: LiveEditRenames = liveEditRenames): CopyOverrides {
  const result: CopyOverrides = {};
  for (const [key, text] of Object.entries(overrides)) if (resolveCopyKey(key, renames) === key) result[key] = text;
  for (const [key, text] of Object.entries(overrides)) {
    const next = resolveCopyKey(key, renames);
    if (next !== key && !(next in result)) result[next] = text;
  }
  return result;
}

export function resolveBlockId(pageKey: string, id: string, renames: LiveEditRenames = liveEditRenames): string {
  const seen = new Set<string>();
  let current = id;
  while (Object.hasOwn(renames.blocks, `${pageKey}/${current}`) && !seen.has(current)) {
    seen.add(current);
    current = renames.blocks[`${pageKey}/${current}`];
  }
  return current;
}

// A saved layout as the code reads it now: renamed built-in blocks and field
// cards take their new ids. A block already saved under the new id wins. The
// next Save of the page stores the new ids, so the entry can later be dropped.
export function renameLayoutDoc(pageKey: string, doc: LayoutDoc, renames: LiveEditRenames = liveEditRenames): LayoutDoc {
  const taken = new Set(doc.blocks.filter((block) => resolveBlockId(pageKey, block.id, renames) === block.id).map((b) => b.id));
  const blocks = doc.blocks.flatMap((block) => {
    if (block.kind !== "builtin") return [block];
    const id = resolveBlockId(pageKey, block.id, renames);
    if (id === block.id) return [block];
    if (taken.has(id)) return [];
    taken.add(id);
    return [{ ...block, id }];
  });
  const fieldBoxes: LayoutDoc["fieldBoxes"] = {};
  const entries = Object.entries(doc.fieldBoxes);
  for (const [key, value] of entries) if (resolveBlockId(pageKey, key, renames) === key) fieldBoxes[key] = value;
  for (const [key, value] of entries) {
    const id = resolveBlockId(pageKey, key, renames);
    if (id !== key && !(id in fieldBoxes)) fieldBoxes[id] = value;
  }
  return { ...doc, blocks, fieldBoxes };
}
