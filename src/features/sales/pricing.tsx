import { useState, type ReactNode } from "react";
import { T, useCopy } from "../../app/copy";
import { Block, PageGrid } from "../../app/live-edit/page-grid";
import { usePermissions } from "../../app/permissions";
import { useResource } from "../../app/useResource";
import {
  Button,
  EmptyState,
  ErrorText,
  FilterBar,
  FormDrawer,
  FormField,
  LoadingSkeleton,
  PageHeader,
  SearchInput,
  Select,
} from "../../components/shared";
import { Dropdown } from "../../components/ui/Dropdown";
import {
  formatPrice,
  groupPrices,
  priceBases,
  priceBasisLabels,
  priceCategories,
  priceCategoryLabels,
  priceInputSchema,
  type PriceCategory,
  type PriceItem,
} from "../../../shared/pricing";
import { pricingApi } from "../../services/pricing";
import "./pricing.css";

// Sales › Pricing (FLOW-329): the price list salespeople quote from, grouped
// into packages, per-guest rates, minimums and fees. Everyone who reads
// proposals sees it; the Admin adds, edits and archives prices here.

const categoryHeadings: Record<PriceCategory, ReactNode> = {
  package: <T id="sales.pricing.category.packages">Packages</T>,
  per_guest_rate: <T id="sales.pricing.category.per-guest-rates">Per-guest rates</T>,
  minimum: <T id="sales.pricing.category.minimums">Minimums</T>,
  fee: <T id="sales.pricing.category.fees">Fees</T>,
};

export function PricingPage() {
  const { can } = usePermissions();
  const manage = can("settings.manage");
  const searchPlaceholder = useCopy("sales.pricing.search-placeholder", "Search prices");
  const prices = useResource(["pricing"], pricingApi.list);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [editing, setEditing] = useState<PriceItem | "new" | null>(null);
  const [error, setError] = useState("");
  const term = search.trim().toLowerCase();
  const picked = priceCategories.find((value) => priceCategoryLabels[value] === category);
  const shown = (prices.data ?? []).filter((item) =>
    (!picked || item.category === picked) &&
    (!term || item.name.toLowerCase().includes(term) || item.description.toLowerCase().includes(term)));
  const archive = async (item: PriceItem) => {
    if (!window.confirm(`Archive ${item.name}?`)) return;
    try { await pricingApi.setArchived(item.id, true); prices.reload(); }
    catch (cause) { setError((cause as Error).message); }
  };
  return <>
    <PageHeader pageKey="sales.pricing" title={<T id="sales.pricing.title">Pricing</T>}
      subtitle={<T id="sales.pricing.subtitle">Packages, per-guest rates, minimums and fees to quote from.</T>}
      eyebrow={<T id="sales.pricing.eyebrow">Sales</T>}>
      {manage && <Button onClick={() => setEditing("new")}><T id="sales.pricing.new-price">New price</T></Button>}
    </PageHeader>
    <PageGrid pageKey="sales.pricing">
      <Block id="price-list" name="Price list" h={24}>
        <FilterBar>
          <SearchInput value={search} onChange={setSearch} placeholder={searchPlaceholder} copyId="sales.pricing.search-placeholder" />
          <Select label="Categories" value={category} onChange={setCategory} options={priceCategories.map((value) => priceCategoryLabels[value])} />
        </FilterBar>
        <ErrorText message={error} />
        {prices.error ? <ErrorText message={prices.error} /> : prices.loading && !prices.data ? <LoadingSkeleton /> :
          shown.length === 0 ? <EmptyState
            title={<T id="sales.pricing.empty.title">No prices yet</T>}
            description={manage
              ? <T id="sales.pricing.empty.admin">Add packages, per-guest rates, minimums and fees with New price.</T>
              : <T id="sales.pricing.empty.description">Prices the Admin adds will show here.</T>} /> :
            groupPrices(shown).map((group) => (
              <section key={group.category} className="price-group" aria-label={priceCategoryLabels[group.category]}>
                <h2>{categoryHeadings[group.category]}</h2>
                <div className="table-card"><div className="table-scroll"><table className="price-table">
                  <thead><tr>
                    <th><T id="sales.pricing.column.name">Name</T></th>
                    <th><T id="sales.pricing.column.price">Price</T></th>
                    <th><T id="sales.pricing.column.details">Details</T></th>
                    {manage && <th><span className="sr-only"><T id="sales.pricing.column.actions">Actions</T></span></th>}
                  </tr></thead>
                  <tbody>{group.items.map((item) => <tr key={item.id}>
                    <td>{item.name}</td>
                    <td className="price-amount">{formatPrice(item)}</td>
                    <td className="price-details">{item.description || "—"}</td>
                    {manage && <td className="price-actions">
                      <Button variant="ghost" aria-label={`Edit ${item.name}`} onClick={() => setEditing(item)}><T id="sales.pricing.edit">Edit</T></Button>
                      <Button variant="ghost" aria-label={`Archive ${item.name}`} onClick={() => void archive(item)}><T id="sales.pricing.archive">Archive</T></Button>
                    </td>}
                  </tr>)}</tbody>
                </table></div></div>
              </section>
            ))}
      </Block>
    </PageGrid>
    {editing && <PriceForm price={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); prices.reload(); }} />}
  </>;
}

