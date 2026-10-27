import { useState } from "react";
import { FileText, Plus, Upload } from "lucide-react";
import type { FlowEvent } from "../../shared/core-records";
import {
  manualProposalTargets,
  proposalStageLabels,
  uploadableProposalStages,
  type Proposal,
  type ProposalDetail,
  type ProposalStage,
} from "../../shared/proposals";
import { usePermissions } from "../app/permissions";
import { useResource } from "../app/useResource";
import {
  Button,
  DetailDrawer,
  FormField,
  LoadingSkeleton,
  Section,
} from "../components/shared";
import { LoadError } from "../components/record-display";
import { proposalsApi, uploadProposalVersion } from "../services/proposals";
import "./event-proposals.css";

// The event's proposals (FLOW-122) on the event hub: each one's stage, salesperson
// and current version, and a drawer to move its stage, upload a new version
// (FLOW-123) and read its versions and stage history.

const stamp = (value: string) =>
  new Date(value).toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  });
const kilobytes = (size: number) => `${Math.max(1, Math.round(size / 1024))} KB`;

export function EventProposalsSection({
  event,
  onEventChanged,
}: {
  event: FlowEvent;
  // Losing the last open proposal moves the event to Lost (FLOW-122 AC2).
  onEventChanged: () => void;
}) {
  const list = useResource(["event-proposals", event.id], () =>
    proposalsApi.list(event.id),
  );
  const { can } = usePermissions();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const canWrite = can("proposals.write");
  if (list.error)
    return (
      <Section title="Proposals">
        <LoadError message={list.error} />
      </Section>
    );
  if (!list.data) return <LoadingSkeleton />;
  return (
    <Section
      title="Proposals"
      action={
        canWrite && (
          <Button variant="outline" onClick={() => setCreating(true)}>
            <Plus size={14} />
            New proposal
          </Button>
        )
      }
    >
      {list.data.length ? (
        <ul className="proposal-list">
          {list.data.map((proposal) => (
            <ProposalRow
              key={proposal.id}
              proposal={proposal}
              onOpen={() => setOpen(proposal.id)}
            />
          ))}
        </ul>
      ) : (
        <p className="muted">No proposals yet.</p>
      )}
      {creating && (
        <ProposalForm
          heading="New proposal"
          title={event.title}
          onClose={() => setCreating(false)}
          onSave={async (input) => {
            const created = await proposalsApi.create({
              eventId: event.id,
              ...input,
            });
            list.reload();
            setCreating(false);
            setOpen(created.id);
          }}
        />
      )}
      {open && (
        <ProposalDrawer
          id={open}
          canWrite={canWrite}
          onChanged={() => {
            list.reload();
            onEventChanged();
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </Section>
  );
}

function ProposalRow({
  proposal,
  onOpen,
}: {
  proposal: Proposal;
  onOpen: () => void;
}) {
  return (
    <li className="proposal-row" aria-label={proposal.title}>
      <FileText size={18} aria-hidden />
      <span className="proposal-row-title">
        <strong>{proposal.title}</strong>
        <small>
          {proposal.assignedSalesperson?.name || "No salesperson"} ·{" "}
          {proposal.currentVersion
            ? `Version ${proposal.currentVersion}`
            : "No version yet"}
        </small>
      </span>
      <span className="badge neutral">{proposalStageLabels[proposal.stage]}</span>
      <Button variant="outline" onClick={onOpen}>
        Open
      </Button>
    </li>
  );
}

function ProposalForm({
  heading,
  title,
  notes = "",
  onClose,
  onSave,
}: {
  heading: string;
  title: string;
  notes?: string;
  onClose: () => void;
  onSave: (input: { title: string; notes: string }) => Promise<void>;
}) {
  const [draft, setDraft] = useState({ title, notes });
  const [error, setError] = useState("");
  return (
    <DetailDrawer
      open
      onClose={onClose}
      title={heading}
      description="The proposal itself is written in Google Docs; Flowbase tracks its stages and versions."
    >
      <form
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (!draft.title.trim()) return setError("Title is required.");
          try {
            setError("");
            await onSave(draft);
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <FormField label="Title *">
          <input
            value={draft.title}
            maxLength={200}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </FormField>
        <FormField label="Notes">
          <textarea
            value={draft.notes}
            maxLength={5000}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
        </FormField>
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Save proposal</Button>
        </div>
      </form>
    </DetailDrawer>
  );
}

function ProposalDrawer({
  id,
  canWrite,
  onChanged,
  onClose,
}: {
  id: string;
  canWrite: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const detail = useResource(["proposal", id], () => proposalsApi.get(id), {
    // Download links expire; renew them before they do.
    expiresAt: (data) => data.urlsExpireAt,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [losing, setLosing] = useState(false);
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState(false);
  const run = async (change: () => Promise<ProposalDetail>) => {
    setError("");
    setBusy(true);
    try {
      detail.replace(await change());
      onChanged();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const title = detail.data?.title ?? "Proposal";
  return (
    <DetailDrawer
      open
      wide
      onClose={onClose}
      title={title}
      description="Stages after Revisions are set by uploading, approving, sending and booking the proposal."
    >
      {detail.error && <LoadError message={detail.error} />}
      {!detail.data && !detail.error && <LoadingSkeleton />}
      {detail.data &&
        (() => {
          const p = detail.data;
          const targets = manualProposalTargets(p.stage);
          const mayUpload = (
            uploadableProposalStages as readonly ProposalStage[]
          ).includes(p.stage);
          return (
            <div className="proposal-detail">
              {error && (
                <p role="alert" className="error-message">
                  {error}
                </p>
              )}
              <div className="info-grid">
                <div>
                  <small>Stage</small>
                  <strong>{proposalStageLabels[p.stage]}</strong>
                </div>
                <div>
                  <small>Salesperson</small>
                  <strong>{p.assignedSalesperson?.name || "—"}</strong>
                </div>
                <div>
                  <small>Current version</small>
                  <strong>
                    {p.currentVersion ? `Version ${p.currentVersion}` : "None yet"}
                  </strong>
                </div>
              </div>
              {p.stage === "lost" && (
                <p className="demo-callout">Lost: {p.lostReason}</p>
              )}
              <small>Notes</small>
              <p>{p.notes || "—"}</p>
              {canWrite && (
                <div className="proposal-actions">
                  {targets.length > 0 && (
                    <FormField label="Move to stage">
                      <select
                        value=""
                        disabled={busy}
                        onChange={(e) => {
                          const stage = e.target.value as ProposalStage;
                          if (!stage) return;
                          if (stage === "lost") return setLosing(true);
                          void run(() =>
                            proposalsApi.changeStage(id, { stage, reason: "" }),
                          );
                        }}
                      >
                        <option value="">Choose a stage…</option>
                        {targets.map((stage) => (
                          <option key={stage} value={stage}>
                            {proposalStageLabels[stage]}
                          </option>
                        ))}
                      </select>
                    </FormField>
                  )}
                  {mayUpload && (
                    <FormField label="Upload version (.docx, optional PDF)">
                      <input
                        type="file"
                        multiple
                        disabled={busy}
                        accept=".docx,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf"
                        onChange={(e) => {
                          const files = [...(e.target.files ?? [])];
                          e.target.value = "";
                          if (files.length)
                            void run(() => uploadProposalVersion(id, files));
                        }}
                      />
                    </FormField>
                  )}
                  <Button variant="outline" onClick={() => setEditing(true)}>
                    Edit details
                  </Button>
                </div>
              )}
              {losing && (
                <form
                  className="proposal-lost"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!reason.trim())
                      return setError("Enter why the proposal was lost.");
                    if (
                      await run(() =>
                        proposalsApi.changeStage(id, { stage: "lost", reason }),
                      )
                    ) {
                      setLosing(false);
                      setReason("");
                    }
                  }}
                >
                  <p className="demo-callout">
                    Marking this proposal Lost is final. If the event has no other
                    open or signed proposal, the event moves to Lost too.
                  </p>
                  <FormField label="Why was it lost? *">
                    <textarea
                      value={reason}
                      maxLength={1000}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </FormField>
                  <div className="form-actions">
                    <Button
                      variant="outline"
                      type="button"
                      onClick={() => setLosing(false)}
                    >
                      Cancel
                    </Button>
                    <Button variant="destructive" disabled={busy}>
                      Mark lost
                    </Button>
                  </div>
                </form>
              )}
              <h3 className="spaced">
                <Upload size={14} aria-hidden /> Versions
              </h3>
              {p.versions.length ? (
                <ul className="proposal-versions" aria-label="Versions">
                  {p.versions.map((version) => (
                    <li key={version.id}>
                      <strong>
                        Version {version.number}
                        {version.current && " (current)"}
                      </strong>
                      <a href={version.docx.url} target="_blank" rel="noreferrer">
                        {version.docx.fileName}
                      </a>
                      <small>{kilobytes(version.docx.size)}</small>
                      {version.pdf && (
                        <a href={version.pdf.url} target="_blank" rel="noreferrer">
                          {version.pdf.fileName}
                        </a>
                      )}
                      <small>
                        {version.uploadedBy?.name || "Someone"} ·{" "}
                        {stamp(version.uploadedAt)}
                      </small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No versions uploaded yet.</p>
              )}
              <h3 className="spaced">Stage history</h3>
              <ul className="proposal-history" aria-label="Stage history">
                {p.history.map((change) => (
                  <li key={change.id}>
                    <strong>
                      {change.from
                        ? `${proposalStageLabels[change.from]} → ${proposalStageLabels[change.to]}`
                        : `Created in ${proposalStageLabels[change.to]}`}
                    </strong>
                    <small>
                      {change.actor?.name || "System"} · {stamp(change.at)}
                      {change.reason && ` · ${change.reason}`}
                    </small>
                  </li>
                ))}
              </ul>
              {editing && (
                <ProposalForm
                  heading="Edit proposal"
                  title={p.title}
                  notes={p.notes}
                  onClose={() => setEditing(false)}
                  onSave={async (input) => {
                    detail.replace(await proposalsApi.update(id, input));
                    onChanged();
                    setEditing(false);
                  }}
                />
              )}
            </div>
          );
        })()}
    </DetailDrawer>
  );
}
