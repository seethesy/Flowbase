import { createContext, useContext, useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { ConfirmationDialog } from "../components/shared";
import { Button } from "../components/ui/button";
import { usePermissions } from "./permissions";
import { usePageLayoutContext, usePageLayout } from "./layout-state";
import { layoutItemGone } from "../../shared/layout";
import { changeDeletedItem, layoutItems } from "../../shared/layout-deletion";

export const LayoutBlockContext = createContext<string | null>(null);
export function useDeletion() {
  const { actor } = usePermissions();
  return (name: string) => ({ at: new Date().toISOString(), by: actor?.userId ?? "Admin", name: name.slice(0, 200) || "Item" });
}
export function DeleteLayoutButton({ name, onDelete, permanent = false }: { name: string; onDelete: () => void; permanent?: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" aria-label={`${permanent ? "Delete permanently" : "Delete"} ${name}`} onClick={() => setOpen(true)}>
      {permanent ? "Delete permanently" : <Trash2 size={14} />}
    </button>
    <ConfirmationDialog confirmLabel="Confirm" cancelLabel="Cancel" description="Changes apply when you save the layout." open={open} onClose={() => setOpen(false)} title={`${permanent ? "Delete permanently" : "Delete"} ${name}?`}
      onConfirm={() => { onDelete(); setOpen(false); }}>
      {permanent ? "This can't be undone. Built-in items return only through Reset page layout." : `Delete ${name} from this layout? You can restore it from Deleted items.`}
    </ConfirmationDialog>
  </>;
}
export function DeletedItemsTray() {
  const layout = usePageLayoutContext();
  const [open, setOpen] = useState(false);
  if (!layout?.editing) return null;
  const items = layout.doc ? layoutItems(layout.doc).filter((item) => item.state.deleted && !item.state.removed) : [];
  return <div className="layout-tray">
    <Button variant="outline" aria-expanded={open} onClick={() => setOpen(!open)}>{`Deleted items (${items.length})`}</Button>
    {open && <div className="layout-tray-list" role="dialog" aria-label="Deleted items">
      {!items.length ? <p>Nothing is deleted.</p> : <ul>{items.map((item) => <li key={item.key}>
        <span>{item.state.deleted!.name} · {item.kind} · Deleted by {item.state.deleted!.by} at {new Date(item.state.deleted!.at).toLocaleString()}</span>
        <Button variant="ghost" onClick={() => layout.update((doc) => changeDeletedItem(doc, item.key, "restore"))}>Restore</Button>
        <DeleteLayoutButton name={item.state.deleted!.name} permanent onDelete={() => layout.update((doc) => changeDeletedItem(doc, item.key, "permanent"))} />
      </li>)}</ul>}
    </div>}
  </div>;
}
export function LayoutHeader({ headerKey, name, children }: { headerKey: string; name: string; children: ReactNode }) {
  const layout = usePageLayoutContext();
  const deletion = useDeletion();
  const state = layout?.doc?.headers?.[headerKey];
  if (state && layoutItemGone(state)) return null;
  return <>{children}{layout?.editing && <DeleteLayoutButton name={name} onDelete={() => layout.update((doc) => ({
    ...doc, headers: { ...doc.headers, [headerKey]: { deleted: deletion(name) } },
  }))} />}</>;
}
export function PageSubtitle({ pageKey, children }: { pageKey: string; children: ReactNode }) {
  const layout = usePageLayout(pageKey, [], null);
  const deletion = useDeletion();
  if (layout.doc?.headers?.["page-subtitle"] && layoutItemGone(layout.doc.headers["page-subtitle"])) return null;
  return <p>{children}{layout.editing && <DeleteLayoutButton name="Page subtitle" onDelete={() => layout.update((doc) => ({
    ...doc, headers: { ...doc.headers, "page-subtitle": { deleted: deletion("Page subtitle") } },
  }))} />}</p>;
}
export const useLayoutBlockId = () => useContext(LayoutBlockContext);