// Amounts are typed in dollars, or in percent for a percent fee.
function PriceForm({ price, onClose, onSaved }: { price: PriceItem | null; onClose: () => void; onSaved: () => void }) {
  const [basis, setBasis] = useState(price?.basis ?? "per_event");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async (form: HTMLFormElement) => {
    const data = new FormData(form);
    const amount = Math.round(Number(data.get("amount")) * 100);
    const parsed = priceInputSchema.safeParse({
      name: String(data.get("name") ?? ""),
      category: data.get("category"),
      basis,
      amount: String(data.get("amount") ?? "").trim() === "" || Number.isNaN(amount) ? -1 : amount,
      description: String(data.get("description") ?? ""),
    });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the price."); return; }
    setSaving(true);
    try {
      if (price) await pricingApi.update(price.id, parsed.data);
      else await pricingApi.create(parsed.data);
      onSaved();
    } catch (cause) { setError((cause as Error).message); }
    finally { setSaving(false); }
  };
  return (
    <FormDrawer onClose={onClose} onSubmit={save} error={error} saving={saving}
      title={price ? <T id="sales.pricing.form.edit-price">Edit price</T> : <T id="sales.pricing.form.new-price">New price</T>}
      saveLabel={<T id="sales.pricing.form.save">Save price</T>} cancelLabel={<T id="sales.pricing.form.cancel">Cancel</T>}>
      <FormField label={<T id="sales.pricing.form.name">Name *</T>}><input name="name" defaultValue={price?.name ?? ""} autoFocus /></FormField>
      <FormField label={<T id="sales.pricing.form.category">Category</T>}>
        <Dropdown name="category" aria-label="Category" defaultValue={price?.category ?? "package"}>
          {priceCategories.map((value) => <option key={value} value={value}>{priceCategoryLabels[value]}</option>)}
        </Dropdown>
      </FormField>
      <FormField label={<T id="sales.pricing.form.charged">Charged</T>}>
        <Dropdown aria-label="Charged" value={basis} onChange={(event) => setBasis(event.target.value as typeof basis)}>
          {priceBases.map((value) => <option key={value} value={value}>{priceBasisLabels[value]}</option>)}
        </Dropdown>
      </FormField>
      <FormField label={basis === "percent" ? <T id="sales.pricing.form.percent">Percent *</T> : <T id="sales.pricing.form.amount">Amount ($) *</T>}>
        <input name="amount" type="number" min="0" step="0.01" inputMode="decimal" defaultValue={price ? price.amount / 100 : ""} />
      </FormField>
      <FormField label={<T id="sales.pricing.form.details">Details</T>}><textarea name="description" rows={3} defaultValue={price?.description ?? ""} /></FormField>
    </FormDrawer>
  );
}
