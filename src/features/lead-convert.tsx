import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import type { Lead, LeadConversion } from "../../shared/leads";
import { ApiRequestError, clientsApi } from "../services/core";
import { leadsApi } from "../services/leads";
import { useResource } from "../app/useResource";
import { useDebounced } from "../app/paging";
import { Button, DetailDrawer, FormField } from "../components/shared";
import { LoadError } from "../components/record-display";
import { leadTitle } from "./lead-shared";
import { T, useCopy } from "../app/live-copy";

function ClientPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const copyPlaceholder = useCopy("lead-convert.client-picker.placeholder-type-a-client-or-contact-name", "Type a client or contact name");
  // Searches every client as you type (FLOW-179); the chosen client stays listed.
  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim());
  const clients = useResource(
    ["clients", "search", term],
    async () => (await clientsApi.list({ search: term || undefined })).rows,
    { reference: true, keepPrevious: true },
  );
  const listed = clients.data?.find((client) => client.id === value);
  const fetched = useResource(
    ["clients", value],
    () => clientsApi.get(value),
    { enabled: Boolean(value && !listed) },
  );
  const chosen = !listed && fetched.data?.id === value ? fetched.data : undefined;
  if (clients.error) return <LoadError message={clients.error} />;
  return (
    <>
      <FormField label={<T id="lead-convert.client-picker.find-client">Find client</T>}>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={copyPlaceholder}
        />
      </FormField>
      <FormField label={<T id="lead-convert.client-picker.existing-client">Existing client</T>}>
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose a client…</option>
          {[...(chosen ? [chosen] : []), ...(clients.data ?? [])].map(
            (client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ),
          )}
        </select>
      </FormField>
    </>
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
      title={<T id="lead-convert.convert-lead-form.convert-lead">Convert lead</T>}
      description={<T id="lead-convert.convert-lead-form.creates-a-client-contact-and-inquiry" values={{ lead: leadTitle(lead) }}>{"Creates a client, contact and inquiry event from {lead}."}</T>}
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
              <TriangleAlert size={14} /> <T id="lead-convert.convert-lead-form.a-client-with-this-email-or">{" A client with this email or phone already exists:"}</T>
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
                    <T id="lead-convert.convert-lead-form.link-to" values={{ name: duplicate.name }}>{"Link to {name}"}</T>
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
              <T id="lead-convert.convert-lead-form.create-anyway">Create anyway</T>
            </Button>
          </div>
        )}
        <h3 className="form-subheading"><T id="lead-convert.convert-lead-form.client">Client</T></h3>
        <div className="form-group">
          <label>
            <input
              type="radio"
              name="client-mode"
              checked={mode === "create"}
              onChange={() => setMode("create")}
            /><T id="lead-convert.convert-lead-form.create-a-new-client">{" Create a new client"}</T>
          </label>
          <label>
            <input
              type="radio"
              name="client-mode"
              checked={mode === "link"}
              onChange={() => setMode("link")}
            /><T id="lead-convert.convert-lead-form.link-to-an-existing-client">{" Link to an existing client"}</T>
          </label>
        </div>
        {mode === "create" ? (
          <div className="form-grid">
            <FormField label={<T id="lead-convert.convert-lead-form.client-name">Client name *</T>}>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField label={<T id="lead-convert.convert-lead-form.client-type">Client type</T>}>
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
        <h3 className="form-subheading"><T id="lead-convert.convert-lead-form.event">Event</T></h3>
        <FormField
          label={<T id="lead-convert.convert-lead-form.event-title">Event title</T>}
          hint={<T id="lead-convert.convert-lead-form.blank-uses-client" values={{ eventType: lead.eventType || "Event" }}>{"Blank uses \"client — {eventType}\"."}</T>}
        >
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </FormField>
        <div className="form-grid">
          <FormField label={<T id="lead-convert.convert-lead-form.event-date">Event date *</T>}>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </FormField>
          <FormField label={<T id="lead-convert.convert-lead-form.start-time">Start time *</T>}>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </FormField>
        </div>
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={onClose}>
            <T id="lead-convert.convert-lead-form.cancel">Cancel</T>
          </Button>
          <Button type="submit" disabled={saving}>
            <T id="lead-convert.convert-lead-form.convert-lead">Convert lead</T>
          </Button>
        </div>
      </form>
    </DetailDrawer>
  );
}
