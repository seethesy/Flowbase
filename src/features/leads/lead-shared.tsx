import { Dropdown } from "../../components/ui/Dropdown";
import { useState, type FormEvent, type ReactNode } from "react";
import { type Lead, type LeadStatus } from "../../../shared/leads";
import { StatusPill } from "../../components/ui/status-pill";
import { useResource } from "../../app/useResource";
import { leadsApi } from "../../services/leads";
import { Button, FormField } from "../../components/shared";

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  return <StatusPill status={status} />;
}

export const businessDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
export const eventDay = (value: string | null) =>
  value
    ? new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";
export const money = (cents: number | null) =>
  cents === null ? "—" : `$${(cents / 100).toLocaleString("en-US")}`;
export const duration = (seconds: number) => {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
};
export const leadTitle = (lead: Lead) => lead.name || "Unnamed lead";
// The select boxes show labels; the API takes the values.
export const valueOf = <T extends string>(labels: Record<T, string>, label: string) =>
  (Object.keys(labels) as T[]).find((key) => labels[key] === label);

// Takes a salesperson's user id. There is no user directory until FLOW-37, so the
// id is typed in; the API answers 403 for anyone but Admin.
export function AssignForm({
  label,
  button,
  onAssign,
}: {
  label: ReactNode;
  button: ReactNode;
  onAssign: (salespersonId: string) => Promise<void>;
}) {
  const [salespersonId, setSalespersonId] = useState("");
  const owners = useResource(["lead-owners"], leadsApi.owners);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!salespersonId.trim()) return setError("Choose an owner.");
    setSaving(true);
    setError("");
    try {
      await onAssign(salespersonId.trim());
      setSalespersonId("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <form noValidate onSubmit={(event) => void submit(event)}>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <div className="filter-bar">
        <FormField label={label}>
          <Dropdown value={salespersonId} onChange={(e) => setSalespersonId(e.target.value)}>
            <option value="">Choose an owner</option>
            {owners.data?.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
          </Dropdown>
        </FormField>
        <Button type="submit" variant="outline" disabled={saving}>
          {button}
        </Button>
      </div>
    </form>
  );
}
