import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import type { InventoryItem, ItemKind } from "../../shared/inventory";
import type { InventoryChangeInput } from "../../shared/inventory-changes";
import { allPages, inventoryApi, inventoryChangesApi } from "../services/core";
import { useResource } from "../app/useResource";
import { usePermissions } from "../app/permissions";
import { Button, DataTable, LoadingSkeleton, PageHeader } from "../components/shared";
import { csvFileName, downloadCsv, toCsv } from "../services/csv";
import { LoadError } from "../components/record-display";
import "./inventory.css";

const location = (item: InventoryItem) => item.stock.map((level) => level.sectionName).join(", ") ||
  item.consumable?.storageSectionName || "";
const price = (item: InventoryItem) => item.rental?.priceCents ?? item.service?.priceCents ?? null;
const valueOf = (item: InventoryItem, field: string) => field === "priceCents"
  ? price(item) === null ? "" : String(price(item)! / 100)
  : field === "quantity" ? String(item.totalQuantity)
  : String(item[field as "name" | "description" | "category" | "group"] ?? "");

export function MasterInventory() {
  const { can } = usePermissions();
  const items = useResource(["inventory", "master"], () => allPages((cursor) => inventoryApi.list({}, cursor), 500));
  const pending = useResource(["inventory", "master", "pending", items.data?.map((item) => item.id).join(",")], async () => {
    const ids = items.data?.map((item) => item.id) ?? [];
    const batches = [];
    for (let start = 0; start < ids.length; start += 100)
      batches.push(await inventoryChangesApi.pending(ids.slice(start, start + 100)));
    return batches.flat();
  }, { enabled: !!items.data });
  const [kind, setKind] = useState<ItemKind | "">("");
  const [section, setSection] = useState("");
  const [category, setCategory] = useState("");
  const [group, setGroup] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"name" | "quantity" | "price">("name");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const all = useMemo(() => items.data ?? [], [items.data]);
  const sections = [...new Set(all.flatMap((item) => item.stock.map((level) => level.sectionName)
    .concat(item.consumable?.storageSectionName ?? [])))].filter(Boolean).sort();
  const categories = [...new Set(all.map((item) => item.category))].filter(Boolean).sort();
  const groups = [...new Set(all.map((item) => item.group))].filter(Boolean).sort();
  const filtered = useMemo(() => all.filter((item) =>
    (!kind || item.kind === kind) && (!section || location(item).split(", ").includes(section)) &&
    (!category || item.category === category) && (!group || item.group === group) &&
    (!search || `${item.name} ${item.description} ${item.code}`.toLowerCase().includes(search.toLowerCase()))
  ).sort((a, b) => {
    const groupOrder = (a.group || "Ungrouped").localeCompare(b.group || "Ungrouped");
    if (groupOrder) return groupOrder;
    if (sort === "quantity") return a.totalQuantity - b.totalQuantity || a.name.localeCompare(b.name);
    if (sort === "price") return (price(a) ?? 0) - (price(b) ?? 0) || a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name);
  }), [all, kind, section, category, group, search, sort]);
  const pendingIds = new Set(pending.data?.map((change) => change.itemId));
  const canEdit = can("inventory.changes.request");
  const edit = (item: InventoryItem, field: string) => {
    const key = `${item.id}:${field}`;
    return <input aria-label={`${field} for ${item.name}`} value={draft[key] ?? valueOf(item, field)}
      onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
      disabled={!canEdit} />;
  };
  const columns: ColumnDef<InventoryItem, unknown>[] = [
    { id: "quantity", header: "Qty", accessorFn: (item) => item.totalQuantity,
      cell: ({ row }) => row.original.kind === "rental" && row.original.stock.length === 1
        ? edit(row.original, "quantity") : row.original.totalQuantity },
    { accessorKey: "name", header: "Item", cell: ({ row }) => <div className="master-item-cell">
      {edit(row.original, "name")} <Link to={`/inventory/${row.original.id}`}>Open</Link>
      {pendingIds.has(row.original.id) && <span className="badge warning">Pending</span>}
    </div> },
    { accessorKey: "description", header: "Description", cell: ({ row }) => edit(row.original, "description") },
    { id: "location", header: "Location", accessorFn: location },
    { id: "price", header: "Price", accessorFn: (item) => price(item) === null ? "" : (price(item)! / 100).toFixed(2),
      cell: ({ row }) => row.original.kind === "consumable" ? "" : edit(row.original, "priceCents") },
    { id: "ratio", header: "Ratio", accessorFn: (item) => item.ratio ? `${item.ratio.quantity} ${item.ratio.basis}` : "" },
    { accessorKey: "group", header: "Group", cell: ({ row }) => edit(row.original, "group") },
    { id: "status", header: "Status", accessorFn: (item) => item.archivedAt ? "Archived" : pendingIds.has(item.id) ? "Pending" : item.active ? "Active" : "Inactive" },
  ];
  const save = async () => {
    setError(""); setMessage("");
    const changes: InventoryChangeInput[] = [];
    for (const [key, value] of Object.entries(draft)) {
      const split = key.lastIndexOf(":");
      const item = all.find((candidate) => candidate.id === key.slice(0, split));
      const field = key.slice(split + 1);
      if (!item || value === valueOf(item, field)) continue;
      if (field === "quantity") {
        if (item.stock.length !== 1) continue;
        changes.push({ type: "quantity", itemId: item.id, sectionId: item.stock[0].sectionId,
          quantity: Number(value) });
      } else if (field === "priceCents")
        changes.push({ type: "field", itemId: item.id, field, value: value.trim() ? Math.round(Number(value) * 100) : null });
      else if (["name", "description", "group"].includes(field))
        changes.push({ type: "field", itemId: item.id, field: field as "name" | "description" | "group", value });
    }
    if (!changes.length) return;
    try {
      const result = await inventoryChangesApi.submit(changes);
      setDraft({}); setMessage(result.applied ? "Changes saved." : "One approval request submitted for the batch.");
      items.reload(); pending.reload();
    } catch (cause) { setError((cause as Error).message); }
  };
  const exportCsv = () => downloadCsv(csvFileName("master-inventory"), toCsv(
    ["Qty", "Item", "Description", "Location", "Price", "Ratio", "Group", "Status"],
    filtered.map((item) => [item.totalQuantity, item.name, item.description, location(item),
      price(item) === null ? "" : (price(item)! / 100).toFixed(2),
      item.ratio ? `${item.ratio.quantity} ${item.ratio.basis}` : "", item.group,
      item.archivedAt ? "Archived" : pendingIds.has(item.id) ? "Pending" : item.active ? "Active" : "Inactive"]),
  ));
  return <>
    <PageHeader title="Master inventory" subtitle="All items and sections, grouped like the Master sheet." eyebrow="STOCK & SUPPLIES">
      <Button variant="outline" onClick={exportCsv}>Export CSV</Button>
      {canEdit && <Button onClick={() => void save()}>{can("rentals.apply_directly") ? "Save changes" : "Submit batch for approval"}</Button>}
    </PageHeader>
    {error && <p role="alert" className="error-message">{error}</p>}
    {message && <p role="status">{message}</p>}
    <div className="master-filters">
      <input aria-label="Search Master inventory" placeholder="Search" value={search} onChange={(event) => setSearch(event.target.value)} />
      <select aria-label="Kind" value={kind} onChange={(event) => setKind(event.target.value as ItemKind | "")}>
        <option value="">All kinds</option><option value="rental">Rental</option><option value="service">Service</option><option value="consumable">Consumable</option>
      </select>
      <select aria-label="Section" value={section} onChange={(event) => setSection(event.target.value)}>
        <option value="">All sections</option>{sections.map((value) => <option key={value}>{value}</option>)}
      </select>
      <select aria-label="Category" value={category} onChange={(event) => setCategory(event.target.value)}>
        <option value="">All categories</option>{categories.map((value) => <option key={value}>{value}</option>)}
      </select>
      <select aria-label="Group" value={group} onChange={(event) => setGroup(event.target.value)}>
        <option value="">All groups</option>{groups.map((value) => <option key={value}>{value}</option>)}
      </select>
      <select aria-label="Sort" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
        <option value="name">Item</option><option value="quantity">Qty</option><option value="price">Price</option>
      </select>
    </div>
    {items.error ? <LoadError message={items.error} /> : items.loading && !items.data ? <LoadingSkeleton /> :
      [...new Set(filtered.map((item) => item.group || "Ungrouped"))].map((name) =>
        <section key={name} className="master-group"><h2>{name}</h2><DataTable data={filtered.filter((item) => (item.group || "Ungrouped") === name)}
          columns={columns} label="items" /></section>)}
  </>;
}
