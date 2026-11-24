import { Dropdown } from "../../components/ui/Dropdown";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  communicationKindLabels,
  communicationKindSchema,
  type CommunicationKind,
} from "../../../shared/communications";
import { communicationsApi, type CommunicationTarget } from "../../services/communications";
import { LoadMore, usePagedList } from "../../app/paging";
import { Button, FormField, LoadingSkeleton, Section, ErrorText } from "../../components/shared";
import { T, LabelT } from "../../app/copy";
import "../leads/leads.css";

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
    <Section title={<T id="communications.communication-log.communication-log">Communication log</T>}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <ErrorText message={error} />
        <div className="form-grid">
          <FormField label={<T id="communications.communication-log.type">Type</T>}>
            <Dropdown
              value={kind}
              onChange={(e) => setKind(e.target.value as CommunicationKind)}
            >
              {communicationKindSchema.options.map((option) => (
                <option key={option} value={option}>
                  {communicationKindLabels[option]}
                </option>
              ))}
            </Dropdown>
          </FormField>
          <FormField label={<T id="communications.communication-log.next-follow-up">Next follow-up</T>}>
            <input
              type="date"
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
            />
          </FormField>
        </div>
        <FormField label={<T id="communications.communication-log.summary">Summary *</T>}>
          <textarea
            rows={3}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </FormField>
        <Button type="submit" disabled={saving}>
          <T id="communications.communication-log.log-conversation">Log conversation</T>
        </Button>
      </form>
      {entries.error ? (
        <ErrorText message={entries.error} />
      ) : !entries.data ? (
        <LoadingSkeleton />
      ) : entries.data.length === 0 ? (
        <p className="muted"><T id="communications.communication-log.nothing-logged-yet">Nothing logged yet.</T></p>
      ) : (
        <>
          <ul className="communication-log">
            {entries.data.map((entry) => (
              <li key={entry.id}>
                <p>
                  <strong><LabelT id="labels.communication-kind" value={entry.kind}>{communicationKindLabels[entry.kind]}</LabelT></strong>{" "}
                  <small>
                    {when(entry.occurredAt)}
                    {entry.loggedByName ? ` · ${entry.loggedByName}` : ""}
                  </small>
                </p>
                <p>{entry.summary}</p>
                {entry.followUpDate && (
                  <p>
                    <small>
                      {entry.followUpOpen ? <T id="communications.communication-log.follow-up-open" values={{ day: day(entry.followUpDate) }}>{"Follow-up {day} · open"}</T> : <T id="communications.communication-log.follow-up-done" values={{ day: day(entry.followUpDate) }}>{"Follow-up {day} · done"}</T>}
                      {entry.followUpTaskId && entry.followUpOpen && (
                        <>
                          {" · "}
                          <Link to={`/tasks/${entry.followUpTaskId}`}><T id="communications.communication-log.view-task">View task</T></Link>
                        </>
                      )}
                    </small>
                  </p>
                )}
              </li>
            ))}
          </ul>
          <LoadMore list={entries} label={<T id="communications.communication-log.load-more-entries">Load more entries</T>} />
        </>
      )}
    </Section>
  );
}
