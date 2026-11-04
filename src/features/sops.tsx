import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { JSONContent } from "@tiptap/core";
import { usePermissions } from "../app/permissions";
import { useResource } from "../app/useResource";
import { Button, FormField, LoadingSkeleton, PageHeader, Section } from "../components/shared";
import { LoadError } from "../components/record-display";
import { RichTextEditor } from "../components/rich-text/RichTextEditor";
import { RichTextView } from "../components/rich-text/RichTextView";
import { emptyRichText } from "../components/rich-text/extensions";
import { sopsApi } from "../services/sops";
import { Attachments } from "./attachments";

export function SopLibrary() {
  const { can } = usePermissions();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const sops = useResource(["sops", search, category], () => sopsApi.list(search, category));
  if (sops.error) return <LoadError message={sops.error} />;
  return <>
    <PageHeader title="SOP library" subtitle="Standard procedures for production and kitchen work.">
      {can("sops.write") && <Button asChild><Link to="/sops/new">New SOP</Link></Button>}
    </PageHeader>
    <Section title="Find a procedure">
      <FormField label="Search SOPs"><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} /></FormField>
      <FormField label="Category"><input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="All categories" /></FormField>
    </Section>
    <Section title="Procedures">
      {!sops.data ? <LoadingSkeleton /> : sops.data.length ? <ul>
        {sops.data.map((sop) => <li key={sop.id}>
          <Link to={`/sops/${sop.id}`}>{sop.title}</Link> · {sop.category} · Version {sop.version}
        </li>)}
      </ul> : <p>No SOPs found.</p>}
    </Section>
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
    <Link className="back-link" to="/sops">← SOP library</Link>
    <PageHeader title={creating ? "New SOP" : data?.title ?? "SOP"} subtitle={data ? `${data.category} · Version ${data.version}` : "Standard procedure"}>
      {data && can("sops.write") && !editing && <Button onClick={beginEdit}>Edit SOP</Button>}
    </PageHeader>
    {error && <p role="alert" className="error-message">{error}</p>}
    {editing ? <Section title="Procedure">
      <form onSubmit={save}>
        <FormField label="Title"><input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></FormField>
        <FormField label="Category"><input required maxLength={100} value={category} onChange={(e) => setCategory(e.target.value)} /></FormField>
        <RichTextEditor label="SOP content" value={content} onChange={setContent} />
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save SOP"}</Button>
        {data && <Button type="button" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>}
      </form>
    </Section> : data && <>
      <Section title="Procedure"><RichTextView doc={data.content} /></Section>
      <Attachments recordType="sop" recordId={id} />
      <Section title="Edit history">
        <ol>{data.history.map((version) => <li key={version.id}>
          <button type="button" onClick={() => setShownVersion(version.version)}>
            Version {version.version} · {version.editorName ?? "Unknown editor"} · {new Date(version.editedAt).toLocaleString()}
          </button>
        </li>)}</ol>
        {selected && <div><h3>Version {selected.version}: {selected.title}</h3><p>{selected.category}</p><RichTextView doc={selected.content} /></div>}
      </Section>
    </>}
  </>;
}
