import { useRef, useState, lazy, Suspense } from "react";
import { Camera, Plus, Trash2, Upload } from "lucide-react";
import type { FlowEvent } from "../../shared/core-records";
import { ANNOTATED_GROUP, areaPhotoGroups, type BeoArea, type BeoAreaKind, type BeoView } from "../../shared/beo";
import type { Attachment } from "../../shared/attachments";
import { useResource } from "../app/useResource";
import { Button } from "../components/shared";
import { attachmentsApi, uploadAttachment } from "../services/attachments";
import { beoApi } from "../services/beo";
import { eventsApi } from "../services/core";

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
}: {
  areaId: string;
  groups: Group[];
  canEdit: boolean;
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
        // A group with nothing in it and nobody to add to it takes no room.
        if (!shown.length && (!canEdit || readOnly)) return null;
        return (
          <div key={group} className="beo-photo-group" data-group={group}>
            <h5>{label}</h5>
            <ul className="attachment-grid">
              {shown.map((file) => (
                <li key={file.id}>
                  <a href={file.urls.display} target="_blank" rel="noreferrer">
                    <img src={file.urls.display ?? file.urls.thumb} alt={file.caption || `${label}: ${file.fileName}`} />
                  </a>
                  {canEdit && !readOnly && (
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
            {canEdit && !readOnly && (
              <Button asChild variant="outline">
                <label className="beo-photo-add">
                  {camera ? <Camera size={14} /> : <Upload size={14} />}
                  {busy === group ? "Uploading…" : camera ? "Take or add photo" : "Add image"}
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
        Copy the venue's areas
      </Button>
      {(others.data ?? []).length > 0 && (
        <>
          <label className="form-field">
            <span>Past event at this venue</span>
            <select value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">Choose an event</option>
              {(others.data ?? []).map((row) => (
                <option key={row.id} value={row.id}>
                  {row.title} · {row.date}
                </option>
              ))}
            </select>
          </label>
          <Button variant="outline" disabled={!from} onClick={() => void run({ from: "event", eventId: from })}>
            Copy its layout
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
      {areas.length === 0 && <p className="muted">No {kind === "setup" ? "setup" : "layout"} areas yet.</p>}
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
                <span>Area name</span>
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required />
              </label>
              <label className="form-field">
                <span>Notes</span>
                <textarea value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
              </label>
              <Button type="submit">Save area</Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </form>
          ) : (
            <>
              <h4>{area.name}</h4>
              {area.notes ? <p>{area.notes}</p> : <p className="muted">No notes.</p>}
            </>
          )}
          <AreaPhotos areaId={area.id} groups={photoGroups(kind)} canEdit={canEdit} />
          {canEdit && editing?.id !== area.id && (
            <div className="beo-area-actions">
              <Button variant="outline" onClick={() => setEditing({ id: area.id, name: area.name, notes: area.notes })}>
                Edit {area.name}
              </Button>
              {kind === "layout" && (
                <Button variant="outline" onClick={() => setAnnotating(area)}>
                  {area.hasScene ? "Edit annotation" : "Annotate"}
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
        <Suspense fallback={<p className="muted">Loading the drawing tool…</p>}>
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
            <span>New {kind === "setup" ? "setup" : "layout"} area</span>
            <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="e.g. Inside Tent" />
          </label>
          <Button type="submit" variant="outline" disabled={!adding.trim()}>
            <Plus size={14} />
            Add area
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
      <h4>Cleanup and breakdown checklist</h4>
      {sections.length === 0 && <p className="muted">No checklist yet.</p>}
      {!draft &&
        sections.map((section) => (
          <fieldset key={section.section} className="beo-cleanup-section">
            <legend>{section.section}</legend>
            <ul className="beo-list">
              {section.items.map((item) => (
                <li key={item.id}>
                  <label className="beo-check">
                    <input
                      type="checkbox"
                      checked={item.checkedAt !== null}
                      disabled={!data.canCheckOff}
                      onChange={(e) => void run(() => beoApi.checkItem(eventId, item.id, e.target.checked))}
                    />
                    <span>{item.label}</span>
                  </label>
                  {item.checkedAt && (
                    <small>
                      {item.checkedBy || "Someone"} · {when(item.checkedAt)}
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
                    <span>Section {i + 1}</span>
                    <input
                      value={section.section}
                      onChange={(e) => setDraft(draft.map((s, j) => (j === i ? { ...s, section: e.target.value } : s)))}
                    />
                  </label>
                  <label className="form-field">
                    <span>Items for section {i + 1} (one per line)</span>
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
                Add section
              </Button>
              <Button type="submit">Save checklist</Button>
              <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </form>
          ) : (
            <Button
              variant="outline"
              onClick={() =>
                setDraft(sections.map((s) => ({ section: s.section, items: s.items.map((i) => i.label).join("\n") })))
              }
            >
              Edit checklist
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
