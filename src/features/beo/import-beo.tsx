import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { FlowEvent } from "../../../shared/core-records";
import {
  beoImportSummaryKeys,
  beoImportSummaryLabels,
  eventFromSummary,
  extractBeo,
  importedNotes,
  type BeoImportDraft,
  type BeoImportResult,
} from "../../../shared/beo-import";
import { beoApi } from "../../services/beo";
import { uploadDocument } from "../../services/documents";
import { Button, FormDrawer, FormField } from "../../components/shared";
import { RoundCheck } from "../../components/ui/round-check";
import { Allowed } from "../../app/permissions";
import { LabelT, T } from "../../app/copy";
import { EventPicker } from "../events/event-picker";
import { readBeoFile } from "./beo-import-read";

// Import BEO (FLOW-338) on the BEOs tab and an event's BEO page: pick the event
// (or, for an event not in Flowbase yet, create it from the file, Q4) and a Word
// or PDF BEO (Q3). The file is read here, in the browser, and a review shows each
// value with where it goes; any can be fixed or skipped, and text that fits no
// section is listed. Nothing is saved until Import BEO; Cancel saves nothing.
// Then the BEO is saved (Q1: BEO-only), the file stored in Documents as the
// event's BEO, and the BEO page opens.
export function ImportBeoButton({ event, onImported }: { event?: FlowEvent; onImported?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Allowed action="events.write">
      <Button variant="outline" onClick={() => setOpen(true)}><T id="beo.import.button">Import BEO</T></Button>
      {open && <ImportBeoDrawer event={event} onImported={onImported} onClose={() => setOpen(false)} />}
    </Allowed>
  );
}

type Row = { include: boolean; time: string; cue: string; notes: string };
type Review = {
  file: File;
  summary: Record<string, { include: boolean; value: string }>;
  durations: string;
  menu: string;
  drinks: string;
  staff: string;
  setup: string;
  other: string;
  unrecognized: string;
  schedule: Row[];
};

const joined = (values: string[]) => values.join("\n");
const split = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);

function reviewOf(file: File, draft: BeoImportDraft): Review {
  return {
    file,
    summary: Object.fromEntries(beoImportSummaryKeys.map((key) => [key, { include: Boolean(draft.summary[key]), value: draft.summary[key] ?? "" }])),
    durations: joined(draft.durations),
    menu: joined(draft.menu),
    drinks: joined(draft.drinks),
    staff: joined(draft.staff),
    setup: joined(draft.setup),
    other: draft.other.map((section) => [section.heading, ...section.lines].join("\n")).join("\n\n"),
    unrecognized: joined(draft.unrecognized),
    schedule: draft.schedule.map((row) => ({ include: true, time: row.time, cue: row.cue, notes: row.notes })),
  };
}

// The reviewed values back as a draft, for the notes text.
function draftOf(review: Review): BeoImportDraft {
  return {
    summary: Object.fromEntries(Object.entries(review.summary).filter(([, field]) => field.include && field.value.trim())
      .map(([key, field]) => [key, field.value.trim()])),
    durations: split(review.durations),
    menu: split(review.menu),
    drinks: split(review.drinks),
    staff: split(review.staff),
    schedule: [],
    setup: split(review.setup),
    other: review.other.trim() ? [{ heading: "Further sections", lines: split(review.other) }] : [],
    unrecognized: split(review.unrecognized),
  };
}

