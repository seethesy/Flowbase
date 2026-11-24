import { useState } from "react";
import type { FlowEvent } from "../../../shared/core-records";
import { proposalsApi, uploadProposalVersion } from "../../services/proposals";
import { Button, FormDrawer, FormField } from "../../components/shared";
import { Allowed } from "../../app/permissions";
import { T } from "../../app/copy";
import { EventPicker } from "../events/event-picker";

// New proposal on the Proposals library (FLOW-336): pick the event, then the same
// title and notes as the event's New proposal. The library lists proposal files,
// so the first version's .docx (and an optional PDF) can come with it; without a
// file the proposal shows on its event until a version is uploaded there.
export function NewProposalButton({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Allowed action="proposals.write">
      <Button onClick={() => setOpen(true)}><T id="proposals.library.new-proposal">New proposal</T></Button>
      {open && <NewProposalDrawer onClose={() => setOpen(false)} onCreated={onCreated} />}
    </Allowed>
  );
}

export function NewProposalDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [event, setEvent] = useState<FlowEvent | null>(null);
  const [draft, setDraft] = useState({ title: "", notes: "" });
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!event) return setError("Choose an event.");
    const title = draft.title.trim() || event.title;
    setSaving(true);
    setError("");
    try {
      const created = await proposalsApi.create({ eventId: event.id, title, notes: draft.notes });
      // The proposal exists from here on; a failed upload is retried on the event.
      onCreated();
      if (files.length) await uploadProposalVersion(created.id, files);
      onCreated();
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <FormDrawer
      onClose={onClose}
      title={<T id="proposals.new-proposal.title">New proposal</T>}
      description={<T id="proposals.new-proposal.description">The proposal itself is written in Google Docs; Flowbase tracks its stages and versions.</T>}
      onSubmit={save}
      error={error}
      saving={saving}
      saveLabel={<T id="proposals.new-proposal.save">Save proposal</T>}
      cancelLabel={<T id="proposals.new-proposal.cancel">Cancel</T>}
    >
      <EventPicker value={event} onChange={(next) => {
        setEvent(next);
        if (next && !draft.title) setDraft({ ...draft, title: next.title });
      }} />
      <FormField label={<T id="proposals.new-proposal.proposal-title">Title *</T>}>
        <input aria-label="Title" value={draft.title} maxLength={200} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
      </FormField>
      <FormField label={<T id="proposals.new-proposal.notes">Notes</T>}>
        <textarea aria-label="Notes" value={draft.notes} maxLength={5000} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
      </FormField>
      <FormField
        label={<T id="proposals.new-proposal.files">First version (optional)</T>}
        hint={<T id="proposals.new-proposal.files-hint">The Word (.docx) export, and a PDF if you have one. With a file the proposal is listed here.</T>}
      >
        <input aria-label="Proposal files" type="file" multiple accept=".docx,.pdf"
          onChange={(e) => setFiles([...(e.target.files ?? [])])} />
      </FormField>
    </FormDrawer>
  );
}
