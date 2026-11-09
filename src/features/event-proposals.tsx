import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FileText, Plus, Upload } from "lucide-react";
import type { FlowEvent } from "../../shared/core-records";
import {
  manualProposalTargets,
  proposalStageLabels,
  uploadableProposalStages,
  type ManualProposalTarget,
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
import { uploadAttachment } from "../services/attachments";
import { ProposalReview } from "./proposal-review";
import "./event-proposals.css";

// The event's proposals (FLOW-122) on the event hub: each one's stage, salesperson
// and current version, and a drawer to move its stage, upload a new version
// (FLOW-123) and read its versions and stage history. The open drawer is
// ?proposal=<id> in the address, so time spent in it is credited to that proposal
// (FLOW-167).

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
  const contracts = useResource(["event-contracts", event.id], () => proposalsApi.contracts(event.id));
  const addendums = useResource(["event-addendums", event.id], () => proposalsApi.addendums(event.id));
  const { can } = usePermissions();
  const [creating, setCreating] = useState(false);
  const [params, setParams] = useSearchParams();
  const open = params.get("proposal");
  const setOpen = (id: string | null) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (id) next.set("proposal", id);
        else next.delete("proposal");
        return next;
      },
      { replace: true },
    );
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
      {list.data.filter((proposal) => proposal.currentVersion).map((proposal) => (
        <EventProposalPlan key={proposal.id} proposal={proposal} />
      ))}
      {contracts.data && contracts.data.length > 0 && <section><h3>Signed contracts</h3><ul>{contracts.data.map((contract) => <li key={contract.id}>{stamp(contract.signedAt)} · {contract.clientSigner} and {contract.salespersonSigner}</li>)}</ul></section>}
      {addendums.data && addendums.data.length > 0 && <section aria-label="Addendums"><h3>Addendums</h3><ul>{addendums.data.map((addendum) => <li key={addendum.id}>{addendum.signedAt ? `Signed ${stamp(addendum.signedAt)}` : `Open · sent ${stamp(addendum.sentAt)}`} · <Link to={`?proposal=${addendum.proposalId}`}>Proposal version {addendum.proposalVersionId}</Link> · {addendum.changeIds.length} change log entries {can("addendums.record") && !addendum.signedAt && <SignAddendum eventId={event.id} addendumId={addendum.id} onSigned={() => addendums.reload()} />}</li>)}</ul></section>}
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
          guestCount={event.guestCount}
          canWrite={canWrite}
          onChanged={() => {
            list.reload();
            contracts.reload();
            addendums.reload();
            onEventChanged();
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </Section>
  );
}

function SignAddendum({ eventId, addendumId, onSigned }: { eventId: string; addendumId: string; onSigned: () => void }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState("");
  return <form onSubmit={async (event) => {
    event.preventDefault();
    try { setError(""); await proposalsApi.signAddendum(eventId, addendumId, new Date(`${date}T12:00:00Z`).toISOString()); onSigned(); }
    catch (cause) { setError((cause as Error).message); }
  }}><input aria-label="Addendum signed date" type="date" required value={date} onChange={(event) => setDate(event.target.value)} /><Button type="submit">Record signed</Button>{error && <p role="alert">{error}</p>}</form>;
}

