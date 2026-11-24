import { Dropdown } from "../../components/ui/Dropdown";
import { useRef, useState, lazy, Suspense } from "react";
import { Camera, Plus, Trash2, Upload } from "lucide-react";
import type { FlowEvent } from "../../../shared/core-records";
import { ANNOTATED_GROUP, areaPhotoGroups, type BeoArea, type BeoAreaKind, type BeoView } from "../../../shared/beo";
import type { Attachment } from "../../../shared/attachments";
import { useResource } from "../../app/useResource";
import { Button } from "../../components/shared";
import { attachmentsApi, uploadAttachment } from "../../services/attachments";
import { beoApi } from "../../services/beo";
import { eventsApi } from "../../services/core";
import { RoundCheck } from "../../components/ui/round-check";
import { T, useCopy } from "../../app/copy";

// Setup areas (FLOW-146) and layout areas (FLOW-147) of the BEO: notes and photos
// for each area of the venue. Photos are attachments on the area (beo_area), so
// they use the same resizing, signed links and storage as every other file.

// Excalidraw loads only when someone annotates a layout (FLOW-147 AC3).
const LayoutEditor = lazy(() => import("./beo-layout-editor"));

type Group = { group: string; label: string; camera?: boolean; readOnly?: boolean };

const expiryOf = (list: Attachment[]) =>
  list
    .map((file) => file.urlsExpireAt)
    .filter((at): at is string => Boolean(at))
    .sort()[0];

