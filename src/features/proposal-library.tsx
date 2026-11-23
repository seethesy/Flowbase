import { useState } from "react";
import { Link } from "react-router-dom";
import { FileText, LayoutGrid, List } from "lucide-react";
import { Dropdown } from "../components/ui/Dropdown";
import { Button, EmptyState, FilterBar, LoadingSkeleton, PageHeader, SearchInput } from "../components/shared";
import { LoadError } from "../components/record-display";
import { useResource } from "../app/useResource";
import { usePermissions } from "../app/permissions";
import { T, useCopy } from "../app/copy";
import { Block, PageGrid } from "../app/page-grid";
import { proposalsApi } from "../services/proposals";
import type { ProposalLibraryFile } from "../../shared/proposals";
import "./proposal-library.css";

// The Proposals library (FLOW-276): one file per event, its latest uploaded
// proposal version, as a list or a grid. No event details beyond its name. Read
// only: a proposal is renamed on its event page.
type View = "list" | "grid";
const viewKey = (userId: string | undefined) => `flowbase.proposals.view.${userId ?? "anonymous"}`;
// Browser storage can be missing or blocked; the list view is the fallback.
const readView = (userId: string | undefined): View => {
  try { return localStorage.getItem(viewKey(userId)) === "grid" ? "grid" : "list"; }
  catch { return "list"; }
};
const writeView = (userId: string | undefined, view: View) => {
  try { localStorage.setItem(viewKey(userId), view); } catch { /* not remembered */ }
};
const uploadedOn = (row: ProposalLibraryFile) => new Date(row.uploadedAt).toLocaleDateString();

function Labels({ row }: { row: ProposalLibraryFile }) {
  return <span className="proposal-file-labels">
    {row.approved && <span className="badge success"><T id="proposals.library.approved">Approved</T></span>}
    {row.final && <span className="badge proposal-file-final"><T id="proposals.library.final">Final</T></span>}
  </span>;
}

function FileLinks({ row }: { row: ProposalLibraryFile }) {
  return <span className="proposal-file-links">
    <a href={row.docx.url} target="_blank" rel="noreferrer" download={row.docx.fileName}
      aria-label={`Download ${row.title} (DOCX)`}><T id="proposals.library.docx">DOCX</T></a>
    {row.pdf && <a href={row.pdf.url} target="_blank" rel="noreferrer"
      aria-label={`Open ${row.title} (PDF)`}><T id="proposals.library.pdf">PDF</T></a>}
  </span>;
}

const EventLink = ({ row }: { row: ProposalLibraryFile }) =>
  <Link className="proposal-file-event" to={`/events/${row.event.id}?proposal=${row.proposalId}`}>{row.event.name}</Link>;

export function ProposalLibrary() {
  const searchPlaceholder = useCopy("proposals.library.search.placeholder", "Search files…");
  const { actor } = usePermissions();
  const files = useResource(["proposals", "files"], proposalsApi.files);
  const [view, setView] = useState<View>(() => readView(actor?.userId));
  const [search, setSearch] = useState("");
  const [uploaded, setUploaded] = useState("");
  const choose = (next: View) => { setView(next); writeView(actor?.userId, next); };
  if (files.error) return <LoadError message={files.error} />;
  const all = files.data ?? [];
  const term = search.trim().toLowerCase();
  const rows = all.filter((row) =>
    (!term || `${row.title} ${row.docx.fileName} ${row.pdf?.fileName ?? ""}`.toLowerCase().includes(term)) &&
    (!uploaded || Date.parse(row.uploadedAt) >= Date.now() - Number(uploaded) * 86_400_000));
  return <>
    <PageHeader title={<T id="proposals.library.title">Proposals</T>}
      subtitle={<T id="proposals.library.subtitle">The latest proposal file for each event.</T>}>
      <div className="proposal-view-toggle" role="group" aria-label="View">
        <Button variant={view === "list" ? "default" : "outline"} aria-pressed={view === "list"} onClick={() => choose("list")}>
          <List size={16} /><T id="proposals.library.list-view">List</T>
        </Button>
        <Button variant={view === "grid" ? "default" : "outline"} aria-pressed={view === "grid"} onClick={() => choose("grid")}>
          <LayoutGrid size={16} /><T id="proposals.library.grid-view">Grid</T>
        </Button>
      </div>
    </PageHeader>
    <PageGrid pageKey="proposals.library">
    <Block id="filters" name="Filters" h={3}>
    <FilterBar>
      <SearchInput value={search} onChange={setSearch} placeholder={searchPlaceholder} copyId="proposals.library.search.placeholder" />
      <Dropdown aria-label="Uploaded" value={uploaded} onValueChange={setUploaded}>
        <option value="">Any time</option><option value="7">Last 7 days</option><option value="90">Last 90 days</option>
      </Dropdown>
    </FilterBar>
    </Block>
    <Block id="files" name="Proposal files" h={20}>
    {files.loading && !files.data ? <LoadingSkeleton />
      : !rows.length ? <EmptyState title={<T id="proposals.library.empty">No proposal files</T>}
        description={<T id="proposals.library.empty-description">Files appear here once a proposal version is uploaded on its event.</T>} />
      : view === "list"
        ? <div className="table-scroll"><table className="proposal-file-table" aria-label="Proposal files">
          <thead><tr>
            <th><T id="proposals.library.name">Name</T></th>
            <th><T id="proposals.library.file">File</T></th>
            <th><T id="proposals.library.uploaded">Uploaded</T></th>
            <th><T id="proposals.library.event">Event</T></th>
          </tr></thead>
          <tbody>{rows.map((row) => <tr key={row.proposalId}>
            {/* Renamed only on the event page, never here. */}
            <td>{row.title} <Labels row={row} /></td>
            <td><FileLinks row={row} /></td>
            <td>{uploadedOn(row)}</td>
            <td><EventLink row={row} /></td>
          </tr>)}</tbody>
        </table></div>
        : <ul className="proposal-file-grid" aria-label="Proposal files">{rows.map((row) => <li key={row.proposalId} className="proposal-file-card">
          <FileText size={28} aria-hidden />
          <strong>{row.title}</strong>
          <Labels row={row} />
          <FileLinks row={row} />
          <span className="proposal-file-date">{uploadedOn(row)}</span>
          <EventLink row={row} />
        </li>)}</ul>}
    </Block>
    </PageGrid>
  </>;
}
