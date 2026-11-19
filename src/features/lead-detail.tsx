import { Allowed } from "../app/permissions";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowRightLeft, TriangleAlert } from "lucide-react";
import {
  assignedElsewhereMessage,
  leadChannelLabels,
  leadDuplicateReasonLabels,
  leadStatusTransitions,
  type Lead,
  type LeadStatus,
} from "../../shared/leads";
import { leadsApi } from "../services/leads";
import { useResource } from "../app/useResource";
import { useOpenFor, useStateFor } from "../app/useOpenFor";
import {
  Button,
  Section,
  FormField,
  LoadingSkeleton,
} from "../components/shared";
import { LoadError } from "../components/record-display";
import "./leads.css";
import { ConvertLeadForm } from "./lead-convert";
import { CommunicationLog } from "./communications";
import { summaryLine } from "./lead-inbox";
import {
  AssignForm,
  businessDate,
  duration,
  eventDay,
  LeadStatusBadge,
  leadTitle,
  money,
} from "./lead-shared";
import { T } from "../app/live-copy";

const nextStep: Partial<
  Record<LeadStatus, { status: "contacted" | "qualified"; label: string }>
> = {
  new: { status: "contacted", label: "Mark contacted" },
  contacted: { status: "qualified", label: "Mark qualified" },
};