function EventProposalPlan({ proposal }: { proposal: Proposal }) {
  const mapping = useResource(["proposal-mapping", proposal.id, proposal.currentVersion], () => proposalsApi.mapping(proposal.id));
  if (!mapping.data) return null;
  const plan = mapping.data;
  return <section className="event-proposal-plan" aria-label={`${proposal.title} plan`}>
    <h3>{proposal.title} plan</h3>
    <div className="proposal-plan-grid">
      <div><strong>Menu</strong><ul>{plan.lines.filter((line) => line.kind === "menu").map((line) => <li key={line.id}>{line.section && `${line.section}: `}{line.name}{line.quantity !== null && ` · ${line.quantity}`}{line.notes && ` · ${line.notes}`}</li>)}</ul></div>
      <div><strong>Rentals, decor and services</strong><ul>{plan.lines.filter((line) => ["rental", "decor", "service"].includes(line.kind)).map((line) => <li key={line.id}>{line.name}{line.quantity !== null && ` · ${line.quantity}`}</li>)}</ul></div>
      <div><strong>Staffing slots</strong><ul>{plan.staffing.map((line, index) => <li key={index}>{line.count} {line.position}</li>)}</ul></div>
      <div><strong>Payment schedule</strong><ul>{plan.paymentSchedule.map((line, index) => <li key={index}>{line.value}</li>)}</ul></div>
    </div>
  </section>;
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
  guestCount,
  canWrite,
  onChanged,
  onClose,
}: {
  id: string;
  guestCount: number | null;
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
  const [sentAt, setSentAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [sentMethod, setSentMethod] = useState<"email" | "google_docs" | "other">("email");
  const [contractDate, setContractDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [clientSigner, setClientSigner] = useState("");
  const [salespersonSigner, setSalespersonSigner] = useState("");
  const [cardOnFile, setCardOnFile] = useState(false);
  const [cardLast4, setCardLast4] = useState("");
  const [contractFile, setContractFile] = useState<File | null>(null);
  const [noFullCard, setNoFullCard] = useState(false);
  const [addendumDate, setAddendumDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [addendumChanges, setAddendumChanges] = useState<string[]>([]);
  const [newAddendum, setNewAddendum] = useState(false);
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
          const currentVersion = p.versions.find((version) => version.current);
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
              {p.approval && <p>Current version approval: {p.approval.status}</p>}
              {p.sentAt && <p>Sent {stamp(p.sentAt)} by {p.sentMethod}</p>}
              {p.changeLog.length > 0 && <section aria-label="Proposal change log"><h3>Change log</h3><ul>{p.changeLog.map((change) => <li key={change.id}>Version {p.versions.find((version) => version.id === change.versionId)?.number}: {change.path}: {JSON.stringify(change.oldValue)} → {JSON.stringify(change.newValue)} · {change.actor?.name || "Someone"} · {stamp(change.at)}</li>)}</ul></section>}
              {canWrite && p.stage === "approved" && p.approval?.status === "approved" && (
                <form onSubmit={(e) => { e.preventDefault(); void run(() => proposalsApi.recordSent(id, { sentAt: new Date(`${sentAt}T12:00:00`).toISOString(), method: sentMethod })); }}>
                  <FormField label="Sent date"><input type="date" required value={sentAt} onChange={(e) => setSentAt(e.target.value)} /></FormField>
                  <FormField label="Method"><select value={sentMethod} onChange={(e) => setSentMethod(e.target.value as typeof sentMethod)}><option value="email">Email</option><option value="google_docs">Google Docs</option><option value="other">Other</option></select></FormField>
                  <Button type="submit" disabled={busy}>Record as sent</Button>
                </form>
              )}
              {canWrite && p.stage === "sent" && <form onSubmit={async (e) => {
                e.preventDefault();
                if (contractFile && !noFullCard) return setError("Confirm the PDF shows no full card number.");
                if (cardLast4 && !/^\d{4}$/.test(cardLast4)) return setError("Enter exactly four digits.");
                setError(""); setBusy(true);
                try {
                  const attachment = contractFile ? await uploadAttachment(contractFile, { recordType: "event", recordId: p.eventId, group: "contract" }) : null;
                  await proposalsApi.recordContract(id, {
                    signedAt: new Date(`${contractDate}T12:00:00Z`).toISOString(), clientSigner, salespersonSigner,
                    cardOnFile, cardLast4: cardLast4 || null, attachmentId: attachment?.id ?? null,
                    noFullCardNumberConfirmed: noFullCard,
                  });
                  detail.reload(); onChanged();
                } catch (cause) { setError((cause as Error).message); }
                finally { setBusy(false); }
              }}><h3>Record signed contract</h3>
                <FormField label="Client signed date"><input type="date" required value={contractDate} onChange={(e) => setContractDate(e.target.value)} /></FormField>
                <FormField label="Client signer"><input required value={clientSigner} onChange={(e) => setClientSigner(e.target.value)} /></FormField>
                <FormField label="Salesperson signer"><input required value={salespersonSigner} onChange={(e) => setSalespersonSigner(e.target.value)} /></FormField>
                <label><input type="checkbox" checked={cardOnFile} onChange={(e) => { setCardOnFile(e.target.checked); if (!e.target.checked) setCardLast4(""); }} /> Card on file</label>
                {cardOnFile && <FormField label="Card last 4"><input inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={cardLast4} onChange={(e) => setCardLast4(e.target.value)} /></FormField>}
                <FormField label="Signed contract PDF (optional)"><input type="file" accept=".pdf,application/pdf" onChange={(e) => setContractFile(e.target.files?.[0] ?? null)} /></FormField>
                {contractFile && <label><input type="checkbox" checked={noFullCard} onChange={(e) => setNoFullCard(e.target.checked)} /> I confirm the PDF shows no full card number</label>}
                <Button type="submit" disabled={busy || Boolean(contractFile && !noFullCard)}>Record booking</Button>
              </form>}
              {canWrite && p.approval?.status === "approved" && (p.stage === "sent" || p.stage === "signed") && p.currentVersion && p.changeLog.some((change) => change.versionId === currentVersion?.id) && <section><h3>Addendum</h3>
                <Button variant="outline" onClick={() => setNewAddendum(!newAddendum)}>Record addendum sent</Button>
                {newAddendum && <form onSubmit={async (e) => {
                  e.preventDefault(); setError(""); setBusy(true);
                  try { await proposalsApi.recordAddendum(p.eventId, { proposalVersionId: currentVersion!.id, changeIds: addendumChanges, sentAt: new Date(`${addendumDate}T12:00:00Z`).toISOString() }); setNewAddendum(false); onChanged(); }
                  catch (cause) { setError((cause as Error).message); }
                  finally { setBusy(false); }
                }}><FormField label="Sent date"><input type="date" required value={addendumDate} onChange={(e) => setAddendumDate(e.target.value)} /></FormField>
                  {p.changeLog.filter((change) => change.versionId === currentVersion?.id).map((change) => <label key={change.id}><input type="checkbox" checked={addendumChanges.includes(change.id)} onChange={(e) => setAddendumChanges(e.target.checked ? [...addendumChanges, change.id] : addendumChanges.filter((id) => id !== change.id))} /> {change.path}: {JSON.stringify(change.oldValue)} → {JSON.stringify(change.newValue)}</label>)}
                  <Button type="submit" disabled={busy || !addendumChanges.length}>Save addendum</Button>
                </form>}
              </section>}
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
                          const stage = e.target.value as ManualProposalTarget | "";
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
                      {version.sentAt && <small>Sent {stamp(version.sentAt)} by {version.sentMethod}</small>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No versions uploaded yet.</p>
              )}
              {currentVersion && (
                <ProposalReview
                  key={currentVersion.id}
                  id={id}
                  version={currentVersion}
                  canWrite={canWrite && p.stage === "finalized"}
                  guestCount={guestCount}
                  onSubmitted={() => { detail.reload(); onChanged(); }}
                />
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
