import { useState } from "react";
import { Button, DetailDrawer, FormField } from "../components/shared";
import { useDemo } from "../app/store";
import { employees } from "../data/mock/fixtures";
import type { Proposal } from "../types";
import { today } from "../services/records";
type FormKind = "proposal";
export function RecordForm({
  kind,
  onClose,
  record,
  clientId,
}: {
  kind: FormKind;
  onClose: () => void;
  record?: Proposal;
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
      title={`${record ? "Edit" : "New"} ${kind}`}
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
            kind === "proposal" &&
            (!s("clientId") || !s("eventDate") || n("value") <= 0)
          ) {
            setError(
              "Choose a client, event date, and a value greater than zero.",
            );
            return;
          }
          try {
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
              `${kind[0].toUpperCase() + kind.slice(1)} saved in demo memory.`,
            );
            onClose();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <p className="demo-callout">
          Demo records are validated by the API. Changes reset on refresh.
        </p>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <FormField label="Name *">
          <input name="name" defaultValue={value("name")} required autoFocus />
        </FormField>
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
        {(
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
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Save {kind}</Button>
        </div>
      </form>
    </DetailDrawer>
  );
}
