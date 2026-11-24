import { Block, PageGrid } from "../../app/live-edit/page-grid";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Dropdown } from "../../components/ui/Dropdown";
import { Button, PageHeader, Section } from "../../components/shared";
import { useResource } from "../../app/useResource";
import { T } from "../../app/copy";
import { usePermissions } from "../../app/permissions";
import { inventoryCategoriesApi } from "../../services/inventory-categories";

const kinds = ["rental", "ingredient", "bar", "supply", "service"];

export function InventoryCategoriesPage() {
  const { can } = usePermissions();
  const catalog = useResource(["inventory-categories"], inventoryCategoriesApi.list);
  const [kind, setKind] = useState("rental");
  const [name, setName] = useState("");
  const [typeNames, setTypeNames] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const run = async (work: () => Promise<unknown>) => {
    setError("");
    try { await work(); await catalog.refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const categories = (catalog.data?.categories ?? []).filter((row) => row.kind === kind);
  if (!can("inventory.sections")) return <p role="alert"><T id="inventory-categories.forbidden">Only Admins can manage inventory categories.</T></p>;
  return <>
    <Link to="/settings" className="back-link"><T id="inventory-categories.back">← Settings</T></Link>
    <PageHeader pageKey="inventory.categories" title={<T id="inventory-categories.title">Inventory categories</T>}
      subtitle={<T id="inventory-categories.subtitle">Manage categories and their types. Move items before archiving an entry in use.</T>} />
    {error && <p role="alert" className="error-message">{error}</p>}
    <PageGrid pageKey="inventory.categories">
    <Block id="add" name="Add category" h={5}>
    <Section title={<T id="inventory-categories.add-category">Add category</T>}>
      <div className="form-grid">
        <Dropdown aria-label="Kind" value={kind} onValueChange={setKind}>
          {kinds.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
        </Dropdown>
        <input aria-label="New category name" value={name} onChange={(event) => setName(event.target.value)} />
        <Button disabled={!name.trim()} onClick={() => void run(async () => { await inventoryCategoriesApi.createCategory(kind, name.trim()); setName(""); })}>
          <T id="inventory-categories.create">Add category</T>
        </Button>
      </div>
    </Section>
    </Block>
    <Block id="categories" name="Categories and types" h={20}>
    {catalog.error && <p role="alert">{catalog.error}</p>}
    {categories.map((category) => {
      const types = (catalog.data?.types ?? []).filter((row) => row.categoryId === category.id);
      return <Section key={category.id} title={category.name}>
        <div className="form-grid">
          <input aria-label={`Rename ${category.name}`} defaultValue={category.name} key={category.id + category.name}
            onBlur={(event) => { const next = event.target.value.trim(); if (next && next !== category.name) void run(() => inventoryCategoriesApi.updateCategory(category.id, { name: next })); }} />
          <Button variant="outline" onClick={() => void run(() => inventoryCategoriesApi.updateCategory(category.id, { sortOrder: Math.max(0, category.sortOrder - 1) }))}><T id="inventory-categories.move-up">Move up</T></Button>
          <Button variant="outline" onClick={() => void run(() => inventoryCategoriesApi.updateCategory(category.id, { sortOrder: category.sortOrder + 1 }))}><T id="inventory-categories.move-down">Move down</T></Button>
          <Button variant="outline" onClick={() => void run(() => inventoryCategoriesApi.updateCategory(category.id, { archived: true }))}><T id="inventory-categories.archive">Archive</T></Button>
        </div>
        <ul>
          {types.map((type) => <li key={type.id}>
            <input aria-label={`Rename ${type.name}`} defaultValue={type.name} key={type.id + type.name}
              onBlur={(event) => { const next = event.target.value.trim(); if (next && next !== type.name) void run(() => inventoryCategoriesApi.updateType(type.id, { name: next })); }} />
            <Button variant="outline" onClick={() => void run(() => inventoryCategoriesApi.updateType(type.id, { sortOrder: Math.max(0, type.sortOrder - 1) }))}><T id="inventory-categories.move-up">Move up</T></Button>
            <Button variant="outline" onClick={() => void run(() => inventoryCategoriesApi.updateType(type.id, { sortOrder: type.sortOrder + 1 }))}><T id="inventory-categories.move-down">Move down</T></Button>
            <Button variant="outline" onClick={() => void run(() => inventoryCategoriesApi.updateType(type.id, { archived: true }))}><T id="inventory-categories.archive">Archive</T></Button>
          </li>)}
        </ul>
        <div className="form-grid">
          <input aria-label={`New type for ${category.name}`} value={typeNames[category.id] ?? ""}
            onChange={(event) => setTypeNames((current) => ({ ...current, [category.id]: event.target.value }))} />
          <Button disabled={!typeNames[category.id]?.trim()} onClick={() => void run(async () => {
            await inventoryCategoriesApi.createType(category.id, typeNames[category.id].trim());
            setTypeNames((current) => ({ ...current, [category.id]: "" }));
          })}><T id="inventory-categories.add-type">Add type</T></Button>
        </div>
      </Section>;
    })}
    </Block>
    </PageGrid>
  </>;
}
