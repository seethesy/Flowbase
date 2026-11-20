import { useState, type ReactNode } from "react";
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
import { RoundCheck } from "../components/ui/round-check";
import { T } from "../app/copy";

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
      <Section title={<T id="event-proposals.event-proposals-section.proposals">Proposals</T>}>
        <LoadError message={list.error} />
      </Section>
    );
  if (!list.data) return <LoadingSkeleton />;
  return (
    <Section
      title={<T id="event-proposals.event-proposals-section.proposals">Proposals</T>}
      action={
        canWrite && (
          <Button variant="outline" onClick={() => setCreating(true)}>
            <Plus size={14} />
            <T id="event-proposals.event-proposals-section.new-proposal">New proposal</T>
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
        <p className="muted"><T id="event-proposals.event-proposals-section.no-proposals-yet">No proposals yet.</T></p>
      )}
      {list.data.filter((proposal) => proposal.currentVersion).map((proposal) => (
        <EventProposalPlan key={proposal.id} proposal={proposal} />
      ))}
      {contracts.data && contracts.data.length > 0 && <section><h3><T id="event-proposals.event-proposals-section.signed-contracts">Signed contracts</T></h3><ul>{contracts.data.map((contract) => <li key={contract.id}><T id="event-proposals.event-proposals-section.and" values={{ stamp: stamp(contract.signedAt), clientSigner: contract.clientSigner, salespersonSigner: contract.salespersonSigner }}>{"{stamp} · {clientSigner} and {salespersonSigner}"}</T></li>)}</ul></section>}
      {addendums.data && addendums.data.length > 0 && <section aria-label="Addendums"><h3><T id="event-proposals.event-proposals-section.addendums">Addendums</T></h3><ul>{addendums.data.map((addendum) => <li key={addendum.id}>{addendum.signedAt ? <T id="event-proposals.event-proposals-section.signed" values={{ stamp: stamp(addendum.signedAt) }}>{"Signed {stamp}"}</T> : <T id="event-proposals.event-proposals-section.open-sent" values={{ stamp: stamp(addendum.sentAt) }}>{"Open · sent {stamp}"}</T>} · <Link to={`?proposal=${addendum.proposalId}`}><T id="event-proposals.event-proposals-section.proposal-version" values={{ proposalVersionId: addendum.proposalVersionId }}>{"Proposal version {proposalVersionId}"}</T></Link><T id="event-proposals.event-proposals-section.change-log-entries" values={{ count: addendum.changeIds.length }}>{" · {count} change log entries "}</T>{can("addendums.record") && !addendum.signedAt && <SignAddendum eventId={event.id} addendumId={addendum.id} onSigned={() => addendums.reload()} />}</li>)}</ul></section>}
      {creating && (
        <ProposalForm
          heading={<T id="event-proposals.event-proposals-section.new-proposal">New proposal</T>}
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
  }}><input aria-label="Addendum signed date" type="date" required value={date} onChange={(event) => setDate(event.target.value)} /><Button type="submit"><T id="event-proposals.sign-addendum.record-signed">Record signed</T></Button>{error && <p role="alert">{error}</p>}</form>;
}