export function AreaPhotos({
  areaId,
  groups,
  canEdit,
  canAddActual = false,
}: {
  areaId: string;
  groups: Group[];
  canEdit: boolean;
  // Whoever can open the event adds "actual" setup photos on the day (FLOW-237).
  canAddActual?: boolean;
}) {
  const files = useResource(["attachments", "beo_area", areaId], () => attachmentsApi.list("beo_area", areaId), {
    expiresAt: expiryOf,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const upload = async (group: string, picked: FileList | null) => {
    setError("");
    setBusy(group);
    try {
      for (const file of picked ?? [])
        await uploadAttachment(file, { recordType: "beo_area", recordId: areaId, group });
      files.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const remove = async (file: Attachment) => {
    try {
      await attachmentsApi.archive(file.id);
      files.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="beo-photos">
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {groups.map(({ group, label, camera, readOnly }) => {
        const shown = (files.data ?? []).filter((file) => file.group === group && file.kind === "photo");
        const editable = (canEdit && !readOnly) || (group === "actual" && canAddActual);
        // A group with nothing in it and nobody to add to it takes no room.
        if (!shown.length && !editable) return null;
        return (
          <div key={group} className="beo-photo-group" data-group={group}>
            <h5>{label}</h5>
            <ul className="attachment-grid">
              {shown.map((file) => (
                <li key={file.id}>
                  <a href={file.urls.display} target="_blank" rel="noreferrer">
                    <img src={file.urls.display ?? file.urls.thumb} alt={file.caption || `${label}: ${file.fileName}`} />
                  </a>
                  {editable && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${file.fileName}`}
                      onClick={() => void remove(file)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {editable && (
              <Button asChild variant="outline">
                <label className="beo-photo-add">
                  {camera ? <Camera size={14} /> : <Upload size={14} />}
                  {busy === group ? <T id="beo-areas.area-photos.uploading">Uploading…</T> : camera ? <T id="beo-areas.area-photos.take-or-add-photo">Take or add photo</T> : <T id="beo-areas.area-photos.add-image">Add image</T>}
                  {/* "capture" opens the camera on a phone and the file picker elsewhere. */}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic"
                    {...(camera ? { capture: "environment" as const } : { multiple: true })}
                    hidden
                    aria-label={`Add to ${label}`}
                    disabled={busy !== ""}
                    onChange={(e) => {
                      void upload(group, e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

const photoGroups = (kind: BeoAreaKind): Group[] =>
  kind === "setup"
    ? areaPhotoGroups.setup.map((g) => ({ ...g, camera: g.group === "actual" }))
    : [
        ...areaPhotoGroups.layout,
        { group: ANNOTATED_GROUP, label: "Annotated plan (shown on the BEO and print)", readOnly: true },
      ];

// Copy layout areas from the venue or from a past event at the same venue.
function CopyLayout({ event, onChange }: { event: FlowEvent; onChange: (view: BeoView) => void }) {
  const venueId = event.venue?.id;
  const others = useResource(
    ["venue-events", venueId ?? ""],
    async () => (venueId ? (await eventsApi.list({ venueId })).rows.filter((row) => row.id !== event.id) : []),
    { reference: true },
  );
  const [from, setFrom] = useState("");
  const [error, setError] = useState("");
  if (!venueId) return null;
  const run = async (input: Parameters<typeof beoApi.copyLayout>[1]) => {
    setError("");
    try {
      onChange(await beoApi.copyLayout(event.id, input));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="beo-copy">
      <Button variant="outline" onClick={() => void run({ from: "venue" })}>
        <T id="beo-areas.copy-layout.copy-the-venue-s-areas">{"Copy the venue's areas"}</T>
      </Button>
      {(others.data ?? []).length > 0 && (
        <>
          <label className="form-field">
            <span><T id="beo-areas.copy-layout.past-event-at-this-venue">Past event at this venue</T></span>
            <Dropdown value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">Choose an event</option>
              {(others.data ?? []).map((row) => (
                <option key={row.id} value={row.id}>
                  {row.title} · {row.date}
                </option>
              ))}
            </Dropdown>
          </label>
          <Button variant="outline" disabled={!from} onClick={() => void run({ from: "event", eventId: from })}>
            <T id="beo-areas.copy-layout.copy-its-layout">Copy its layout</T>
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </div>
  );
}

export function BeoAreaList({
  kind,
  event,
  data,
  areas,
  onChange,
}: {
  kind: BeoAreaKind;
  event: FlowEvent;
  data: BeoView;
  areas: BeoArea[];
  onChange: (view: BeoView) => void;
}) {
  const eGInsideTentPlaceholder = useCopy("beo-areas.beo-area-list.e-g-inside-tent.placeholder", "e.g. Inside Tent");
  const canEdit = data.exists && data.canEdit;
  const [adding, setAdding] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string; notes: string } | null>(null);
  const [annotating, setAnnotating] = useState<BeoArea | null>(null);
  const [error, setError] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const run = async (action: () => Promise<BeoView>) => {
    setError("");
    try {
      onChange(await action());
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  return (
    <div className="beo-areas" data-kind={kind}>
      {areas.length === 0 && <p className="muted">{kind === "setup" ? <T id="beo-areas.beo-area-list.no-setup-areas-yet">No setup areas yet.</T> : <T id="beo-areas.beo-area-list.no-layout-areas-yet">No layout areas yet.</T>}</p>}
      {areas.map((area) => (
        <article key={area.id} className="beo-area" data-testid={`beo-${kind}-area`}>
          {editing?.id === area.id ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => beoApi.updateArea(event.id, area.id, { name: editing.name, notes: editing.notes })).then(
                  (ok) => ok && setEditing(null),
                );
              }}
            >
              <label className="form-field">
                <span><T id="beo-areas.beo-area-list.area-name">Area name</T></span>
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required />
              </label>
              <label className="form-field">
                <span><T id="beo-areas.beo-area-list.notes">Notes</T></span>
                <textarea value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
              </label>
              <Button type="submit"><T id="beo-areas.beo-area-list.save-area">Save area</T></Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                <T id="beo-areas.beo-area-list.cancel">Cancel</T>
              </Button>
            </form>
          ) : (
            <>
              <h4>{area.name}</h4>
              {area.notes ? <p>{area.notes}</p> : <p className="muted"><T id="beo-areas.beo-area-list.no-notes">No notes.</T></p>}
            </>
          )}
          <AreaPhotos areaId={area.id} groups={photoGroups(kind)} canEdit={canEdit} canAddActual={data.canCheckOff && kind === "setup"} />
          {canEdit && editing?.id !== area.id && (
            <div className="beo-area-actions">
              <Button variant="outline" onClick={() => setEditing({ id: area.id, name: area.name, notes: area.notes })}>
                <T id="beo-areas.beo-area-list.edit" values={{ name: area.name }}>{"Edit {name}"}</T>
              </Button>
              {kind === "layout" && (
                <Button variant="outline" onClick={() => setAnnotating(area)}>
                  {area.hasScene ? <T id="beo-areas.beo-area-list.edit-annotation">Edit annotation</T> : <T id="beo-areas.beo-area-list.annotate">Annotate</T>}
                </Button>
              )}
              <Button
                variant="ghost"
                aria-label={`Remove ${area.name}`}
                onClick={() => void run(() => beoApi.archiveArea(event.id, area.id))}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          )}
        </article>
      ))}
      {annotating && (
        <Suspense fallback={<p className="muted"><T id="beo-areas.beo-area-list.loading-the-drawing-tool">Loading the drawing tool…</T></p>}>
          <LayoutEditor
            eventId={event.id}
            area={annotating}
            onSaved={(view) => {
              onChange(view);
              setAnnotating(null);
            }}
            onClose={() => setAnnotating(null)}
          />
        </Suspense>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {canEdit && (
        <form
          ref={form}
          className="beo-area-add"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => beoApi.createArea(event.id, { kind, name: adding })).then((ok) => ok && setAdding(""));
          }}
        >
          <label className="form-field">
            <span>{kind === "setup" ? <T id="beo-areas.beo-area-list.new-setup-area">New setup area</T> : <T id="beo-areas.beo-area-list.new-layout-area">New layout area</T>}</span>
            <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder={eGInsideTentPlaceholder} data-copy-id="beo-areas.beo-area-list.e-g-inside-tent.placeholder" />
          </label>
          <Button type="submit" variant="outline" disabled={!adding.trim()}>
            <Plus size={14} />
            <T id="beo-areas.beo-area-list.add-area">Add area</T>
          </Button>
        </form>
      )}
      {canEdit && kind === "layout" && <CopyLayout event={event} onChange={onChange} />}
    </div>
  );
}

// --- Cleanup checklist (FLOW-146) -----------------------------------------------

type DraftSection = { section: string; items: string };

export function BeoCleanup({
  eventId,
  data,
  onChange,
}: {
  eventId: string;
  data: BeoView;
  onChange: (view: BeoView) => void;
}) {
  const sections = data.content.setupCleanup.cleanup;
  const [draft, setDraft] = useState<DraftSection[] | null>(null);
  const [error, setError] = useState("");
  const run = async (action: () => Promise<BeoView>) => {
    setError("");
    try {
      onChange(await action());
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  const when = (iso: string) => new Date(iso).toLocaleString();
  return (
    <div className="beo-cleanup" data-testid="beo-cleanup">
      <h4><T id="beo-areas.beo-cleanup.cleanup-and-breakdown-checklist">Cleanup and breakdown checklist</T></h4>
      {sections.length === 0 && <p className="muted"><T id="beo-areas.beo-cleanup.no-checklist-yet">No checklist yet.</T></p>}
      {!draft &&
        sections.map((section) => (
          <fieldset key={section.section} className="beo-cleanup-section">
            <legend>{section.section}</legend>
            <ul className="beo-list">
              {section.items.map((item) => (
                <li key={item.id}>
                  <label className="beo-check">
                    <RoundCheck
                      checked={item.checkedAt !== null}
                      disabled={!data.canCheckOff}
                      onChange={(e) => void run(() => beoApi.checkItem(eventId, item.id, e.target.checked))}
                    />
                    <span>{item.label}</span>
                  </label>
                  {item.checkedAt && (
                    <small>
                      {item.checkedBy || <T id="beo-areas.beo-cleanup.someone">Someone</T>} · {when(item.checkedAt)}
                    </small>
                  )}
                </li>
              ))}
            </ul>
          </fieldset>
        ))}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {data.exists && data.canEdit && (
        <div className="beo-edit">
          {draft ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(() =>
                  beoApi.saveCleanup(eventId, {
                    sections: draft
                      .filter((section) => section.section.trim())
                      .map((section) => ({
                        section: section.section.trim(),
                        items: section.items
                          .split("\n")
                          .map((line) => line.trim())
                          .filter(Boolean),
                      })),
                  }),
                ).then((ok) => ok && setDraft(null));
              }}
            >
              {draft.map((section, i) => (
                <div key={i} className="beo-cleanup-edit">
                  <label className="form-field">
                    <span><T id="beo-areas.beo-cleanup.section" values={{ value: i + 1 }}>{"Section {value}"}</T></span>
                    <input
                      value={section.section}
                      onChange={(e) => setDraft(draft.map((s, j) => (j === i ? { ...s, section: e.target.value } : s)))}
                    />
                  </label>
                  <label className="form-field">
                    <span><T id="beo-areas.beo-cleanup.items-for-section-one-per" values={{ value: i + 1 }}>{"Items for section {value} (one per line)"}</T></span>
                    <textarea
                      value={section.items}
                      onChange={(e) => setDraft(draft.map((s, j) => (j === i ? { ...s, items: e.target.value } : s)))}
                    />
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Remove section ${i + 1}`}
                    onClick={() => setDraft(draft.filter((_, j) => j !== i))}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" onClick={() => setDraft([...draft, { section: "", items: "" }])}>
                <Plus size={14} />
                <T id="beo-areas.beo-cleanup.add-section">Add section</T>
              </Button>
              <Button type="submit"><T id="beo-areas.beo-cleanup.save-checklist">Save checklist</T></Button>
              <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
                <T id="beo-areas.beo-cleanup.cancel">Cancel</T>
              </Button>
            </form>
          ) : (
            <Button
              variant="outline"
              onClick={() =>
                setDraft(sections.map((s) => ({ section: s.section, items: s.items.map((i) => i.label).join("\n") })))
              }
            >
              <T id="beo-areas.beo-cleanup.edit-checklist">Edit checklist</T>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
