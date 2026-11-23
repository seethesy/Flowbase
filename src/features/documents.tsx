import { Block, PageGrid } from "../app/page-grid";
import { useRef, useState, type ChangeEvent } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Upload } from "lucide-react";
import { Dropdown } from "../components/ui/Dropdown";
import { Button, DataTable, DetailDrawer, FilterBar, LoadingSkeleton, PageHeader, SearchInput, type DeleteResult } from "../components/shared";
import { useResource } from "../app/useResource";
import { usePermissions } from "../app/permissions";
import { T, useCopy } from "../app/copy";
import { documentsApi, uploadDocument } from "../services/documents";
import { searchApi } from "../services/search";
import { sopsApi } from "../services/sops";
import { documentTypeLabels, documentTypes, type Document, type DocumentType } from "../../shared/documents";
import type { AttachmentRecordType } from "../../shared/attachments";
import "./documents.css";

const linkTypes: { value: AttachmentRecordType; label: string }[] = [
  { value: "document", label: "Unlinked" }, { value: "lead", label: "Leads" },
  { value: "client", label: "Clients" }, { value: "event", label: "Events" },
  { value: "venue", label: "Venues" }, { value: "vendor", label: "Vendors" },
  { value: "inventory_item", label: "Inventory" }, { value: "recipe", label: "Recipes" },
  { value: "sop", label: "SOPs" },
];
const sizeText = (bytes: number) => bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const extension = (name: string) => name.split(".").at(-1)?.toUpperCase() ?? "FILE";
const latest = (document: Document) => document.versions[0];

