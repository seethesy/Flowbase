import { useEffect, useRef, useState } from "react";
import type { ProposalVersion } from "../../shared/proposals";
import { proposalLineKinds, suggestCatalog, type ProposalLine, type ProposalMapping } from "../../shared/proposal-mapping";
import { Button, FormField, LoadingSkeleton } from "../components/shared";
import { queryClient } from "../app/queryClient";
import { proposalsApi } from "../services/proposals";
import { parseProposalDocx, type ProposalBlock } from "./proposal-docx";
import { carryPreviousProposalReview, extractProposalTemplate } from "./proposal-template-rules";

const fieldLabels: Record<string, string> = {
  eventDate: "Event date", startTime: "Start time", endTime: "End time",
  venue: "Venue", address: "Address", guestCount: "Guest count",
  eventType: "Event type", serviceType: "Service type", foodServiceStyle: "Food service style",
};
const newLine = (guestCount: number | null): ProposalLine => ({
  id: crypto.randomUUID(), kind: "menu", section: "", name: "", notes: "",
  quantity: guestCount, sourceBlockId: null, catalogId: null, notTracked: false,
});

export function ProposalReview({ id, version, canWrite, guestCount, onSubmitted }: { id: string; version: ProposalVersion; canWrite: boolean; guestCount: number | null; onSubmitted?: () => void }) {
  const downloadUrl = useRef(version.docx.url);
  downloadUrl.current = version.docx.url;
  const [blocks, setBlocks] = useState<ProposalBlock[] | null>(null);
  const [draft, setDraft] = useState<ProposalMapping | null>(null);
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof proposalsApi.catalog>> | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(downloadUrl.current).then((response) => {
        if (!response.ok) throw new Error("The proposal file could not be downloaded.");
        return response.blob();
      }).then(parseProposalDocx),
      proposalsApi.mapping(id), proposalsApi.previousMapping(id), proposalsApi.catalog(id),
    ]).then(([parsed, saved, previous, choices]) => {
      if (!active) return;
      setBlocks(parsed);
      setDraft(saved?.versionId === version.id ? saved : carryPreviousProposalReview(extractProposalTemplate(parsed, version.id), previous));
      setCatalog(choices);
    }).catch((cause) => { if (active) setError((cause as Error).message); });
    return () => { active = false; };
  }, [id, version.id]);
  if (error && !draft) return <p role="alert" className="error-message">{error}</p>;
  if (!blocks || !draft || !catalog) return <LoadingSkeleton />;
  const patchLine = (index: number, patch: Partial<ProposalLine>) =>
    setDraft({ ...draft, lines: draft.lines.map((line, at) => at === index ? { ...line, ...patch } : line) });
  const sourceSelect = (value: string | null, onChange: (next: string | null) => void) => (
    <span className="proposal-source-picker"><select aria-label="Source paragraph" value={value ?? ""} disabled={!canWrite} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Manual entry</option>
      {blocks.map((block) => <option key={block.id} value={block.id}>{block.id}: {block.text.slice(0, 70)}</option>)}
    </select>{value && <button type="button" onClick={() => document.getElementById(value)?.scrollIntoView({ behavior: "smooth" })}>View source</button>}</span>
  );
  const pointed = new Set([
    ...Object.values(draft.fields).map((field) => field.sourceBlockId),
    ...draft.lines.map((line) => line.sourceBlockId),
    ...draft.staffing.map((line) => line.sourceBlockId),
    ...draft.timeline.map((line) => line.sourceBlockId),
    ...draft.charges.map((line) => line.sourceBlockId),
    ...draft.paymentSchedule.map((line) => line.sourceBlockId),
  ]);
  const unextracted = blocks.filter((block) => !pointed.has(block.id));
  const listSection = (key: "timeline" | "charges" | "paymentSchedule", title: string) => (
    <section><h4>{title}</h4>
      {draft[key].map((entry, index) => <div className="proposal-review-entry" key={index}>
        <input aria-label={`${title} ${index + 1}`} value={entry.value} disabled={!canWrite} onChange={(e) => setDraft({ ...draft, [key]: draft[key].map((line, at) => at === index ? { ...line, value: e.target.value } : line) })} />
        {sourceSelect(entry.sourceBlockId, (sourceBlockId) => setDraft({ ...draft, [key]: draft[key].map((line, at) => at === index ? { ...line, sourceBlockId } : line) }))}
        {canWrite && <Button variant="outline" onClick={() => setDraft({ ...draft, [key]: draft[key].filter((_, at) => at !== index) })}>Remove</Button>}
      </div>)}
      {canWrite && <Button variant="outline" onClick={() => setDraft({ ...draft, [key]: [...draft[key], { value: "", sourceBlockId: null }] })}>Add {title.toLowerCase()} line</Button>}
    </section>
  );
  return <div className="proposal-review">
    <section className="proposal-document" aria-label="Proposal document">
      <h3>Document</h3>
      {blocks.map((block) => <div key={block.id} id={block.id} className={`proposal-source ${pointed.has(block.id) ? "extracted" : "not-extracted"}`}>
        <small>{block.id} · {pointed.has(block.id) ? "Mapped" : "Not extracted"}</small>
        {block.kind === "heading" ? <h4>{block.text}</h4> : <p>{block.text}</p>}
      </div>)}
    </section>
    <div className="proposal-review-values">
      <h3>Review and map</h3>
      <p className="muted">Confirm each value against the document. Add lines that were not extracted.</p>
      {error && <p role="alert" className="error-message">{error}</p>}
      <FormField label="Proposal total (USD) *"><input aria-label="Proposal total (USD) *" type="number" min="0" step="0.01" value={draft.totalCents === null ? "" : (draft.totalCents / 100).toFixed(2)} disabled={!canWrite} onChange={(e) => setDraft({ ...draft, totalCents: e.target.value === "" ? null : Math.round(Number(e.target.value) * 100) })} /></FormField>
      <section><h4>Event details</h4>
        {Object.entries(fieldLabels).map(([key, label]) => <div className="proposal-review-entry" key={key}>
          <FormField label={label}><input value={draft.fields[key]?.value ?? ""} disabled={!canWrite} onChange={(e) => setDraft({ ...draft, fields: { ...draft.fields, [key]: { value: e.target.value, sourceBlockId: draft.fields[key]?.sourceBlockId ?? null } } })} /></FormField>
          {sourceSelect(draft.fields[key]?.sourceBlockId ?? null, (sourceBlockId) => setDraft({ ...draft, fields: { ...draft.fields, [key]: { value: draft.fields[key]?.value ?? "", sourceBlockId } } }))}
        </div>)}
      </section>
      <section><h4>Menu, rentals, decor, services and supplies</h4>
        {draft.lines.map((line, index) => {
          const choices = line.kind === "menu" ? catalog.recipes : catalog.items.filter((item) =>
            item.kind === (line.kind === "service" ? "service" : line.kind === "supply" ? "consumable" : "rental") &&
            (line.kind !== "supply" || item.subtype === "supply"),
          );
          const suggested = suggestCatalog(line.name, choices);
          return <div className="proposal-mapping-line" key={line.id}>
            <select aria-label="Line kind" value={line.kind} disabled={!canWrite} onChange={(e) => patchLine(index, { kind: e.target.value as ProposalLine["kind"], catalogId: null })}>{proposalLineKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select>
            <input aria-label="Section" placeholder="Section (for example, Mains)" value={line.section} disabled={!canWrite} onChange={(e) => patchLine(index, { section: e.target.value })} />
            <input aria-label="Line name" placeholder="Item name" value={line.name} disabled={!canWrite} onChange={(e) => patchLine(index, { name: e.target.value })} />
            <input aria-label="Notes" placeholder="Notes" value={line.notes} disabled={!canWrite} onChange={(e) => patchLine(index, { notes: e.target.value })} />
            <input aria-label="Planned quantity" type="number" min="0" value={line.quantity ?? ""} disabled={!canWrite} onChange={(e) => patchLine(index, { quantity: e.target.value ? Number(e.target.value) : null })} />
            {sourceSelect(line.sourceBlockId, (sourceBlockId) => patchLine(index, { sourceBlockId }))}
            <select aria-label={`Catalog match for ${line.name || "new line"}`} value={line.catalogId ?? ""} disabled={!canWrite || line.notTracked} onChange={(e) => patchLine(index, { catalogId: e.target.value || null })}>
              <option value="">Choose a match…</option>
              {suggested.map((item) => <option key={item.id} value={item.id}>Suggested: {item.name}</option>)}
              {choices.filter((item) => !suggested.some((match) => match.id === item.id)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <label><input type="checkbox" checked={line.notTracked} disabled={!canWrite} onChange={(e) => patchLine(index, { notTracked: e.target.checked, catalogId: null })} /> Not tracked</label>
            {canWrite && <Button variant="outline" onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, at) => at !== index) })}>Remove line</Button>}
          </div>;
        })}
        {canWrite && <Button variant="outline" onClick={() => setDraft({ ...draft, lines: [...draft.lines, newLine(guestCount)] })}>Add line</Button>}
      </section>
      <section><h4>Staffing</h4>
        {draft.staffing.map((line, index) => <div className="proposal-review-entry" key={index}>
          <input aria-label="Staff position" placeholder="Position" value={line.position} disabled={!canWrite} onChange={(e) => setDraft({ ...draft, staffing: draft.staffing.map((item, at) => at === index ? { ...item, position: e.target.value } : item) })} />
          <input aria-label="Staff count" type="number" min="1" max="30" value={line.count} disabled={!canWrite} onChange={(e) => setDraft({ ...draft, staffing: draft.staffing.map((item, at) => at === index ? { ...item, count: Number(e.target.value) } : item) })} />
          {sourceSelect(line.sourceBlockId, (sourceBlockId) => setDraft({ ...draft, staffing: draft.staffing.map((item, at) => at === index ? { ...item, sourceBlockId } : item) }))}
          {canWrite && <Button variant="outline" onClick={() => setDraft({ ...draft, staffing: draft.staffing.filter((_, at) => at !== index) })}>Remove</Button>}
        </div>)}
        {canWrite && <Button variant="outline" onClick={() => setDraft({ ...draft, staffing: [...draft.staffing, { position: "", count: 1, sourceBlockId: null }] })}>Add staffing line</Button>}
      </section>
      {listSection("timeline", "Timeline")}
      {listSection("charges", "Charges and totals")}
      {listSection("paymentSchedule", "Payment schedule")}
      <section><h4>Not extracted</h4><ul>{unextracted.map((block) => <li key={block.id}><a href={`#${block.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(block.id)?.scrollIntoView({ behavior: "smooth" }); }}>{block.text.slice(0, 120)}</a></li>)}</ul></section>
      {canWrite && <Button disabled={saving} onClick={async () => {
        setSaving(true); setError("");
        try {
          const saved = await proposalsApi.saveMapping(id, { ...draft, unextractedBlockIds: unextracted.map((block) => block.id) });
          setDraft(saved);
          queryClient.setQueryData(["proposal-mapping", id, version.number], saved);
          await proposalsApi.submit(id);
          onSubmitted?.();
        }
        catch (cause) { setError((cause as Error).message); }
        finally { setSaving(false); }
      }}>Submit for approval</Button>}
    </div>
  </div>;
}
