import { useState, type FormEvent } from "react";
import { Block, PageGrid } from "../app/page-grid";
import type { ColumnDef } from "@tanstack/react-table";
import type { SopSummary } from "../../shared/sops";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { JSONContent } from "@tiptap/core";
import { usePermissions } from "../app/permissions";
import { useResource } from "../app/useResource";
import { Button, DataTable, FormField, LoadingSkeleton, PageHeader, Section } from "../components/shared";
import { LoadError } from "../components/record-display";
import { RichTextEditor } from "../components/rich-text/RichTextEditor";
import { RichTextView } from "../components/rich-text/RichTextView";
import { emptyRichText } from "../components/rich-text/extensions";
import { sopsApi } from "../services/sops";
import { Attachments } from "./attachments";
import { T, useCopy } from "../app/copy";

export function SopLibrary() {
  const allCategoriesPlaceholder = useCopy("sops.sop-library.all-categories.placeholder", "All categories");
  const { can } = usePermissions();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const sops = useResource(["sops", search, category], () => sopsApi.list(search, category));
  const edit = async (row: SopSummary, change: { title?: string; category?: string }) => {
    const current = await sopsApi.get(row.id);
    await sopsApi.update(row.id, { title: change.title ?? current.title,
      category: change.category ?? current.category, content: current.content, version: current.version });
    sops.reload();
  };
  const columns: ColumnDef<SopSummary, unknown>[] = [
    { accessorKey: "title", header: "Title", meta: { edit: "text", canEdit: () => can("sops.write"),
      onEdit: (row, value) => edit(row, { title: value }) } },
    { accessorKey: "category", header: "Category", meta: { edit: "text", canEdit: () => can("sops.write"),
      onEdit: (row, value) => edit(row, { category: value }) } },
    { accessorKey: "version", header: "Version", meta: { edit: "none" } },
  ];
  if (sops.error) return <LoadError message={sops.error} />;
  return <>
    <PageHeader title={<T id="sops.sop-library.sop-library">SOP library</T>} subtitle={<T id="sops.sop-library.standard-procedures-for-production-and">Standard procedures for production and kitchen work.</T>}>
      {can("sops.write") && <Button asChild><Link to="/sops/new"><T id="sops.sop-library.new-sop">New SOP</T></Link></Button>}
    </PageHeader>
    <PageGrid pageKey="sops.library">
    <Block id="search" name="Find a procedure" h={6}>
    <Section title={<T id="sops.sop-library.find-a-procedure">Find a procedure</T>}>
      <FormField label={<T id="sops.sop-library.search-sops">Search SOPs</T>}><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} /></FormField>
      <FormField label={<T id="sops.sop-library.category">Category</T>}><input value={category} onChange={(e) => setCategory(e.target.value)} placeholder={allCategoriesPlaceholder} data-copy-id="sops.sop-library.all-categories.placeholder" /></FormField>
    </Section>
    </Block>
    <Block id="procedures" name="Procedures" h={20}>
    <Section title={<T id="sops.sop-library.procedures">Procedures</T>}>
      {!sops.data ? <LoadingSkeleton /> : sops.data.length ?
        <DataTable copyKey="sops.library" exportName="sops" data={sops.data} columns={columns}
          onRow={(row) => navigate(`/sops/${row.id}`)} openColumn />
        : <p><T id="sops.sop-library.no-sops-found">No SOPs found.</T></p>}
    </Section>
    </Block>
    </PageGrid>
  </>;
}

export function SopDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const creating = id === "new";
  const sop = useResource(["sops", id], () => sopsApi.get(id), { enabled: !creating });
  const [editing, setEditing] = useState(creating);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [content, setContent] = useState<JSONContent>(emptyRichText);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shownVersion, setShownVersion] = useState<number | null>(null);
  if (creating && !can("sops.write")) return <LoadError message="You cannot create SOPs." />;
  if (sop.error) return <LoadError message={sop.error} />;
  if (!creating && !sop.data) return <LoadingSkeleton />;
  const data = sop.data;
  const beginEdit = () => {
    if (!data) return;
    setTitle(data.title); setCategory(data.category); setContent(data.content);
    setEditing(true);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const saved = data
        ? await sopsApi.update(id, { title, category, content, version: data.version })
        : await sopsApi.create({ title, category, content });
      if (data) sop.replace(saved);
      else navigate(`/sops/${saved.id}`, { replace: true });
      setEditing(false);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const selected = data?.history.find((version) => version.version === shownVersion);
  return <>
    <Link className="back-link" to="/sops"><T id="sops.sop-detail.sop-library">← SOP library</T></Link>
    <PageHeader title={creating ? <T id="sops.sop-detail.new-sop">New SOP</T> : data?.title ?? <T id="sops.sop-detail.sop">SOP</T>}>
      {data && can("sops.write") && !editing && <Button onClick={beginEdit}><T id="sops.sop-detail.edit-sop">Edit SOP</T></Button>}
    </PageHeader>
    {error && <p role="alert" className="error-message">{error}</p>}
    <PageGrid pageKey="sops.detail">
    <Block id="sop-header-facts" name="SOP facts" h={3}><p>{data ? <T id="sops.sop-detail.version" values={{ category: data.category, version: data.version }}>{"{category} · Version {version}"}</T> : <T id="sops.sop-detail.standard-procedure">Standard procedure</T>}</p></Block>
    <Block id="procedure" name="Procedure" h={18}>
    {editing ? <Section title={<T id="sops.sop-detail.procedure">Procedure</T>}>
      <form onSubmit={save}>
        <FormField label={<T id="sops.sop-detail.title">Title</T>}><input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></FormField>
        <FormField label={<T id="sops.sop-detail.category">Category</T>}><input required maxLength={100} value={category} onChange={(e) => setCategory(e.target.value)} /></FormField>
        <RichTextEditor label="SOP content" value={content} onChange={setContent} />
        <Button type="submit" disabled={busy}>{busy ? <T id="sops.sop-detail.saving">Saving…</T> : <T id="sops.sop-detail.save-sop">Save SOP</T>}</Button>
        {data && <Button type="button" variant="outline" onClick={() => setEditing(false)}><T id="sops.sop-detail.cancel">Cancel</T></Button>}
      </form>
    </Section> : data && <Section title={<T id="sops.sop-detail.procedure">Procedure</T>}><RichTextView doc={data.content} /></Section>}
    </Block>
    {data && !editing && <Block id="attachments" name="SOP attachments" h={8}><Attachments recordType="sop" recordId={id} /></Block>}
    {data && !editing && <Block id="edit-history" name="Edit history" h={12}>
      <Section title={<T id="sops.sop-detail.edit-history">Edit history</T>}>
        <ol>{data.history.map((version) => <li key={version.id}>
          <button type="button" onClick={() => setShownVersion(version.version)}>
            <T id="sops.sop-detail.version-2" values={{ version: version.version }}>{"Version {version} · "}</T>{version.editorName ?? <T id="sops.sop-detail.unknown-editor">Unknown editor</T>} · {new Date(version.editedAt).toLocaleString()}
          </button>
        </li>)}</ol>
        {selected && <div><h3><T id="sops.sop-detail.version-3" values={{ version: selected.version, title: selected.title }}>{"Version {version}: {title}"}</T></h3><p>{selected.category}</p><RichTextView doc={selected.content} /></div>}
      </Section>
    </Block>}
    </PageGrid>
  </>;
}
