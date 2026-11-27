import { useState } from "react";
import { Block, PageGrid } from "../../app/live-edit/page-grid";
import { usePermissions } from "../../app/permissions";
import { useResource } from "../../app/useResource";
import { T } from "../../app/copy";
import { Button, EmptyState, ErrorText, LoadingSkeleton, PageHeader, Section } from "../../components/shared";
import type { AreaNote, AreaNoteKey } from "../../../shared/area-notes";
import { areaNotesApi } from "../../services/area-notes";
import { dateTimeLabel } from "../inventory/inventory-labels";
import "./heading-overview.css";

// The Overview tab that opens the Marketing, Documents and Reports headings
// (FLOW-295; Sales › Overview lists leads since FLOW-328, sales-overview.tsx). Each starts as an empty page layout (FLOW-273): an Admin
// in live edit adds cards, tables and text boxes, which everyone then sees.
// Until something is added, the page shows a short empty state.

export function NothingYet() {
  const { can } = usePermissions();
  return (
    <section className="panel">
      <EmptyState
        title={<T id="heading-overview.empty.title">Nothing here yet</T>}
        description={can("layout.edit")
          ? <T id="heading-overview.empty.admin">Turn on Edit screen text to add cards, tables and text to this page.</T>
          : <T id="heading-overview.empty.description">Cards added to this page will show here.</T>}
      />
    </section>
  );
}

// A Notes card everyone who sees the tab may type in (FLOW-341 A2): one shared
// text per tab, saved with Save notes. The last save wins; the card says who
// saved it and when.
function NotesForm({ note, onSaved }: { note: AreaNote; onSaved: (note: AreaNote) => void }) {
  const [value, setValue] = useState(note.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  return (
    <form className="area-notes" onSubmit={async (event) => {
      event.preventDefault();
      setBusy(true);
      setError("");
      setSaved(false);
      try {
        onSaved(await areaNotesApi.save(note.key, value));
        setSaved(true);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    }}>
      <textarea aria-label="Notes" rows={8} maxLength={20000} value={value}
        onChange={(event) => { setValue(event.target.value); setSaved(false); }} />
      <ErrorText message={error} />
      <div className="area-notes__footer">
        <Button type="submit" disabled={busy || value === note.body}><T id="heading-overview.notes.save">Save notes</T></Button>
        {saved && <span role="status"><T id="heading-overview.notes.saved">Notes saved.</T></span>}
        {note.updatedAt && (
          <span className="area-notes__meta">
            <T id="heading-overview.notes.last-saved" values={{ name: note.updatedByName ?? "", when: dateTimeLabel(note.updatedAt) }}>
              {"Last saved by {name}, {when}"}
            </T>
          </span>
        )}
      </div>
    </form>
  );
}

function AreaNotesCard({ noteKey }: { noteKey: AreaNoteKey }) {
  const note = useResource(["area-notes", noteKey], () => areaNotesApi.get(noteKey));
  return (
    <Section title={<T id="heading-overview.notes.title">Notes</T>}>
      {note.error ? <ErrorText message={note.error} />
        : !note.data ? <LoadingSkeleton />
        : <NotesForm key={note.data.updatedAt ?? "new"} note={note.data} onSaved={() => note.reload()} />}
    </Section>
  );
}

export function MarketingOverview() {
  return (
    <>
      <PageHeader title={<T id="heading-overview.marketing.title">Marketing overview</T>} eyebrow={<T id="heading-overview.marketing.eyebrow">Marketing</T>} />
      <PageGrid pageKey="marketing.overview">
        <Block id="notes" name="Notes" h={12}><AreaNotesCard noteKey="marketing.overview" /></Block>
      </PageGrid>
    </>
  );
}

export function DocumentsOverview() {
  return (
    <>
      <PageHeader title={<T id="heading-overview.documents.title">Documents overview</T>} eyebrow={<T id="heading-overview.documents.eyebrow">Documents</T>} />
      <PageGrid pageKey="documents.overview"><NothingYet /></PageGrid>
    </>
  );
}

export function ReportsOverview() {
  return (
    <>
      <PageHeader title={<T id="heading-overview.reports.title">Reports overview</T>} eyebrow={<T id="heading-overview.reports.eyebrow">Reports</T>} />
      <PageGrid pageKey="reports.overview"><NothingYet /></PageGrid>
    </>
  );
}

// Marketing's working areas (FLOW-341): Socials, Movies, Other Events, SEO,
// Website and Analytics. Each is its own page layout, so a card the Admin adds
// shows on that tab only; Socials to SEO (and the Overview) start with the
// shared Notes card (A2), Website and Analytics empty. The tabs need
// marketing.read.
const marketingEyebrow = <T id="heading-overview.marketing.eyebrow">Marketing</T>;

export function MarketingSocials() {
  return (
    <>
      <PageHeader title={<T id="marketing-area.socials.title">Socials</T>} eyebrow={marketingEyebrow} />
      <PageGrid pageKey="marketing.socials">
        <Block id="notes" name="Notes" h={12}><AreaNotesCard noteKey="marketing.socials" /></Block>
      </PageGrid>
    </>
  );
}

export function MarketingMovies() {
  return (
    <>
      <PageHeader title={<T id="marketing-area.movies.title">Movies</T>} eyebrow={marketingEyebrow} />
      <PageGrid pageKey="marketing.movies">
        <Block id="notes" name="Notes" h={12}><AreaNotesCard noteKey="marketing.movies" /></Block>
      </PageGrid>
    </>
  );
}

export function MarketingOtherEvents() {
  return (
    <>
      <PageHeader title={<T id="marketing-area.other-events.title">Other events</T>} eyebrow={marketingEyebrow} />
      <PageGrid pageKey="marketing.other-events">
        <Block id="notes" name="Notes" h={12}><AreaNotesCard noteKey="marketing.other-events" /></Block>
      </PageGrid>
    </>
  );
}

export function MarketingSeo() {
  return (
    <>
      <PageHeader title={<T id="marketing-area.seo.title">SEO</T>} eyebrow={marketingEyebrow} />
      <PageGrid pageKey="marketing.seo">
        <Block id="notes" name="Notes" h={12}><AreaNotesCard noteKey="marketing.seo" /></Block>
      </PageGrid>
    </>
  );
}

export function MarketingWebsite() {
  return (
    <>
      <PageHeader title={<T id="marketing-area.website.title">Website</T>} eyebrow={marketingEyebrow} />
      <PageGrid pageKey="marketing.website"><NothingYet /></PageGrid>
    </>
  );
}

// Marketing analytics (FLOW-341 A1): one page, shown on Marketing › Analytics
// and as the Marketing analytics view of Sales › Analytics (FLOW-340 A1), so a
// card the Admin adds shows in both places. It starts empty.
export function MarketingAnalytics() {
  return (
    <>
      <PageHeader pageKey="marketing.analytics" title={<T id="marketing-area.analytics.title">Marketing analytics</T>} eyebrow={marketingEyebrow} />
      <PageGrid pageKey="marketing.analytics"><NothingYet /></PageGrid>
    </>
  );
}