export function ImportBeoDrawer({ event: fixed, onImported, onClose }: { event?: FlowEvent; onImported?: () => void; onClose: () => void }) {
  const navigate = useNavigate();
  const [event, setEvent] = useState<FlowEvent | null>(fixed ?? null);
  const [createEvent, setCreateEvent] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [newEvent, setNewEvent] = useState({ title: "", date: "", startTime: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<BeoImportResult | null>(null);

  const read = async () => {
    if (!createEvent && !event) return setError("Choose the event, or create one from the file.");
    if (!file) return setError("Choose a Word (.docx) or PDF file.");
    setBusy(true);
    setError("");
    try {
      const draft = extractBeo(await readBeoFile(file));
      const fromFile = eventFromSummary(draft);
      setNewEvent({ title: fromFile.title, date: fromFile.date, startTime: draft.schedule[0]?.time ?? "" });
      setReview(reviewOf(file, draft));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!review) return;
    if (createEvent && (!newEvent.title.trim() || !newEvent.date || !newEvent.startTime))
      return setError("The new event needs a title, date and start time.");
    setBusy(true);
    setError("");
    const draft = draftOf(review);
    const fromFile = eventFromSummary(draft);
    let result: BeoImportResult;
    try {
      result = await beoApi.importFile({
        ...(createEvent
          ? { newEvent: { ...newEvent, title: newEvent.title.trim(), guestCount: fromFile.guestCount, address: fromFile.address, eventType: fromFile.eventType } }
          : { eventId: event!.id }),
        runOfShow: review.schedule.filter((row) => row.include && row.time && row.cue.trim())
          .map((row) => ({ time: row.time, cue: row.cue.trim().slice(0, 300), owner: "", notes: row.notes.trim().slice(0, 1000) })),
        setupDetails: draft.setup.join("\n"),
        additionalNotes: importedNotes(draft),
        fileName: review.file.name.slice(0, 200),
      });
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
      return;
    }
    // The BEO page this was opened on shows the imported values.
    onImported?.();
    const title = createEvent ? newEvent.title.trim() : event!.title;
    try {
      await uploadDocument(review.file, { name: `BEO - ${title}`.slice(0, 200), docType: "beo", recordType: "event", recordId: result.eventId });
      navigate(`/events/${result.eventId}/beo/${result.beoId}`);
      onClose();
    } catch (cause) {
      setSaved(result);
      setError(`The BEO was saved, but the file wasn't stored in Documents: ${(cause as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  if (saved)
    return (
      <FormDrawer onClose={onClose} title={<T id="beo.import.title">Import BEO</T>}
        onSubmit={() => { navigate(`/events/${saved.eventId}/beo/${saved.beoId}`); onClose(); }}
        error={error} saveLabel={<T id="beo.import.open-beo">Open BEO</T>} cancelLabel={<T id="beo.import.close">Close</T>}>
        <p><T id="beo.import.saved">The BEO was saved. Upload the file on the event to keep it in Documents.</T></p>
      </FormDrawer>
    );

  if (!review)
    return (
      <FormDrawer
        onClose={onClose}
        title={<T id="beo.import.title">Import BEO</T>}
        description={<T id="beo.import.description">A Word (.docx) or PDF BEO in the company template. You review what was read before anything is saved.</T>}
        onSubmit={read}
        error={error}
        saving={busy}
        saveLabel={<T id="beo.import.read">Read file</T>}
        cancelLabel={<T id="beo.import.cancel">Cancel</T>}
      >
        {!fixed && (
          <label className="round-check-label">
            <RoundCheck checked={createEvent} onChange={(e) => setCreateEvent(e.target.checked)} />
            <T id="beo.import.create-event">{"The event isn't in Flowbase yet: create it from the file"}</T>
          </label>
        )}
        {!fixed && !createEvent && <EventPicker value={event} onChange={setEvent} />}
        {fixed && <p><T id="beo.import.for-event" values={{ title: fixed.title }}>{"For {title}"}</T></p>}
        <FormField label={<T id="beo.import.file">BEO file *</T>}>
          <input aria-label="BEO file" type="file" accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </FormField>
      </FormDrawer>
    );

  const set = (patch: Partial<Review>) => setReview({ ...review, ...patch });
  const area = (key: "durations" | "menu" | "drinks" | "staff" | "setup" | "other" | "unrecognized", label: ReactNode, goesTo: ReactNode) => (
    <FormField label={label} hint={goesTo}>
      <textarea aria-label={key} rows={Math.min(10, Math.max(2, review[key].split("\n").length))} value={review[key]}
        onChange={(e) => set({ [key]: e.target.value })} />
    </FormField>
  );
  const notes = <T id="beo.import.goes-to-notes">Goes to: BEO additional notes</T>;
  return (
    <FormDrawer
      onClose={onClose}
      wide
      title={<T id="beo.import.review-title">Review the import</T>}
      description={<T id="beo.import.review-description" values={{ file: review.file.name }}>{"Read from {file}. Fix or skip anything before importing; nothing is saved until then."}</T>}
      onSubmit={confirm}
      error={error}
      saving={busy}
      saveLabel={<T id="beo.import.confirm">Import BEO</T>}
      cancelLabel={<T id="beo.import.cancel">Cancel</T>}
    >
      {createEvent && (
        <section aria-label="New event">
          <h3><T id="beo.import.new-event">New event</T></h3>
          <div className="form-grid">
            <FormField label={<T id="beo.import.event-title">Event title *</T>}>
              <input aria-label="Event title" value={newEvent.title} maxLength={200} onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })} />
            </FormField>
            <FormField label={<T id="beo.import.event-date">Date *</T>}>
              <input aria-label="Event date" type="date" value={newEvent.date} onChange={(e) => setNewEvent({ ...newEvent, date: e.target.value })} />
            </FormField>
            <FormField label={<T id="beo.import.event-start">Start time *</T>}>
              <input aria-label="Event start time" type="time" value={newEvent.startTime} onChange={(e) => setNewEvent({ ...newEvent, startTime: e.target.value })} />
            </FormField>
          </div>
        </section>
      )}
      <section aria-label="Event summary">
        <h3><T id="beo.import.summary">Event summary</T></h3>
        <p className="muted">{notes}</p>
        {beoImportSummaryKeys.map((key) => (
          <div key={key} className="form-grid">
            <label className="round-check-label">
              <RoundCheck checked={review.summary[key].include} aria-label={`Include ${beoImportSummaryLabels[key]}`}
                onChange={(e) => set({ summary: { ...review.summary, [key]: { ...review.summary[key], include: e.target.checked } } })} />
              <LabelT id="labels.beo-import-summary" value={key}>{beoImportSummaryLabels[key]}</LabelT>
            </label>
            <input aria-label={beoImportSummaryLabels[key]} value={review.summary[key].value}
              onChange={(e) => set({ summary: { ...review.summary, [key]: { include: true, value: e.target.value } } })} />
          </div>
        ))}
        {area("durations", <T id="beo.import.duration">Duration</T>, notes)}
      </section>
      {area("menu", <T id="beo.import.menu">Menu</T>, notes)}
      {area("drinks", <T id="beo.import.drinks">Drinks</T>, notes)}
      {area("staff", <T id="beo.import.staff">Staff</T>, notes)}
      <section aria-label="Schedule">
        <h3><T id="beo.import.schedule">Schedule</T></h3>
        <p className="muted"><T id="beo.import.goes-to-run-of-show">Goes to: the run of show (switched on), in place of its rows.</T></p>
        {review.schedule.length === 0 && <p className="muted"><T id="beo.import.no-schedule">No timed schedule lines were found.</T></p>}
        {review.schedule.map((row, index) => {
          const change = (patch: Partial<Row>) =>
            set({ schedule: review.schedule.map((item, i) => (i === index ? { ...item, ...patch } : item)) });
          return (
            <div key={index} className="form-grid">
              <RoundCheck checked={row.include} aria-label={`Include ${row.cue}`} onChange={(e) => change({ include: e.target.checked })} />
              <input aria-label={`Time ${index + 1}`} type="time" value={row.time} onChange={(e) => change({ time: e.target.value })} />
              <input aria-label={`Cue ${index + 1}`} value={row.cue} maxLength={300} onChange={(e) => change({ cue: e.target.value })} />
              <input aria-label={`Notes ${index + 1}`} value={row.notes} maxLength={1000} onChange={(e) => change({ notes: e.target.value })} />
            </div>
          );
        })}
      </section>
      {area("setup", <T id="beo.import.setup">Setup and decor</T>, <T id="beo.import.goes-to-setup">Goes to: BEO setup details</T>)}
      {area("other", <T id="beo.import.other">Further sections</T>, notes)}
      {review.unrecognized.trim() ? (
        area("unrecognized", <T id="beo.import.unrecognized">Not recognized</T>, <T id="beo.import.unrecognized-hint">{"Kept, not lost: goes to the BEO's additional notes."}</T>)
      ) : (
        <p className="muted"><T id="beo.import.all-recognized">Everything in the file was recognized.</T></p>
      )}
    </FormDrawer>
  );
}
