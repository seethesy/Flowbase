import { useState } from "react";
import { Button } from "../../components/ui/button";
import { usePageLayoutContext } from "./layout-state";
import { DeleteLayoutButton } from "./layout-deletion";
import { changeDeletedItem, layoutItems } from "../../../shared/layout-deletion";

// A deleted page block restores through the page grid (FLOW-321): back to its
// last cell when that is free, else to one the Admin picks (onRestoreBlock).
export function DeletedItemsTray({ onRestoreBlock }: { onRestoreBlock?: (id: string) => void } = {}) {
  const layout = usePageLayoutContext();
  const [open, setOpen] = useState(false);
  if (!layout?.editing) return null;
  const items = layout.doc ? layoutItems(layout.doc).filter((item) => item.state.deleted && !item.state.removed) : [];
  return <div className="layout-tray">
    <Button variant="ghost" className="layout-btn-muted" aria-expanded={open} onClick={() => setOpen(!open)}>{`Deleted items (${items.length})`}</Button>
    {open && <div className="layout-tray-list" role="dialog" aria-label="Deleted items">
      {!items.length ? <p>Nothing is deleted.</p> : <ul>{items.map((item) => <li key={item.key}>
        <span>{item.state.deleted!.name} · {item.kind} · Deleted by {item.state.deleted!.by} at {new Date(item.state.deleted!.at).toLocaleString()}</span>
        <Button variant="ghost" onClick={() => {
          if (onRestoreBlock && item.key.startsWith("block/")) onRestoreBlock(item.key.slice("block/".length)); else layout.update((doc) => changeDeletedItem(doc, item.key, "restore"));
        }}>Restore</Button>
        <DeleteLayoutButton name={item.state.deleted!.name} permanent onDelete={() => layout.update((doc) => changeDeletedItem(doc, item.key, "permanent"))} />
      </li>)}</ul>}
    </div>}
  </div>;
}
