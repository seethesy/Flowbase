import { useState } from "react";
import { Link } from "react-router-dom";
import {
  communicationKindLabels,
  communicationKindSchema,
  type CommunicationKind,
} from "../../shared/communications";
import { communicationsApi, type CommunicationTarget } from "../services/communications";
import { LoadMore, usePagedList } from "../app/paging";
import { Button, FormField, LoadingSkeleton, Section } from "../components/shared";
import { LoadError } from "../components/record-display";
import "./leads.css";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const day = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

// The communication log of a lead, client or event (FLOW-120): newest first with
// who logged each entry, and a form to log a call, email, text, meeting or note. A
// next follow-up date creates a task for the salesperson.
export function CommunicationLog({ target }: { target: CommunicationTarget }) {
  const key = Object.entries(target)[0];
  const entries = usePagedList(["communications", ...key], (cursor) =>
    communicationsApi.list(target, cursor),
  );
  const [kind, setKind] = useState<CommunicationKind>("call");
  const [summary, setSummary] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!summary.trim()) return setError("Enter a summary.");
    setSaving(true);
    setError("");
    try {
      await communicationsApi.log({
        ...target,
        kind,
        summary,
        followUpDate: followUp || null,
      });
      setSummary("");
      setFollowUp("");
      entries.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Section title="Communication log">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <div className="form-grid">
          <FormField label="Type">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as CommunicationKind)}
            >
              {communicationKindSchema.options.map((option) => (
                <option key={option} value={option}>
                  {communicationKindLabels[option]}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Next follow-up">
            <input
              type="date"
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
            />
          </FormField>
        </div>
        <FormField label="Summary *">
          <textarea
            rows={3}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </FormField>
        <Button type="submit" disabled={saving}>
          Log conversation
        </Button>
      </form>
      {entries.error ? (
        <LoadError message={entries.error} />
      ) : !entries.data ? (
        <LoadingSkeleton />
      ) : entries.data.length === 0 ? (
        <p className="muted">Nothing logged yet.</p>
      ) : (
        <>
          <ul className="communication-log">
            {entries.data.map((entry) => (
              <li key={entry.id}>
                <p>
                  <strong>{communicationKindLabels[entry.kind]}</strong>{" "}
                  <small>
                    {when(entry.occurredAt)}
                    {entry.loggedByName ? ` · ${entry.loggedByName}` : ""}
                  </small>
                </p>
                <p>{entry.summary}</p>
                {entry.followUpDate && (
                  <p>
                    <small>
                      Follow-up {day(entry.followUpDate)}
                      {entry.followUpOpen ? " · open" : " · done"}
                      {entry.followUpTaskId && entry.followUpOpen && (
                        <>
                          {" · "}
                          <Link to={`/tasks/${entry.followUpTaskId}`}>View task</Link>
                        </>
                      )}
                    </small>
                  </p>
                )}
              </li>
            ))}
          </ul>
          <LoadMore list={entries} label="Load more entries" />
        </>
      )}
    </Section>
  );
}