function RecordPicker({ value, onChange }: {
  value: { type: AttachmentRecordType; id: string; name: string };
  onChange: (value: { type: AttachmentRecordType; id: string; name: string }) => void;
}) {
  const searchPlaceholder = useCopy("documents.picker.search.placeholder", "Search records…");
  const [term, setTerm] = useState("");
  const search = useResource(["document-link-search", term], () => searchApi.search(term), { enabled: term.trim().length >= 2 });
  const sops = useResource(["document-sop-search", term], () => sopsApi.list(term), { enabled: term.trim().length >= 2 });
  const options = [
    ...(search.data ?? []).map((row) => ({ type: row.type === "item" ? "inventory_item" as const : row.type as AttachmentRecordType, id: row.id, name: row.title })),
    ...(sops.data ?? []).map((row) => ({ type: "sop" as const, id: row.id, name: row.title })),
  ];
  return <div className="document-picker">
    <label><T id="documents.picker.link-to">Link to</T>
      <Dropdown value={value.type} onValueChange={(type) => onChange({ type: type as AttachmentRecordType, id: "", name: "" })}>
        {linkTypes.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
      </Dropdown>
    </label>
    {value.type !== "document" && <>
      <input aria-label="Find a record" placeholder={searchPlaceholder} data-copy-id="documents.picker.search.placeholder"
        value={term} onChange={(event) => setTerm(event.target.value)} />
      {value.id && <p><T id="documents.picker.selected" values={{ name: value.name }}>{"Linked to {name}"}</T></p>}
      {term.trim().length >= 2 && <ul className="document-picker-results">
        {options.filter((row) => row.type === value.type).map((row) =>
          <li key={`${row.type}:${row.id}`}><button type="button" onClick={() => { onChange(row); setTerm(""); }}>{row.name}</button></li>)}
      </ul>}
    </>}
  </div>;
}

function LinkedCell({ row, writable, save }: { row: Document; writable: boolean;
  save: (change: { recordType: AttachmentRecordType; recordId: string }) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [link, setLink] = useState<{ type: AttachmentRecordType; id: string; name: string }>(
    { type: row.recordType, id: row.recordType === "document" ? "" : row.recordId, name: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const commit = async () => {
    if (link.type !== "document" && !link.id) return setError("Pick a linked record.");
    setBusy(true); setError("");
    try { await save({ recordType: link.type, recordId: link.type === "document" ? row.id : link.id }); setEditing(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <div className="document-linked-cell">
    <button type="button" disabled={!writable} className="table-edit-trigger" onClick={() => setEditing(true)}>
      {row.recordType === "document" ? <T id="documents.library.unlinked">Unlinked</T>
        : `${row.recordType} · ${row.recordId.slice(0, 8)}`}
    </button>
    {editing && <div className="document-linked-editor">
      <RecordPicker value={link} onChange={setLink} />
      {error && <p role="alert" className="error-message">{error}</p>}
      <Button disabled={busy} onClick={() => void commit()}><T id="documents.library.save-link">Save link</T></Button>
      <Button variant="outline" onClick={() => setEditing(false)}><T id="documents.library.cancel-link">Cancel</T></Button>
    </div>}
  </div>;
}

export function DocumentsPage() {
  const searchPlaceholder = useCopy("documents.library.search.placeholder", "Search files…");
  const { actor, can } = usePermissions();
  const files = useResource(["documents"], documentsApi.list);
  const [type, setType] = useState<DocumentType | "">("");
  const [search, setSearch] = useState("");
  const [linked, setLinked] = useState("");
  const [uploader, setUploader] = useState("");
  const [updated, setUpdated] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [undoId, setUndoId] = useState("");
  const [error, setError] = useState("");
  const all = files.data ?? [];
  const data = all.filter((row) =>
    (!type || row.docType === type) &&
    (!search || `${row.name} ${latest(row)?.fileName ?? ""}`.toLowerCase().includes(search.toLowerCase())) &&
    (!linked || row.recordType === linked) &&
    (!uploader || latest(row)?.uploadedBy === uploader) &&
    (!updated || Date.parse(row.updatedAt) >= Date.now() - Number(updated) * 86_400_000));
  const selected = all.find((row) => row.id === selectedId);
  const uploadInput = useRef<HTMLInputElement>(null);
  const reload = () => files.reload();
  const edit = async (id: string, change: Parameters<typeof documentsApi.update>[1]) => {
    await documentsApi.update(id, change);
    reload();
  };
  const remove = async (ids: string[]): Promise<DeleteResult> => {
    const deleted: string[] = [];
    const skipped: DeleteResult["skipped"] = [];
    for (const id of ids) {
      const row = all.find((candidate) => candidate.id === id);
      if (!row) continue;
      if (row.protected) { skipped.push({ id, name: row.name, reason: "kept permanently" }); continue; }
      try { await documentsApi.archive(id); deleted.push(id); }
      catch (cause) { skipped.push({ id, name: row.name, reason: cause instanceof Error ? cause.message : String(cause) }); }
    }
    reload();
    return { deleted, skipped };
  };
  const columns: ColumnDef<Document, unknown>[] = [
    { accessorKey: "name", header: "Name", meta: { edit: "text", canEdit: () => can("attachments.write"), onEdit: (row, value) => edit(row.id, { name: value }) } },
    { accessorKey: "docType", header: "Type", meta: { edit: "select", canEdit: (row) => can("attachments.write") && (!row.protected || actor?.role === "admin"),
      editOptions: documentTypes.map((entry) => ({ value: entry, label: documentTypeLabels[entry] })),
      onEdit: (row, value) => edit(row.id, { docType: value as DocumentType }) },
      cell: ({ row }) => <span className={`badge document-type-${row.original.docType}`}>{documentTypeLabels[row.original.docType]}</span> },
    { id: "file", header: "File", accessorFn: (row) => extension(latest(row)?.fileName ?? ""),
      cell: ({ row }) => <span className="badge">{extension(latest(row.original)?.fileName ?? "")}</span> },
    { id: "linked", header: "Linked to", accessorFn: (row) => `${row.recordType}:${row.recordId}`,
      meta: { edit: "select" },
      cell: ({ row }) => <LinkedCell row={row.original} writable={can("attachments.write")}
        save={(change) => edit(row.original.id, change)} /> },
    { id: "uploaded", header: "Uploaded by", accessorFn: (row) => latest(row)?.uploaderName ?? "—" },
    { accessorKey: "updatedAt", header: "Updated", cell: ({ row }) => new Date(row.original.updatedAt).toLocaleDateString() },
    { id: "size", header: "Size", accessorFn: (row) => latest(row)?.size ?? 0, cell: ({ row }) => sizeText(latest(row.original)?.size ?? 0) },
  ];
  const uploadVersion = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    if (!picked || !selected) return;
    setError("");
    try { await uploadDocument(picked, { name: selected.name, docType: selected.docType,
      recordType: selected.recordType, recordId: selected.recordId, documentId: selected.id }); reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    event.target.value = "";
  };
  return <>
    <PageHeader title={<T id="documents.library.title">Documents</T>}
      subtitle={<T id="documents.library.subtitle">Files linked to the work they belong to.</T>}>
      {can("attachments.write") && <Button onClick={() => setUploadOpen(true)}><Upload size={16} /><T id="documents.library.upload">Upload</T></Button>}
    </PageHeader>
    {error && <p role="alert" className="error-message">{error}</p>}
    <PageGrid pageKey="documents.library">
    <Block id="types" name="Document types" h={4}>
    <div className="document-type-tabs">
      <Button variant={type === "" ? "default" : "outline"} onClick={() => setType("")}><T id="documents.library.all">All</T> {all.length}</Button>
      {documentTypes.map((entry) => <Button key={entry} variant={type === entry ? "default" : "outline"} onClick={() => setType(entry)}>
        {documentTypeLabels[entry]} {all.filter((row) => row.docType === entry).length}
      </Button>)}
    </div>
    </Block>
    <Block id="filters" name="Document filters" h={5}>
    <FilterBar>
      <SearchInput value={search} onChange={setSearch} placeholder={searchPlaceholder} copyId="documents.library.search.placeholder" />
      <Dropdown aria-label="Linked to" value={linked} onValueChange={setLinked}><option value="">Any link</option>
        {linkTypes.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
      </Dropdown>
      <Dropdown aria-label="Uploaded by" value={uploader} onValueChange={setUploader}><option value="">Anyone</option>
        {[...new Map(all.filter((row) => latest(row)?.uploadedBy).map((row) => [latest(row).uploadedBy!, { id: latest(row).uploadedBy!, name: latest(row).uploaderName ?? "Unknown" }])).values()]
          .map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
      </Dropdown>
      <Dropdown aria-label="Updated" value={updated} onValueChange={setUpdated}>
        <option value="">Any time</option><option value="7">Last 7 days</option><option value="90">Last 90 days</option>
      </Dropdown>
    </FilterBar>
    </Block>
    <Block id="list" name="Documents" h={20}>
    {files.error && <p role="alert" className="error-message">{files.error}</p>}
    {files.loading && !files.data ? <LoadingSkeleton /> : <DataTable copyKey="documents.library" exportName="documents" data={data} columns={columns} onRow={(row) => setSelectedId(row.id)} openColumn
      selection={{ rowId: (row) => row.id, onDelete: can("attachments.write") ? remove : undefined,
        onRestore: can("attachments.write") ? async (ids) => { await Promise.all(ids.map((id) => documentsApi.restore(id))); reload(); } : undefined }} />}
    </Block>
    </PageGrid>
    {selected && <DetailDrawer open onClose={() => setSelectedId("")} title={selected.name}
      description={<T id="documents.preview.description">File details and earlier versions</T>} wide>
      {latest(selected)?.contentType === "application/pdf" && latest(selected)?.url
        ? <iframe className="document-preview" title="Document preview" src={`${latest(selected).url}#page=1`} />
        : latest(selected)?.contentType.startsWith("image/") && latest(selected)?.url
          ? <img className="document-preview" src={latest(selected).url!} alt={selected.name} />
          : <p><T id="documents.preview.no-preview">Preview is unavailable for this file type.</T></p>}
      <p>{documentTypeLabels[selected.docType]} · {sizeText(latest(selected)?.size ?? 0)}</p>
      <h3><T id="documents.preview.versions">Versions</T></h3>
      <ul>{selected.versions.map((version) => <li key={version.id}>
        <a href={version.url ?? undefined} target="_blank" rel="noreferrer" download={version.fileName}>
          <T id="documents.preview.version" values={{ number: version.number, name: version.fileName }}>{"Version {number}: {name}"}</T>
        </a> · {sizeText(version.size)}
      </li>)}</ul>
      {can("attachments.write") && <>
        <input hidden ref={uploadInput} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.heic" onChange={(event) => void uploadVersion(event)} />
        <Button variant="outline" onClick={() => uploadInput.current?.click()}><T id="documents.preview.new-version">Upload new version</T></Button>
        {!selected.protected && <Button variant="outline" onClick={() => { if (window.confirm("Delete this document?")) void remove([selected.id]).then((result) => { if (result.deleted.length) { setUndoId(selected.id); setSelectedId(""); } }); }}>
          <T id="documents.preview.delete">Delete</T>
        </Button>}
      </>}
    </DetailDrawer>}
    {undoId && <div role="status" className="table-undo-toast"><T id="documents.library.deleted">Document deleted.</T>
      <Button variant="outline" onClick={() => void documentsApi.restore(undoId).then(() => { setUndoId(""); reload(); })}><T id="documents.library.undo">Undo</T></Button>
    </div>}
    {uploadOpen && <DocumentUpload onClose={() => setUploadOpen(false)} onSaved={reload} />}
  </>;
}

function DocumentUpload({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<DocumentType>("other");
  const [link, setLink] = useState<{ type: AttachmentRecordType; id: string; name: string }>({ type: "document", id: "", name: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!file) return setError("Choose a file.");
    if (link.type !== "document" && !link.id) return setError("Pick a linked record.");
    setBusy(true); setError("");
    try {
      await uploadDocument(file, { name: name.trim() || file.name, docType: type, recordType: link.type,
        recordId: link.id || undefined });
      onSaved(); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <DetailDrawer open onClose={onClose} title={<T id="documents.upload.title">Upload document</T>}
    description={<T id="documents.upload.description">PDF, Word, Excel, JPG, PNG or HEIC. Maximum 25 MB.</T>}>
    {error && <p role="alert" className="error-message">{error}</p>}
    <label className="document-drop-zone" onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => { event.preventDefault(); const picked = event.dataTransfer.files[0];
        if (picked) { setFile(picked); if (!name) setName(picked.name); } }}>
      <T id="documents.upload.drop">Choose or drop a file</T>
      <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.heic" onChange={(event) => {
        const picked = event.target.files?.[0] ?? null; setFile(picked); if (picked && !name) setName(picked.name);
      }} />
    </label>
    <label><T id="documents.upload.name">Name</T><input value={name} onChange={(event) => setName(event.target.value)} /></label>
    <label><T id="documents.upload.type">Type</T><Dropdown value={type} onValueChange={(next) => setType(next as DocumentType)}>
      {documentTypes.map((entry) => <option key={entry} value={entry}>{documentTypeLabels[entry]}</option>)}
    </Dropdown></label>
    <RecordPicker value={link} onChange={setLink} />
    <Button disabled={busy || !file} onClick={() => void save()}><T id="documents.upload.save">Upload</T></Button>
  </DetailDrawer>;
}
