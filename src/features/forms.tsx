import { useState } from "react";
import { Button, DetailDrawer, FormField } from "../components/shared";
import { useDemo } from "../app/store";
import { employees, vendors } from "../data/mock/fixtures";
import type { Client, Item, Proposal } from "../types";
import { today } from "../services/records";
type FormKind = "client" | "proposal" | "item";
export function RecordForm({
  kind,
  onClose,
  record,
  clientId,
}: {
  kind: FormKind;
  onClose: () => void;
  record?: Client | Item | Proposal;
  clientId?: string;
}) {
  const store = useDemo();
  const [error, setError] = useState("");
  const value = (key: string, fallback = "") =>
    String((record as unknown as Record<string, unknown>)?.[key] ?? fallback);
  return (
    <DetailDrawer
      open
      onClose={onClose}
      title={`${record ? "Edit" : "New"} ${kind === "item" ? "inventory item" : kind}`}
    >
      <form
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          const s = (key: string) => String(data.get(key) || "").trim();
          const n = (key: string) => Number(data.get(key));
          if (!s("name")) {
            setError("Name is required.");
            return;
          }
          if (
            kind === "client" &&
            (!s("contact") || !/^\S+@\S+\.\S+$/.test(s("email")))
          ) {
            setError("Enter a contact name and a valid email address.");
            return;
          }
          if (
            kind === "item" &&
            ["onHand", "reserved", "reorder", "cost"].some(
              (k) => !Number.isFinite(n(k)) || n(k) < 0,
            )
          ) {
            setError("Stock quantities and cost must be zero or greater.");
            return;
          }
          if (kind === "item" && n("reserved") > n("onHand")) {
            setError("Reserved quantity cannot exceed stock on hand.");
            return;
          }
          if (
            kind === "proposal" &&
            (!s("clientId") || !s("eventDate") || n("value") <= 0)
          ) {
            setError(
              "Choose a client, event date, and a value greater than zero.",
            );
            return;
          }
          try {
          if (kind === "client")
            await store.clients.save({
              id: record?.id ?? `cli-${Date.now()}`,
              name: s("name"),
              contact: s("contact"),
              email: s("email"),
              phone: s("phone"),
              status: s("status"),
              owner: s("owner"),
              address: s("address"),
              activity: today(),
              notes: (record as Client)?.notes ?? [],
            });
          if (kind === "item")
            await store.inventory.save({
              id: record?.id ?? `INV-${Date.now().toString().slice(-6)}`,
              name: s("name"),
              category: s("category"),
              unit: s("unit"),
              onHand: n("onHand"),
              reserved: n("reserved"),
              reorder: n("reorder"),
              reorderQuantity: n("reorderQuantity"),
              cost: n("cost"),
              vendor: s("vendor"),
              notes: (record as Item)?.notes ?? [],
              history: (record as Item)?.history ?? [],
            });
          if (kind === "proposal")
            await store.proposals.save({
              id: record?.id ?? `FB-${Date.now().toString().slice(-6)}`,
              name: s("name"),
              clientId: s("clientId"),
              value: n("value"),
              stage: (record as Proposal)?.stage ?? "Draft",
              eventDate: s("eventDate"),
              sent: (record as Proposal)?.sent ?? "",
              updated: today(),
              owner: s("owner"),
              priority: (record as Proposal)?.priority ?? false,
              lossReason: (record as Proposal)?.lossReason,
            });
          store.notify(
            `${kind === "item" ? "Inventory item" : kind[0].toUpperCase() + kind.slice(1)} saved in demo memory.`,
          );
          onClose();
          } catch (e) { setError((e as Error).message); }
        }}
      >
        <p className="demo-callout">Demo records are validated by the API. Changes reset on refresh.</p>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <FormField label="Name *">
          <input name="name" defaultValue={value("name")} required autoFocus />
        </FormField>
        {kind === "client" && (
          <>
            <FormField label="Main contact *">
              <input name="contact" defaultValue={value("contact")} required />
            </FormField>
            <FormField label="Email *">
              <input
                name="email"
                type="email"
                defaultValue={value("email")}
                required
              />
            </FormField>
            <FormField label="Phone">
              <input
                name="phone"
                defaultValue={value("phone")}
                placeholder="(555) 010-1234"
              />
            </FormField>
            <FormField label="Address">
              <input name="address" defaultValue={value("address")} />
            </FormField>
            <FormField label="Status">
              <select name="status" defaultValue={value("status", "Active")}>
                {["Active", "Prospect", "Inactive"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </FormField>
          </>
        )}
        {kind === "proposal" && (
          <>
            <FormField label="Client *">
              <select
                name="clientId"
                defaultValue={value("clientId", clientId ?? "")}
                required
              >
                <option value="">Choose a client</option>
                {store.clients.records.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Proposal value ($) *">
              <input
                name="value"
                type="number"
                min="1"
                defaultValue={value("value")}
                required
              />
            </FormField>
            <FormField label="Event date *">
              <input
                name="eventDate"
                type="date"
                defaultValue={value("eventDate")}
                required
              />
            </FormField>
          </>
        )}
        {kind !== "item" && (
          <FormField label="Account owner">
            <select
              name="owner"
              defaultValue={value("owner", employees[0].name)}
            >
              {employees.map((e) => (
                <option key={e.id}>{e.name}</option>
              ))}
            </select>
          </FormField>
        )}
        {kind === "item" && (
          <>
            <FormField label="Category">
              <select
                name="category"
                defaultValue={value("category", "Produce")}
              >
                {[
                  "Produce",
                  "Pantry",
                  "Protein",
                  "Bakery",
                  "Beverages",
                  "Dairy",
                  "Supplies",
                  "Tableware",
                ].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Unit of measurement">
              <select name="unit" defaultValue={value("unit", "kg")}>
                {["kg", "L", "pcs", "bottles"].map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </FormField>
            <div className="form-grid">
              {[
                ["onHand", "On hand"],
                ["reserved", "Reserved"],
                ["reorder", "Reorder point"],
                ["reorderQuantity", "Reorder quantity"],
                ["cost", "Unit cost ($)"],
              ].map(([key, label]) => (
                <FormField label={label} key={key}>
                  <input
                    name={key}
                    type="number"
                    step={key === "cost" ? "0.01" : "1"}
                    min="0"
                    defaultValue={value(key, "0")}
                  />
                </FormField>
              ))}
            </div>
            <FormField label="Preferred vendor">
              <select
                name="vendor"
                defaultValue={value("vendor", vendors[0].name)}
              >
                {vendors.map((s) => (
                  <option key={s.id}>{s.name}</option>
                ))}
              </select>
            </FormField>
          </>
        )}
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Save {kind === "item" ? "item" : kind}</Button>
        </div>
      </form>
    </DetailDrawer>
  );
}