export function LeadDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const lead = useResource(
    ["leads", id],
    () => leadsApi.get(id),
  );
  const [error, setError] = useStateFor(id, "");
  const [busy, setBusy] = useState(false);
  const [losing, setLosing] = useOpenFor(id);
  const [reason, setReason] = useStateFor(id, "");
  const [convert, setConvert] = useOpenFor(id);
  const [linkClientId, setLinkClientId] = useStateFor(id, "");
  if (lead.error)
    return (
      <>
        <Link to="/leads" className="back-link">
          <T id="lead-detail.lead-detail.all-leads">← All leads</T>
        </Link>
        <LoadError message={lead.error} />
      </>
    );
  const l = lead.data;
  if (!l) return <LoadingSkeleton />;
  const moves = leadStatusTransitions[l.status];
  const move = async (status: "contacted" | "qualified" | "lost", why = "") => {
    setBusy(true);
    setError("");
    try {
      lead.replace(await leadsApi.setStatus(l.id, { status, reason: why }));
      setLosing(false);
      setReason("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const step = nextStep[l.status];
  const resolve = async (run: () => Promise<Lead | null>) => {
    setBusy(true);
    setError("");
    try {
      const kept = await run();
      if (kept && kept.id !== l.id) navigate(`/leads/${kept.id}`);
      else if (kept) lead.replace(kept);
      else lead.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const duplicates = l.duplicates ?? [];
  return (
    <>
      <Link to="/leads" className="back-link">
        <T id="lead-detail.lead-detail.all-leads">← All leads</T>
      </Link>
      <div className="record-heading">
        <div>
          <h1>{leadTitle(l)}</h1>
          <p>
            <LeadStatusBadge status={l.status} />
            {l.needsReview && (
              <span className="badge warning"><T id="lead-detail.lead-detail.needs-review">Needs review</T></span>
            )}
            {l.purchased && <span className="badge neutral"><T id="lead-detail.lead-detail.purchased">Purchased</T></span>}
          </p>
        </div>
        <div className="page-actions">
          {step && moves.includes(step.status) && (
            <Allowed action="leads.update">
              <Button disabled={busy} onClick={() => void move(step.status)}>
                {step.label}
              </Button>
            </Allowed>
          )}
          {moves.includes("lost") && (
            <Allowed action="leads.update">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setLosing(true)}
              >
                <T id="lead-detail.lead-detail.mark-lost">Mark lost</T>
              </Button>
            </Allowed>
          )}
          {l.status === "qualified" && (
            <Allowed action="leads.convert">
              <Button onClick={() => setConvert(true)}>
                <ArrowRightLeft size={14} />
                <T id="lead-detail.lead-detail.convert">Convert</T>
              </Button>
            </Allowed>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {losing && (
        <Section title={<T id="lead-detail.lead-detail.mark-lost">Mark lost</T>}>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!reason.trim())
                return setError(
                  "A reason is required when marking a lead lost.",
                );
              void move("lost", reason.trim());
            }}
          >
            <FormField label={<T id="lead-detail.lead-detail.lost-reason">Lost reason *</T>}>
              <textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </FormField>
            <div className="form-actions">
              <Button
                type="button"
                variant="outline"
                onClick={() => setLosing(false)}
              >
                <T id="lead-detail.lead-detail.cancel">Cancel</T>
              </Button>
              <Button type="submit" disabled={busy}>
                <T id="lead-detail.lead-detail.confirm-lost">Confirm lost</T>
              </Button>
            </div>
          </form>
        </Section>
      )}
      {l.assignedElsewhere && (
        <p role="note" className="demo-callout">
          <TriangleAlert size={14} /> {assignedElsewhereMessage}
        </p>
      )}
      {duplicates.length > 0 && (
        <Section title={<T id="lead-detail.lead-detail.possible-duplicates">Possible duplicates</T>}>
          <ul className="duplicate-list">
            {duplicates.map((match) => (
              <li key={match.duplicateId} className="duplicate-pair">
                <p>
                  <strong>{leadDuplicateReasonLabels[match.reason]}</strong>
                </p>
                {match.lead ? (
                  <p>
                    <Link to={`/leads/${match.lead.id}`}>
                      {match.lead.name || <T id="lead-detail.lead-detail.unnamed-lead">Unnamed lead</T>}
                    </Link>{" "}
                    <small>{summaryLine(match.lead)}</small>
                  </p>
                ) : (
                  match.client && (
                    <p>
                      <T id="lead-detail.lead-detail.client">{"Client "}</T>
                      <Link to={`/clients/${match.client.id}`}>
                        {match.client.name}
                      </Link>
                    </p>
                  )
                )}
                <div className="page-actions">
                  {match.lead && (
                    <Allowed action="leads.merge">
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void resolve(() =>
                            leadsApi.merge(match.duplicateId, l.id),
                          )
                        }
                      >
                        <T id="lead-detail.lead-detail.merge-into-this-lead">Merge into this lead</T>
                      </Button>
                    </Allowed>
                  )}
                  {match.client && l.status === "qualified" && (
                    <Allowed action="leads.convert">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setLinkClientId(match.client!.id);
                          setConvert(true);
                        }}
                      >
                        <T id="lead-detail.lead-detail.convert-and-link-to" values={{ name: match.client.name }}>{"Convert and link to {name}"}</T>
                      </Button>
                    </Allowed>
                  )}
                  <Allowed action="leads.merge">
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void resolve(() => leadsApi.dismiss(match.duplicateId))
                      }
                    >
                      <T id="lead-detail.lead-detail.not-a-duplicate">Not a duplicate</T>
                    </Button>
                  </Allowed>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {l.status === "converted" && (
        <p role="note" className="demo-callout">
          <T id="lead-detail.lead-detail.converted">{"Converted. "}</T>
          {l.convertedClientId && (
            <Link to={`/clients/${l.convertedClientId}`}><T id="lead-detail.lead-detail.view-client">View client</T></Link>
          )}{" "}
          {l.convertedEventId && (
            <Link to={`/events/${l.convertedEventId}`}><T id="lead-detail.lead-detail.view-event">View event</T></Link>
          )}
        </p>
      )}
      <div className="detail-grid">
        <Section title={<T id="lead-detail.lead-detail.contact">Contact</T>}>
          <div className="info-grid">
            <div>
              <small><T id="lead-detail.lead-detail.name">Name</T></small>
              <strong>{l.name || "—"}</strong>
            </div>
            <div>
              <small><T id="lead-detail.lead-detail.email">Email</T></small>
              <strong>{l.email || "—"}</strong>
            </div>
            <div>
              <small><T id="lead-detail.lead-detail.phone">Phone</T></small>
              <strong>{l.phone || "—"}</strong>
            </div>
          </div>
        </Section>
        <Section title={<T id="lead-detail.lead-detail.event">Event</T>}>
          <div className="info-grid">
            <div>
              <small><T id="lead-detail.lead-detail.event-date">Event date</T></small>
              <strong>{eventDay(l.eventDate)}</strong>
            </div>
            <div>
              <small><T id="lead-detail.lead-detail.guests">Guests</T></small>
              <strong>{l.guestCount ?? "—"}</strong>
            </div>
            <div>
              <small><T id="lead-detail.lead-detail.event-type">Event type</T></small>
              <strong>{l.eventType || "—"}</strong>
            </div>
            <div>
              <small><T id="lead-detail.lead-detail.location">Location</T></small>
              <strong>{l.location || "—"}</strong>
            </div>
            <div>
              <small><T id="lead-detail.lead-detail.budget">Budget</T></small>
              <strong>{money(l.budgetCents)}</strong>
            </div>
          </div>
          <h3 className="form-subheading"><T id="lead-detail.lead-detail.message">Message</T></h3>
          <p>{l.message || <T id="lead-detail.lead-detail.no-message">No message.</T>}</p>
        </Section>
        <Section title={<T id="lead-detail.lead-detail.source">Source</T>}>
          <div className="info-grid">
            <div>
              <small><T id="lead-detail.lead-detail.source">Source</T></small>
              <strong>{l.source}</strong>
            </div>
            <div>
              <small><T id="lead-detail.lead-detail.channel">Channel</T></small>
              <strong>{leadChannelLabels[l.channel]}</strong>
            </div>
            <div>
              <small><T id="lead-detail.lead-detail.received">Received</T></small>
              <strong>{businessDate(l.receivedAt)}</strong>
            </div>
            <div>
              <small><T id="lead-detail.lead-detail.first-response">First response</T></small>
              <strong>
                {l.firstResponseSeconds === null
                  ? <T id="lead-detail.lead-detail.not-yet">Not yet</T>
                  : duration(l.firstResponseSeconds)}
              </strong>
            </div>
            <div>
              <small><T id="lead-detail.lead-detail.source-lead">Source lead</T></small>
              <strong>
                {l.sourceLeadUrl ? (
                  <a href={l.sourceLeadUrl} target="_blank" rel="noreferrer">
                    {l.sourceLeadId || <T id="lead-detail.lead-detail.open-on-source">Open on source</T>}
                  </a>
                ) : (
                  l.sourceLeadId || "—"
                )}
              </strong>
            </div>
          </div>
          {l.status === "lost" && (
            <>
              <h3 className="form-subheading"><T id="lead-detail.lead-detail.lost-reason-2">Lost reason</T></h3>
              <p>{l.lostReason}</p>
            </>
          )}
        </Section>
        {(l.sourceLinks?.length ?? 0) > 1 && (
          <Section title={<T id="lead-detail.lead-detail.source-links">Source links</T>}>
            <ul aria-label="Source links">
              {l.sourceLinks!.map((link) => (
                <li key={link.leadId}>
                  {link.source} · {leadChannelLabels[link.channel]} ·{" "}
                  {link.sourceLeadUrl ? (
                    <a
                      href={link.sourceLeadUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {link.sourceLeadId || <T id="lead-detail.lead-detail.open-on-source">Open on source</T>}
                    </a>
                  ) : (
                    link.sourceLeadId || "—"
                  )}{" "}
                  <small>
                    {link.mergedAt
                      ? <T id="lead-detail.lead-detail.merged-by" values={{ mergedAt: businessDate(link.mergedAt), mergedBy: link.mergedBy ?? "—" }}>{"merged {mergedAt} by {mergedBy}"}</T>
                      : <T id="lead-detail.lead-detail.received-2" values={{ receivedAt: businessDate(link.receivedAt) }}>{"received {receivedAt}"}</T>}
                  </small>
                </li>
              ))}
            </ul>
          </Section>
        )}
        <Section title={<T id="lead-detail.lead-detail.assignment">Assignment</T>}>
          <p>
            <T id="lead-detail.lead-detail.salesperson">{"Salesperson: "}</T>
            <strong>{l.assignedSalespersonId ?? <T id="lead-detail.lead-detail.unassigned">Unassigned</T>}</strong>
          </p>
          <Allowed action="leads.assign">
            <AssignForm
              label="Assign to (user ID)"
              button={l.assignedSalespersonId ? "Reassign" : "Assign"}
              onAssign={async (salespersonId) =>
                lead.replace(await leadsApi.assign(l.id, salespersonId))
              }
            />
          </Allowed>
        </Section>
      </div>
      <CommunicationLog target={{ leadId: l.id }} />
      {l.rawPayload !== null && l.rawPayload !== undefined && (
        <Section title={<T id="lead-detail.lead-detail.raw-payload">Raw payload</T>}>
          <pre className="muted">{JSON.stringify(l.rawPayload, null, 2)}</pre>
        </Section>
      )}
      {convert && (
        <ConvertLeadForm
          lead={l}
          linkClientId={linkClientId}
          onClose={() => {
            setConvert(false);
            setLinkClientId("");
          }}
          onConverted={(result) => navigate(`/events/${result.event.id}`)}
        />
      )}
    </>
  );
}
