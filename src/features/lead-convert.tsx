import { useState } from "react";
import { Link } from "react-router-dom";
import { TriangleAlert } from "lucide-react";
import type { Lead, LeadConversion } from "../../shared/leads";
import { ApiRequestError, clientsApi } from "../services/core";
import { leadsApi } from "../services/leads";
import { useResource } from "../app/useResource";
import { Button, DetailDrawer, FormField } from "../components/shared";
import { LoadError } from "./clients";
import { leadTitle } from "./lead-shared";

function ClientPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const clients = useResource(() => clientsApi.list(), []);
  if (clients.error) return <LoadError message={clients.error} />;
  return (
    <FormField label="Existing client">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose a client…</option>
        {(clients.data ?? []).map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </select>
    </FormField>
  );
}

// Convert (FLOW-112): a new or linked client, a contact and an inquiry event, all
// pre-filled from the lead. A possible duplicate offers linking instead.
export function ConvertLeadForm({
  lead,
  linkClientId = "",
  onClose,
  onConverted,
}: {
  lead: Lead;
  // Preselects linking to this client (a possible duplicate, FLOW-110).
  linkClientId?: string;
  onClose: () => void;
  onConverted: (result: LeadConversion) => void;
}) {
  const [mode, setMode] = useState<"create" | "link">(linkClientId ? "link" : "create");
  const [name, setName] = useState(lead.name);
  const [kind, setKind] = useState<"person" | "organization">("person");
  const [clientId, setClientId] = useState(linkClientId);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(lead.eventDate ?? "");
  const [startTime, setStartTime] = useState("");
  const [error, setError] = useState("");
  const [duplicates, setDuplicates] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const submit = async (allowDuplicate: boolean) => {
    if (mode === "create" && !name.trim()) return setError("Enter a client name.");
    if (mode === "link" && !clientId) return setError("Choose a client.");
    if (!date) return setError("Enter the event date.");
    if (!startTime) return setError("Enter a start time.");
    setSaving(true);
    setError("");
    setDuplicates([]);
    try {
      onConverted(
        await leadsApi.convert(lead.id, {
          client:
            mode === "create"
              ? { mode, name, kind, allowDuplicate }
              : { mode, clientId },
          event: { title, date, startTime },
        }),
      );
      onClose();
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === "POSSIBLE_DUPLICATE")
        setDuplicates(e.duplicates);
      else setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <DetailDrawer
      open
      onClose={onClose}
      title="Convert lead"
      description={`Creates a client, contact and inquiry event from ${leadTitle(lead)}.`}
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit(false);
        }}
      >
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        {duplicates.length > 0 && (
          <div role="alert" className="error-message">
            <p>
              <TriangleAlert size={14} /> A client with this email or phone
              already exists:
            </p>
            <ul>
              {duplicates.map((duplicate) => (
                <li key={duplicate.id}>
                  {duplicate.name}{" "}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setMode("link");
                      setClientId(duplicate.id);
                      setDuplicates([]);
                    }}
                  >
                    Link to {duplicate.name}
                  </Button>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => void submit(true)}
            >
              Create anyway
            </Button>
          </div>
        )}
        <h3 className="form-subheading">Client</h3>
        <div className="form-group">
          <label>
            <input
              type="radio"
              name="client-mode"
              checked={mode === "create"}
              onChange={() => setMode("create")}
            />{" "}
            Create a new client
          </label>
          <label>
            <input
              type="radio"
              name="client-mode"
              checked={mode === "link"}
              onChange={() => setMode("link")}
            />{" "}
            Link to an existing client
          </label>
        </div>
        {mode === "create" ? (
          <div className="form-grid">
            <FormField label="Client name *">
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField label="Client type">
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as typeof kind)}
              >
                <option value="person">Person</option>
                <option value="organization">Organization</option>
              </select>
            </FormField>
          </div>
        ) : (
          <ClientPicker value={clientId} onChange={setClientId} />
        )}
        <h3 className="form-subheading">Event</h3>
        <FormField
          label="Event title"
          hint={`Blank uses "client — ${lead.eventType || "Event"}".`}
        >
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </FormField>
        <div className="form-grid">
          <FormField label="Event date *">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </FormField>
          <FormField label="Start time *">
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </FormField>
        </div>
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            Convert lead
          </Button>
        </div>
      </form>
    </DetailDrawer>
  );
}
