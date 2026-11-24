import { layoutItemGone, type LayoutLifecycle, type StoredLayoutDoc } from "./layout";

export type DeletedItem = { key: string; kind: string; builtin: boolean; state: LayoutLifecycle };
// Stable paths are internal identifiers, never inferred from editable labels.
export function layoutItems(doc: StoredLayoutDoc): DeletedItem[] {
  const items: DeletedItem[] = [];
  for (const block of doc.blocks) {
    items.push({ key: `block/${block.id}`, kind: block.kind === "text" ? "Text" : "Card", builtin: block.kind === "builtin", state: block });
    const display = block.kind === "card" ? block.card.display : block.kind === "builtin" ? block.data?.display : undefined;
    if (display?.type === "boxes") for (const box of display.boxes)
      items.push({ key: `card-box/${block.id}/${box.id}`, kind: box.kind === "field" ? "Field box" : "Text box", builtin: false, state: box });
  }
  for (const [key, state] of Object.entries(doc.tables)) items.push({ key: `table/${key}`, kind: "Table", builtin: true, state });
  for (const [key, state] of Object.entries(doc.headers ?? {})) items.push({ key: `header/${key}`, kind: "Header", builtin: true, state });
  for (const [card, config] of Object.entries(doc.fieldBoxes)) for (const box of config.boxes)
    items.push({ key: `field-box/${card}/${box.id}`, kind: box.kind === "field" ? "Field box" : "Text box", builtin: box.kind === "field", state: box });
  return items;
}
export function changeDeletedItem<D extends StoredLayoutDoc>(doc: D, key: string, action: "restore" | "permanent"): D {
  const next = structuredClone(doc);
  const item = layoutItems(next).find((item) => item.key === key);
  if (!item?.state.deleted || item.state.removed) return doc;
  delete item.state.deleted;
  if (action === "restore") {
    // A restored block is shown even if it was hidden before deletion.
    if (key.startsWith("block/")) {
      const block = next.blocks.find((block) => `block/${block.id}` === key);
      if (block?.kind === "builtin") delete block.hidden;
    }
    return next;
  }
  if (item.builtin) { item.state.removed = true; return next; }
  const [type, parent, id] = key.split("/");
  if (type === "block") {
    next.blocks = next.blocks.filter((block) => block.id !== parent);
    for (const header of Object.keys(next.headers ?? {})) if (header.startsWith(`${parent}.`)) delete next.headers![header];
  }
  else if (type === "field-box") next.fieldBoxes[parent].boxes = next.fieldBoxes[parent].boxes.filter((box) => box.id !== id);
  else {
    const block = next.blocks.find((block) => block.id === parent);
    const display = block?.kind === "card" ? block.card.display : block?.kind === "builtin" ? block.data?.display : undefined;
    if (display?.type === "boxes") display.boxes = display.boxes.filter((box) => box.id !== id);
  }
  return next;
}
export function layoutLifecycleChanges(before: StoredLayoutDoc, after: StoredLayoutDoc) {
  const previous = new Map(layoutItems(before).map((item) => [item.key, item]));
  const current = new Map(layoutItems(after).map((item) => [item.key, item]));
  return [...new Set([...previous.keys(), ...current.keys()])].flatMap((key) => {
    const old = previous.get(key)?.state;
    const next = current.get(key)?.state;
    const action = next?.removed && !old?.removed ? "permanent-delete"
      : next?.deleted && !old?.deleted ? "delete"
      : old?.deleted && !next ? "permanent-delete"
      : old?.deleted && next && !layoutItemGone(next) ? "restore" : null;
    return action ? [{ key, action }] : [];
  });
}
