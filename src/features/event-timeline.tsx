import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { FlowEvent } from "../../shared/core-records";
import {
  timelineKindLabels,
  timelineKinds,
  timelineWhoLabel,
  type EventTimeline,
  type TimelineEntry,
  type TimelineEntryInput,
  type TimelineSuggestion,
  type TimelineWhoInput,
} from "../../shared/event-timeline";
import { useResource } from "../app/useResource";
import {
  Button,
  DetailDrawer,
  FormField,
  LoadingSkeleton,
  Section,
} from "../components/shared";
import { LoadError } from "../components/record-display";
import { eventTimelineApi } from "../services/event-timeline";
import { staffApi } from "../services/staff";
import { vendorsApi } from "../services/vendors";
import { date, time } from "./event-format";
import { ListSelect } from "./list-fields";
import "./event-timeline.css";

// The event timeline and production schedule (FLOW-126): every day the event
// involves in date order, each with the staff shifts that happen that day and the
// timeline entries in start order. "Who" can be a staff member, a role or an
// outside event partner from the vendor directory.

type Draft = {
  kind: TimelineEntryInput["kind"];
  date: string;
  startTime: string;
  endTime: string;
  activity: string;
  whoType: "" | "staff" | "role" | "vendor";
  whoValue: string;
  where: string;
  source: TimelineEntryInput["source"];
};

const whoOf = (draft: Draft): TimelineWhoInput | null => {
  if (!draft.whoType || !draft.whoValue) return null;
  if (draft.whoType === "staff") return { type: "staff", userId: draft.whoValue };
  if (draft.whoType === "role") return { type: "role", label: draft.whoValue };
  return { type: "vendor", vendorId: draft.whoValue };
};

const draftOf = (
  event: FlowEvent,
  entry?: TimelineEntry,
  suggestion?: TimelineSuggestion,
): Draft => ({
  kind: entry?.kind ?? "event",
  date: entry?.date ?? event.date,
  startTime: entry?.startTime ?? suggestion?.startTime ?? "",
  endTime: entry?.endTime ?? suggestion?.endTime ?? "",
  activity: entry?.activity ?? suggestion?.activity ?? "",
  whoType: entry?.who?.type ?? "",
  whoValue:
    entry?.who?.type === "role" ? entry.who.label : (entry?.who?.id ?? ""),
  where: entry?.where ?? "",
  source: suggestion
    ? { proposalId: suggestion.proposalId, sourceKey: suggestion.sourceKey }
    : null,
});