function EventProposalPlan({ proposal }: { proposal: Proposal }) {
  const mapping = useResource(["proposal-mapping", proposal.id, proposal.currentVersion], () => proposalsApi.mapping(proposal.id));
  if (!mapping.data) return null;
  const plan = mapping.data;
  return <section className="event-proposal-plan" aria-label={`${proposal.title} plan`}>
    <h3><T id="event-proposals.event-proposal-plan.plan" values={{ title: proposal.title }}>{"{title} plan"}</T></h3>
    <div className="proposal-plan-grid">
      <div><strong><T id="event-proposals.event-proposal-plan.menu">Menu</T></strong><ul>{plan.lines.filter((line) => line.kind === "menu").map((line) => <li key={line.id}>{line.section && `${line.section}: `}{line.name}{line.quantity !== null && ` · ${line.quantity}`}{line.notes && ` · ${line.notes}`}</li>)}</ul></div>
      <div><strong><T id="event-proposals.event-proposal-plan.rentals-decor-and-services">Rentals, decor and services</T></strong><ul>{plan.lines.filter((line) => ["rental", "decor", "service"].includes(line.kind)).map((line) => <li key={line.id}>{line.name}{line.quantity !== null && ` · ${line.quantity}`}</li>)}</ul></div>
      <div><strong><T id="event-proposals.event-proposal-plan.staffing-slots">Staffing slots</T></strong><ul>{plan.staffing.map((line, index) => <li key={index}>{line.count} {line.position}</li>)}</ul></div>
      <div><strong><T id="event-proposals.event-proposal-plan.payment-schedule">Payment schedule</T></strong><ul>{plan.paymentSchedule.map((line, index) => <li key={index}>{line.value}</li>)}</ul></div>
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
          {proposal.assignedSalesperson?.name || <T id="event-proposals.proposal-row.no-salesperson">No salesperson</T>} ·{" "}
          {proposal.currentVersion
            ? <T id="event-proposals.proposal-row.version" values={{ currentVersion: proposal.currentVersion }}>{"Version {currentVersion}"}</T>
            : <T id="event-proposals.proposal-row.no-version-yet">No version yet</T>}
        </small>
      </span>
      <span className="badge neutral">{proposalStageLabels[proposal.stage]}</span>
      <Button variant="outline" onClick={onOpen}>
        <T id="event-proposals.proposal-row.open">Open</T>
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
  heading: ReactNode;
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
      description={<T id="event-proposals.proposal-form.the-proposal-itself-is-written">The proposal itself is written in Google Docs; Flowbase tracks its stages and versions.</T>}
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
        <FormField label={<T id="event-proposals.proposal-form.title">Title *</T>}>
          <input
            value={draft.title}
            maxLength={200}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </FormField>
        <FormField label={<T id="event-proposals.proposal-form.notes">Notes</T>}>
          <textarea
            value={draft.notes}
            maxLength={5000}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
        </FormField>
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={onClose}>
            <T id="event-proposals.proposal-form.cancel">Cancel</T>
          </Button>
          <Button type="submit"><T id="event-proposals.proposal-form.save-proposal">Save proposal</T></Button>
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
      description={<T id="event-proposals.proposal-drawer.stages-after-revisions-are-set">Stages after Revisions are set by uploading, approving, sending and booking the proposal.</T>}
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
                  <small><T id="event-proposals.proposal-drawer.stage">Stage</T></small>
                  <strong>{proposalStageLabels[p.stage]}</strong>
                </div>
                <div>
                  <small><T id="event-proposals.proposal-drawer.salesperson">Salesperson</T></small>
                  <strong>{p.assignedSalesperson?.name || "—"}</strong>
                </div>
                <div>
                  <small><T id="event-proposals.proposal-drawer.current-version">Current version</T></small>
                  <strong>
                    {p.currentVersion ? <T id="event-proposals.proposal-drawer.version" values={{ currentVersion: p.currentVersion }}>{"Version {currentVersion}"}</T> : <T id="event-proposals.proposal-drawer.none-yet">None yet</T>}
                  </strong>
                </div>
              </div>
              {p.stage === "lost" && (
                <p className="demo-callout"><T id="event-proposals.proposal-drawer.lost" values={{ lostReason: p.lostReason }}>{"Lost: {lostReason}"}</T></p>
              )}
              {p.approval && <p><T id="event-proposals.proposal-drawer.current-version-approval" values={{ status: p.approval.status }}>{"Current version approval: {status}"}</T></p>}
              {p.sentAt && <p><T id="event-proposals.proposal-drawer.sent-by" values={{ stamp: stamp(p.sentAt), sentMethod: p.sentMethod }}>{"Sent {stamp} by {sentMethod}"}</T></p>}
              {p.changeLog.length > 0 && <section aria-label="Proposal change log"><h3><T id="event-proposals.proposal-drawer.change-log">Change log</T></h3><ul>{p.changeLog.map((change) => <li key={change.id}><T id="event-proposals.proposal-drawer.version-2">{"Version "}</T>{p.versions.find((version) => version.id === change.versionId)?.number}: {change.path}: {JSON.stringify(change.oldValue)} → {JSON.stringify(change.newValue)} · {change.actor?.name || <T id="event-proposals.proposal-drawer.someone">Someone</T>} · {stamp(change.at)}</li>)}</ul></section>}
              {canWrite && p.stage === "approved" && p.approval?.status === "approved" && (
                <form onSubmit={(e) => { e.preventDefault(); void run(() => proposalsApi.recordSent(id, { sentAt: new Date(`${sentAt}T12:00:00`).toISOString(), method: sentMethod })); }}>
                  <FormField label={<T id="event-proposals.proposal-drawer.sent-date">Sent date</T>}><input type="date" required value={sentAt} onChange={(e) => setSentAt(e.target.value)} /></FormField>
                  <FormField label={<T id="event-proposals.proposal-drawer.method">Method</T>}><select value={sentMethod} onChange={(e) => setSentMethod(e.target.value as typeof sentMethod)}><option value="email">Email</option><option value="google_docs">Google Docs</option><option value="other">Other</option></select></FormField>
                  <Button type="submit" disabled={busy}><T id="event-proposals.proposal-drawer.record-as-sent">Record as sent</T></Button>
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
              }}><h3><T id="event-proposals.proposal-drawer.record-signed-contract">Record signed contract</T></h3>
                <FormField label={<T id="event-proposals.proposal-drawer.client-signed-date">Client signed date</T>}><input type="date" required value={contractDate} onChange={(e) => setContractDate(e.target.value)} /></FormField>
                <FormField label={<T id="event-proposals.proposal-drawer.client-signer">Client signer</T>}><input required value={clientSigner} onChange={(e) => setClientSigner(e.target.value)} /></FormField>
                <FormField label={<T id="event-proposals.proposal-drawer.salesperson-signer">Salesperson signer</T>}><input required value={salespersonSigner} onChange={(e) => setSalespersonSigner(e.target.value)} /></FormField>
                <label><RoundCheck checked={cardOnFile} onChange={(e) => { setCardOnFile(e.target.checked); if (!e.target.checked) setCardLast4(""); }} /><T id="event-proposals.proposal-drawer.card-on-file">{" Card on file"}</T></label>
                {cardOnFile && <FormField label={<T id="event-proposals.proposal-drawer.card-last-4">Card last 4</T>}><input inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={cardLast4} onChange={(e) => setCardLast4(e.target.value)} /></FormField>}
                <FormField label={<T id="event-proposals.proposal-drawer.signed-contract-pdf-optional">Signed contract PDF (optional)</T>}><input type="file" accept=".pdf,application/pdf" onChange={(e) => setContractFile(e.target.files?.[0] ?? null)} /></FormField>
                {contractFile && <label><RoundCheck checked={noFullCard} onChange={(e) => setNoFullCard(e.target.checked)} /><T id="event-proposals.proposal-drawer.i-confirm-the-pdf-shows">{" I confirm the PDF shows no full card number"}</T></label>}
                <Button type="submit" disabled={busy || Boolean(contractFile && !noFullCard)}><T id="event-proposals.proposal-drawer.record-booking">Record booking</T></Button>
              </form>}
              {canWrite && p.approval?.status === "approved" && (p.stage === "sent" || p.stage === "signed") && p.currentVersion && p.changeLog.some((change) => change.versionId === currentVersion?.id) && <section><h3><T id="event-proposals.proposal-drawer.addendum">Addendum</T></h3>
                <Button variant="outline" onClick={() => setNewAddendum(!newAddendum)}><T id="event-proposals.proposal-drawer.record-addendum-sent">Record addendum sent</T></Button>
                {newAddendum && <form onSubmit={async (e) => {
                  e.preventDefault(); setError(""); setBusy(true);
                  try { await proposalsApi.recordAddendum(p.eventId, { proposalVersionId: currentVersion!.id, changeIds: addendumChanges, sentAt: new Date(`${addendumDate}T12:00:00Z`).toISOString() }); setNewAddendum(false); onChanged(); }
                  catch (cause) { setError((cause as Error).message); }
                  finally { setBusy(false); }
                }}><FormField label={<T id="event-proposals.proposal-drawer.sent-date">Sent date</T>}><input type="date" required value={addendumDate} onChange={(e) => setAddendumDate(e.target.value)} /></FormField>
                  {p.changeLog.filter((change) => change.versionId === currentVersion?.id).map((change) => <label key={change.id}><RoundCheck checked={addendumChanges.includes(change.id)} onChange={(e) => setAddendumChanges(e.target.checked ? [...addendumChanges, change.id] : addendumChanges.filter((id) => id !== change.id))} /> {change.path}: {JSON.stringify(change.oldValue)} → {JSON.stringify(change.newValue)}</label>)}
                  <Button type="submit" disabled={busy || !addendumChanges.length}><T id="event-proposals.proposal-drawer.save-addendum">Save addendum</T></Button>
                </form>}
              </section>}
              <small><T id="event-proposals.proposal-drawer.notes">Notes</T></small>
              <p>{p.notes || "—"}</p>
              {canWrite && (
                <div className="proposal-actions">
                  {targets.length > 0 && (
                    <FormField label={<T id="event-proposals.proposal-drawer.move-to-stage">Move to stage</T>}>
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
                    <FormField label={<T id="event-proposals.proposal-drawer.upload-version-docx-optional-pdf">Upload version (.docx, optional PDF)</T>}>
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
                    <T id="event-proposals.proposal-drawer.edit-details">Edit details</T>
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
                    <T id="event-proposals.proposal-drawer.marking-this-proposal-lost-is">Marking this proposal Lost is final. If the event has no other open or signed proposal, the event moves to Lost too.</T>
                  </p>
                  <FormField label={<T id="event-proposals.proposal-drawer.why-was-it-lost">Why was it lost? *</T>}>
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
                      <T id="event-proposals.proposal-drawer.cancel">Cancel</T>
                    </Button>
                    <Button variant="destructive" disabled={busy}>
                      <T id="event-proposals.proposal-drawer.mark-lost">Mark lost</T>
                    </Button>
                  </div>
                </form>
              )}
              <h3 className="spaced">
                <Upload size={14} aria-hidden /><T id="event-proposals.proposal-drawer.versions">{" Versions"}</T>
              </h3>
              {p.versions.length ? (
                <ul className="proposal-versions" aria-label="Versions">
                  {p.versions.map((version) => (
                    <li key={version.id}>
                      <strong>
                        <T id="event-proposals.proposal-drawer.version-3" values={{ number: version.number }}>{"Version {number}"}</T>
                        {version.current && <T id="event-proposals.proposal-drawer.current">{" (current)"}</T>}
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
                        {version.uploadedBy?.name || <T id="event-proposals.proposal-drawer.someone">Someone</T>} ·{" "}
                        {stamp(version.uploadedAt)}
                      </small>
                      {version.sentAt && <small><T id="event-proposals.proposal-drawer.sent-by" values={{ stamp: stamp(version.sentAt), sentMethod: version.sentMethod }}>{"Sent {stamp} by {sentMethod}"}</T></small>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted"><T id="event-proposals.proposal-drawer.no-versions-uploaded-yet">No versions uploaded yet.</T></p>
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
              <h3 className="spaced"><T id="event-proposals.proposal-drawer.stage-history">Stage history</T></h3>
              <ul className="proposal-history" aria-label="Stage history">
                {p.history.map((change) => (
                  <li key={change.id}>
                    <strong>
                      {change.from
                        ? `${proposalStageLabels[change.from]} → ${proposalStageLabels[change.to]}`
                        : <T id="event-proposals.proposal-drawer.created-in" values={{ proposalStageLabels: proposalStageLabels[change.to] }}>{"Created in {proposalStageLabels}"}</T>}
                    </strong>
                    <small>
                      {change.actor?.name || <T id="event-proposals.proposal-drawer.system">System</T>} · {stamp(change.at)}
                      {change.reason && ` · ${change.reason}`}
                    </small>
                  </li>
                ))}
              </ul>
              {editing && (
                <ProposalForm
                  heading={<T id="event-proposals.proposal-drawer.edit-proposal">Edit proposal</T>}
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
