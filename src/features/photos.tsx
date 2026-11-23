import { useEffect, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Link } from "react-router-dom";
import { clsx } from "clsx";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Plus,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { Button, ConfirmationDialog, DetailDrawer, EmptyState, FilterBar, LoadingSkeleton, PageHeader } from "../components/shared";
import { Dropdown } from "../components/ui/Dropdown";
import { RoundCheck } from "../components/ui/round-check";
import { Plural, T, useCopy } from "../app/copy";
import { usePermissions } from "../app/permissions";
import { useResource } from "../app/useResource";
import { eventsApi } from "../services/core";
import { photosApi, saveBlob, uploadPhoto, zipPhotos } from "../services/photos";
import { useBusinessSettings } from "../services/settings";
import {
  filterPhotos,
  photoAreaActions,
  photoCaption,
  stepIndex,
  type Photo,
  type PhotoArea,
  type PhotoFilter,
} from "../../shared/photos";
import { utcToBusinessTime } from "../../shared/time";
import "./photos.css";

const UNDO_MS = 10_000;
const today = () => utcToBusinessTime(new Date()).date;
const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
const dateText = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const jpegName = (photo: Photo) => `${photo.fileName.replace(/\.[^.]+$/, "")}.jpg`;

// A photo gallery (FLOW-271): a grid of thumbnails, multi-select with a bulk
// bar, a lightbox and multi-file upload. Marketing adds its filters, approval
// and tags; Kitchen and Inventory (FLOW-298) add a label and date per photo and
// confirm every delete.
export function PhotoGallery({ area, title, subtitle }: { area: PhotoArea; title: ReactNode; subtitle: ReactNode }) {
  const { can } = usePermissions();
  const marketing = area === "marketing";
  const canWrite = can(photoAreaActions[area].write);
  const canApprove = marketing && can("marketing.write");
  const photos = useResource(["photos", area], () => photosApi.list(area), {
    // Signed links expire; the earliest decides when the list is renewed.
    expiresAt: (list) =>
      list
        .map((photo) => photo.urlsExpireAt)
        .filter((at): at is string => Boolean(at))
        .sort()[0],
  });
  const settings = useBusinessSettings();
  const [filter, setFilter] = useState<PhotoFilter>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [confirming, setConfirming] = useState<string[] | null>(null);
  const [undo, setUndo] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const all = photos.data ?? [];
  const shown = marketing ? filterPhotos(all, filter) : all;
  const picked = selected.filter((id) => shown.some((photo) => photo.id === id));
  const index = shown.findIndex((photo) => photo.id === openId);
  const current = index >= 0 ? shown[index] : undefined;
  const reload = () => photos.reload();

  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [undo]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  const approve = (ids: string[], approved: boolean) =>
    run(async () => {
      for (const id of ids) await photosApi.update(id, { approvedForMarketing: approved });
      reload();
    });
  const setTags = (photo: Photo, tags: string[]) =>
    run(async () => {
      await photosApi.update(photo.id, { tags });
      reload();
    });
  const download = (ids: string[]) =>
    run(async () => saveBlob(await zipPhotos(all.filter((photo) => ids.includes(photo.id))), "photos.zip"));
  const downloadOne = (photo: Photo) =>
    run(async () => {
      if (!photo.urls) return;
      const response = await fetch(photo.urls.display);
      if (!response.ok) throw new Error(`The photo couldn't be downloaded (${response.status}).`);
      saveBlob(await response.blob(), jpegName(photo));
    });
  const remove = (ids: string[]) =>
    run(async () => {
      const done: string[] = [];
      try {
        for (const id of ids) {
          await photosApi.archive(id);
          done.push(id);
        }
      } finally {
        if (done.length) {
          setSelected((now) => now.filter((id) => !done.includes(id)));
          setOpenId(null);
          // Marketing deletes with Undo (FLOW-260); the other galleries confirmed first.
          if (marketing) setUndo(done);
          reload();
        }
      }
    });
  const restore = (ids: string[]) =>
    run(async () => {
      setUndo(null);
      for (const id of ids) await photosApi.restore(id);
      reload();
    });
  // Kitchen and Inventory ask first (FLOW-298 AC3); the lightbox closes so the
  // question is the only dialog on screen.
  const askDelete = (ids: string[]) => {
    if (marketing) return void remove(ids);
    setOpenId(null);
    setConfirming(ids);
  };
  const toggle = (id: string) =>
    setSelected((now) => (now.includes(id) ? now.filter((entry) => entry !== id) : [...now, id]));
  const move = (step: 1 | -1) => {
    if (shown.length) setOpenId(shown[stepIndex(index, shown.length, step)].id);
  };
  const onLightboxKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("input, textarea, [role='combobox'], [role='listbox']")) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      move(-1);
    }
  };

  const events = [...new Map(all.filter((photo) => photo.eventId).map((photo) => [photo.eventId!, photo.eventTitle ?? photo.eventId!])).entries()];
  const uploaders = [...new Map(all.filter((photo) => photo.uploadedBy).map((photo) => [photo.uploadedBy!, photo.uploaderName ?? photo.uploadedBy!])).entries()];
  const tagList = (settings.lists.photo_tag ?? []).filter((value) => !value.archived).map((value) => value.label);

  return (
    <>
      <PageHeader title={title} subtitle={subtitle}>
        {canWrite && (
          <Button onClick={() => setUploadOpen(true)}>
            <Plus size={16} />
            <T id="photos.gallery.upload-photos">Upload photos</T>
          </Button>
        )}
      </PageHeader>
      {marketing && (
        <FilterBar>
          <Dropdown aria-label="Event" value={filter.eventId ?? ""} onValueChange={(value) => setFilter({ ...filter, eventId: value || undefined })}>
            <option value="">Any event</option>
            {events.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </Dropdown>
          <Dropdown aria-label="Tag" value={filter.tag ?? ""} onValueChange={(value) => setFilter({ ...filter, tag: value || undefined })}>
            <option value="">Any tag</option>
            {tagList.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
          </Dropdown>
          <Dropdown aria-label="Uploaded by" value={filter.uploadedBy ?? ""} onValueChange={(value) => setFilter({ ...filter, uploadedBy: value || undefined })}>
            <option value="">Anyone</option>
            {uploaders.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </Dropdown>
          <label className="photo-filter-check">
            <RoundCheck checked={Boolean(filter.approvedOnly)} onChange={(event) => setFilter({ ...filter, approvedOnly: event.target.checked })} />
            <T id="photos.gallery.approved-for-marketing-only">Approved for marketing only</T>
          </label>
        </FilterBar>
      )}
      {error && <p role="alert" className="error-message">{error}</p>}
      {photos.error && <p role="alert" className="error-message">{photos.error}</p>}
      {picked.length > 0 && (
        <div className="bulk-bar" role="region" aria-label="Selected photos">
          <strong>
            <Plural id="photos.gallery.selected" count={picked.length} one="{count} selected" other="{count} selected" />
          </strong>
          {canApprove && (
            <Button variant="outline" disabled={busy} onClick={() => void approve(picked, true)}>
              <CheckCircle2 size={14} />
              <T id="photos.gallery.approve-for-marketing">Approve for marketing</T>
            </Button>
          )}
          <Button variant="outline" disabled={busy} onClick={() => void download(picked)}>
            <Download size={14} />
            <T id="photos.gallery.download-zip">Download (.zip)</T>
          </Button>
          {canWrite && (
            <Button variant="destructive" disabled={busy} onClick={() => askDelete(picked)}>
              <Trash2 size={14} />
              <T id="photos.gallery.delete">Delete</T>
            </Button>
          )}
          <Button variant="ghost" onClick={() => setSelected([])}>
            <X size={14} />
            <T id="photos.gallery.clear">Clear</T>
          </Button>
        </div>
      )}
      {photos.loading && !photos.data ? (
        <LoadingSkeleton />
      ) : shown.length === 0 ? (
        <section className="panel">
          <EmptyState
            title={<T id="photos.gallery.no-photos">No photos yet</T>}
            description={<T id="photos.gallery.no-photos-description">Uploaded photos show here.</T>}
          />
        </section>
      ) : (
        <ul className="photo-grid" aria-label="Photos">
          {shown.map((photo) => (
            <li key={photo.id} className={clsx("photo-tile", selected.includes(photo.id) && "is-selected")}>
              <button type="button" className="photo-tile__open" aria-label={`Open ${photo.title}`} onClick={() => setOpenId(photo.id)}>
                {photo.urls ? (
                  <img src={photo.urls.thumb} alt={photo.title} loading="lazy" />
                ) : (
                  <span className="photo-tile__missing"><ImageIcon size={28} /></span>
                )}
              </button>
              <RoundCheck
                className="photo-tile__check"
                aria-label={`Select ${photo.title}`}
                checked={selected.includes(photo.id)}
                onChange={() => toggle(photo.id)}
              />
              {photo.approvedForMarketing && (
                <span className="badge photo-tile__approved">
                  <T id="photos.gallery.approved">Approved</T>
                </span>
              )}
              <strong className="photo-tile__title">{photo.title}</strong>
              <span className="photo-tile__meta">{marketing ? photoCaption(photo) : dateText(photo.date)}</span>
            </li>
          ))}
        </ul>
      )}
      <Dialog.Root open={Boolean(current)} onOpenChange={(open) => !open && setOpenId(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          {current && (
            <Dialog.Content className="photo-lightbox" aria-describedby={undefined} onKeyDown={onLightboxKey}>
              <div className="photo-lightbox__head">
                <div>
                  <Dialog.Title className="photo-lightbox__title">{current.title}</Dialog.Title>
                  <p className="photo-lightbox__meta">{marketing ? photoCaption(current) : dateText(current.date)}</p>
                </div>
                <Dialog.Close asChild>
                  <Button variant="ghost" aria-label="Close">
                    <X size={16} />
                  </Button>
                </Dialog.Close>
              </div>
              <div className="photo-lightbox__stage">
                <Button variant="outline" aria-label="Previous photo" onClick={() => move(-1)}>
                  <ChevronLeft size={18} />
                </Button>
                {current.urls ? (
                  <img src={current.urls.display} alt={current.title} />
                ) : (
                  <p><T id="photos.lightbox.unavailable">This photo can't be shown right now.</T></p>
                )}
                <Button variant="outline" aria-label="Next photo" onClick={() => move(1)}>
                  <ChevronRight size={18} />
                </Button>
              </div>
              <div className="photo-lightbox__actions">
                {canApprove &&
                  (current.approvedForMarketing ? (
                    <Button variant="outline" disabled={busy} onClick={() => void approve([current.id], false)}>
                      <Undo2 size={14} />
                      <T id="photos.lightbox.remove-approval">Remove approval</T>
                    </Button>
                  ) : (
                    <Button disabled={busy} onClick={() => void approve([current.id], true)}>
                      <CheckCircle2 size={14} />
                      <T id="photos.lightbox.approve">Approve</T>
                    </Button>
                  ))}
                <Button variant="outline" disabled={busy || !current.urls} onClick={() => void downloadOne(current)}>
                  <Download size={14} />
                  <T id="photos.lightbox.download">Download</T>
                </Button>
                <Button variant="outline" asChild>
                  <Link to={`/documents?document=${current.id}`}>
                    <ExternalLink size={14} />
                    <T id="photos.lightbox.open-in-documents">Open in Documents</T>
                  </Link>
                </Button>
                {canWrite && (
                  <Button variant="destructive" disabled={busy} onClick={() => askDelete([current.id])}>
                    <Trash2 size={14} />
                    <T id="photos.lightbox.delete">Delete</T>
                  </Button>
                )}
              </div>
              {canApprove && tagList.length > 0 && (
                <div className="photo-lightbox__tags" role="group" aria-label="Tags">
                  {[...new Set([...tagList, ...current.tags])].map((tag) => {
                    const on = current.tags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        className={clsx("photo-tag", on && "is-on")}
                        aria-pressed={on}
                        disabled={busy}
                        onClick={() => void setTags(current, on ? current.tags.filter((entry) => entry !== tag) : [...current.tags, tag])}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              )}
              {!marketing && canWrite && <PhotoDetails photo={current} onSaved={reload} />}
              {error && <p role="alert" className="error-message">{error}</p>}
            </Dialog.Content>
          )}
        </Dialog.Portal>
      </Dialog.Root>
      {confirming && (
        <ConfirmationDialog
          open
          onClose={() => setConfirming(null)}
          onConfirm={async () => {
            const ids = confirming;
            setConfirming(null);
            await remove(ids);
          }}
          title={
            confirming.length === 1 ? (
              <T id="photos.delete.title-one">Delete this photo?</T>
            ) : (
              <T id="photos.delete.title-many" values={{ count: confirming.length }}>{"Delete {count} photos?"}</T>
            )
          }
        >
          <T id="photos.delete.description">The photo is removed from this gallery and from Documents.</T>
        </ConfirmationDialog>
      )}
      {undo && (
        <div role="status" className="toast undo-toast">
          <span>
            <Plural id="photos.gallery.deleted" count={undo.length} one="{count} photo deleted." other="{count} photos deleted." />
          </span>
          <button type="button" className="undo-toast__undo" onClick={() => void restore(undo)}>
            <Undo2 size={14} />
            <T id="photos.gallery.undo">Undo</T>
          </button>
          <button type="button" aria-label="Dismiss" className="undo-toast__close" onClick={() => setUndo(null)}>
            <X size={14} />
          </button>
        </div>
      )}
      {uploadOpen && <PhotoUpload area={area} onClose={() => setUploadOpen(false)} onSaved={reload} />}
    </>
  );
}

// A Kitchen or Inventory photo's label and date (FLOW-298 AC2), edited from the lightbox.
function PhotoDetails({ photo, onSaved }: { photo: Photo; onSaved: () => void }) {
  const [label, setLabel] = useState(photo.label);
  const [date, setDate] = useState(photo.date);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setLabel(photo.label);
    setDate(photo.date);
  }, [photo.id, photo.label, photo.date]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!date) return setError("Enter a date.");
    setBusy(true);
    setError("");
    try {
      await photosApi.update(photo.id, { label: label.trim(), date });
      onSaved();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="photo-details" onSubmit={(event) => void save(event)}>
      <label>
        <T id="photos.details.label">Label</T>
        <input value={label} maxLength={500} onChange={(event) => setLabel(event.target.value)} />
      </label>
      <label>
        <T id="photos.details.date">Date</T>
        <input type="date" required value={date} onChange={(event) => setDate(event.target.value)} />
      </label>
      <Button type="submit" disabled={busy}>
        <T id="photos.details.save">Save</T>
      </Button>
      {error && <p role="alert" className="error-message">{error}</p>}
    </form>
  );
}

// + Upload photos: several files at once, Type preset to Photo. Marketing links
// them to an event; Kitchen and Inventory give them a label and a date.
function PhotoUpload({ area, onClose, onSaved }: { area: PhotoArea; onClose: () => void; onSaved: () => void }) {
  const marketing = area === "marketing";
  const eventPlaceholder = useCopy("photos.upload.find-event.placeholder", "Search events…");
  const [files, setFiles] = useState<File[]>([]);
  const [term, setTerm] = useState("");
  const [event, setEvent] = useState<{ id: string; title: string } | null>(null);
  const [label, setLabel] = useState("");
  const [date, setDate] = useState(today);
  const [done, setDone] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const events = useResource(
    ["photo-upload-events", term],
    async () => (await eventsApi.list({ search: term.trim() || undefined })).rows,
    { enabled: marketing },
  );
  const options = [
    ...(event ? [event] : []),
    ...(events.data ?? []).filter((row) => row.id !== event?.id).map((row) => ({ id: row.id, title: `${row.title} (${row.date})` })),
  ];
  const save = async () => {
    if (!files.length) return setError("Choose at least one photo.");
    if (!marketing && !date) return setError("Enter a date.");
    setBusy(true);
    setError("");
    setDone(0);
    try {
      for (const [index, file] of files.entries()) {
        await uploadPhoto(file, marketing ? { area, eventId: event?.id } : { area, label: label.trim(), date });
        setDone(index + 1);
      }
      onSaved();
      onClose();
    } catch (cause) {
      setError(message(cause));
      onSaved();
    } finally {
      setBusy(false);
    }
  };
  return (
    <DetailDrawer
      open
      onClose={onClose}
      title={<T id="photos.upload.title">Upload photos</T>}
      description={<T id="photos.upload.description">JPEG, PNG, WebP or HEIC, up to 25 MB each.</T>}
    >
      {error && <p role="alert" className="error-message">{error}</p>}
      <label
        className="document-drop-zone"
        onDragOver={(drag) => drag.preventDefault()}
        onDrop={(drop) => {
          drop.preventDefault();
          setFiles([...drop.dataTransfer.files]);
        }}
      >
        <T id="photos.upload.choose">Choose or drop photos</T>
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/heic"
          aria-label="Photos"
          onChange={(change) => setFiles([...(change.target.files ?? [])])}
        />
      </label>
      {files.length > 0 && (
        <p>
          <Plural id="photos.upload.chosen" count={files.length} one="{count} photo chosen" other="{count} photos chosen" />
        </p>
      )}
      <p className="photo-upload__type">
        <T id="photos.upload.type-photo">Type: Photo</T>
      </p>
      {marketing ? (
        <div className="photo-upload__event">
          <T id="photos.upload.event">Event</T>
          <input
            aria-label="Find an event"
            placeholder={eventPlaceholder}
            data-copy-id="photos.upload.find-event.placeholder"
            value={term}
            onChange={(change) => setTerm(change.target.value)}
          />
          <Dropdown
            aria-label="Event"
            value={event?.id ?? ""}
            onValueChange={(value) => setEvent(options.find((option) => option.id === value) ?? null)}
          >
            <option value="">No event</option>
            {options.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}
          </Dropdown>
        </div>
      ) : (
        <>
          <label>
            <T id="photos.upload.label">Label</T>
            <input value={label} maxLength={500} onChange={(change) => setLabel(change.target.value)} />
          </label>
          <label>
            <T id="photos.upload.date">Date</T>
            <input type="date" required value={date} onChange={(change) => setDate(change.target.value)} />
          </label>
        </>
      )}
      {busy && (
        <p role="status">
          <T id="photos.upload.progress" values={{ done, total: files.length }}>{"Uploading {done} of {total}…"}</T>
        </p>
      )}
      <Button disabled={busy || !files.length} onClick={() => void save()}>
        <T id="photos.upload.upload">Upload</T>
      </Button>
    </DetailDrawer>
  );
}

export function MarketingPhotosPage() {
  return (
    <PhotoGallery
      area="marketing"
      title={<T id="photos.marketing.title">Photos</T>}
      subtitle={<T id="photos.marketing.subtitle">Every event, food and team photo, in one place.</T>}
    />
  );
}

export function KitchenPhotosPage() {
  return (
    <PhotoGallery
      area="kitchen"
      title={<T id="photos.kitchen.title">Kitchen photos</T>}
      subtitle={<T id="photos.kitchen.subtitle">Photos for the kitchen team.</T>}
    />
  );
}

export function InventoryPhotosPage() {
  return (
    <PhotoGallery
      area="inventory"
      title={<T id="photos.inventory.title">Inventory photos</T>}
      subtitle={<T id="photos.inventory.subtitle">Photos for the inventory team.</T>}
    />
  );
}