export function EventTimelineSection({ event }: { event: FlowEvent }) {
  const timeline = useResource(["event-timeline", event.id], () =>
    eventTimelineApi.get(event.id),
  );
  const [error, setError] = useState("");
  const [form, setForm] = useState<
    { entry?: TimelineEntry; suggestion?: TimelineSuggestion } | null
  >(null);
  if (timeline.error)
    return (
      <Section title="Timeline">
        <LoadError message={timeline.error} />
      </Section>
    );
  if (!timeline.data) return <LoadingSkeleton />;
  const data = timeline.data;
  const change = async (run: () => Promise<EventTimeline>) => {
    setError("");
    try {
      timeline.replace(await run());
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Section
      title="Timeline"
      action={
        data.canEdit && (
          <Button variant="outline" onClick={() => setForm({})}>
            <Plus size={14} />
            Add entry
          </Button>
        )
      }
    >
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {data.suggestions.length > 0 && data.canEdit && (
        <div className="timeline-suggestions">
          <strong>From the proposal</strong>
          <ul>
            {data.suggestions.map((s) => (
              <li key={`${s.proposalId}:${s.sourceKey}`}>
                <span>
                  {s.text} <small>({s.proposalTitle})</small>
                </span>
                <Button variant="outline" onClick={() => setForm({ suggestion: s })}>
                  Add
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.days.map((day) => (
        <div key={day.date} className="timeline-day">
          <h3>
            {date(day.date)}
            {day.isEventDay && <small> · Event day</small>}
          </h3>
          {day.shifts.map((shift) => (
            <p key={shift.id} className="timeline-shift">
              Staff shift {time(shift.startTime)}–{time(shift.endTime)}
              {shift.activities && `: ${shift.activities}`} ({shift.filled}/
              {shift.slots} filled)
            </p>
          ))}
          {day.entries.length === 0 ? (
            <p className="muted">No timeline entries.</p>
          ) : (
            <ul className="timeline-entries">
              {day.entries.map((entry) => (
                <li key={entry.id}>
                  <span className="timeline-time">
                    {time(entry.startTime)}–{time(entry.endTime)}
                  </span>
                  <span className="timeline-activity">
                    {entry.activity}
                    <small>
                      {[
                        timelineKindLabels[entry.kind],
                        timelineWhoLabel(entry.who),
                        entry.where,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </span>
                  {data.canEdit && (
                    <span className="timeline-actions">
                      <Button
                        variant="ghost"
                        aria-label={`Edit ${entry.activity}`}
                        onClick={() => setForm({ entry })}
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        aria-label={`Remove ${entry.activity}`}
                        onClick={() =>
                          change(() => eventTimelineApi.archive(event.id, entry.id))
                        }
                      >
                        <Trash2 size={14} />
                      </Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {form && (
        <EntryForm
          event={event}
          areas={data.areas}
          entry={form.entry}
          suggestion={form.suggestion}
          onClose={() => setForm(null)}
          onSave={async (input) => {
            const next = form.entry
              ? await eventTimelineApi.update(event.id, form.entry.id, input)
              : await eventTimelineApi.add(event.id, input);
            timeline.replace(next);
            setForm(null);
          }}
        />
      )}
    </Section>
  );
}

function EntryForm({
  event,
  areas,
  entry,
  suggestion,
  onClose,
  onSave,
}: {
  event: FlowEvent;
  areas: string[];
  entry?: TimelineEntry;
  suggestion?: TimelineSuggestion;
  onClose: () => void;
  onSave: (input: TimelineEntryInput) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => draftOf(event, entry, suggestion));
  const [error, setError] = useState("");
  const staff = useResource(["staff"], () => staffApi.list());
  const partners = useResource(["vendors", "event_partner"], () =>
    vendorsApi.list({ type: "event_partner" }).then((page) => page.rows),
  );
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const people = (staff.data ?? []).filter(
    (m) =>
      m.active ||
      (entry?.who?.type === "staff" && entry.who.id === m.id),
  );
  return (
    <DetailDrawer
      open
      onClose={onClose}
      title={entry ? "Edit timeline entry" : "Add timeline entry"}
      description="Times are New York time. An end time before the start runs past midnight."
    >
      <form
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (!draft.date || !draft.startTime || !draft.endTime)
            return setError("Date, start and end time are required.");
          if (!draft.activity.trim()) return setError("Describe the activity.");
          try {
            setError("");
            await onSave({
              kind: draft.kind,
              date: draft.date,
              startTime: draft.startTime,
              endTime: draft.endTime,
              activity: draft.activity.trim(),
              who: whoOf(draft),
              where: draft.where,
              source: draft.source,
            });
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <div className="form-grid">
          <FormField label="Kind">
            <select
              value={draft.kind}
              onChange={(e) =>
                set("kind", e.target.value as Draft["kind"])
              }
            >
              {timelineKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {timelineKindLabels[kind]}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Date">
            <input
              type="date"
              value={draft.date}
              onChange={(e) => set("date", e.target.value)}
            />
          </FormField>
          <FormField label="Start time">
            <input
              type="time"
              value={draft.startTime}
              onChange={(e) => set("startTime", e.target.value)}
            />
          </FormField>
          <FormField label="End time">
            <input
              type="time"
              value={draft.endTime}
              onChange={(e) => set("endTime", e.target.value)}
            />
          </FormField>
        </div>
        <FormField label="Activity">
          <input
            value={draft.activity}
            maxLength={500}
            onChange={(e) => set("activity", e.target.value)}
          />
        </FormField>
        <div className="form-grid">
          <FormField label="Who">
            <select
              value={draft.whoType}
              onChange={(e) => {
                set("whoType", e.target.value as Draft["whoType"]);
                set("whoValue", "");
              }}
            >
              <option value="">Nobody</option>
              <option value="staff">Staff member</option>
              <option value="role">Role</option>
              <option value="vendor">Event partner</option>
            </select>
          </FormField>
          {draft.whoType === "staff" && (
            <FormField label="Staff member">
              <select
                value={draft.whoValue}
                onChange={(e) => set("whoValue", e.target.value)}
              >
                <option value="">Choose a person</option>
                {people.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </FormField>
          )}
          {draft.whoType === "role" && (
            <FormField label="Role">
              <ListSelect
                list="staff_position"
                label="Role"
                empty="Choose a role"
                value={draft.whoValue}
                onChange={(value) => set("whoValue", value)}
              />
            </FormField>
          )}
          {draft.whoType === "vendor" && (
            <FormField label="Event partner">
              <select
                value={draft.whoValue}
                onChange={(e) => set("whoValue", e.target.value)}
              >
                <option value="">Choose a partner</option>
                {(partners.data ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </FormField>
          )}
          <FormField label="Where">
            <select
              value={draft.where}
              onChange={(e) => set("where", e.target.value)}
            >
              <option value="">—</option>
              {[...new Set([...areas, ...(draft.where ? [draft.where] : [])])].map(
                (area) => (
                  <option key={area} value={area}>
                    {area}
                  </option>
                ),
              )}
            </select>
          </FormField>
        </div>
        <div className="form-actions">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Save</Button>
        </div>
      </form>
    </DetailDrawer>
  );
}
