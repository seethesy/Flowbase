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
import { LoadError } from "./clients";
import "./leads.css";
import { ConvertLeadForm } from "./lead-convert";
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

const nextStep: Partial<Record<LeadStatus, { status: "contacted" | "qualified"; label: string }>> = {
  new: { status: "contacted", label: "Mark contacted" },
  contacted: { status: "qualified", label: "Mark qualified" },
};

export function LeadDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const lead = useResource(() => leadsApi.get(id), [id]);
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
          ← All leads
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
        ← All leads
      </Link>
      <div className="record-heading">
        <div>
          <h1>{leadTitle(l)}</h1>
          <p>
            <LeadStatusBadge status={l.status} />
            {l.needsReview && <span className="badge warning">Needs review</span>}
            {l.purchased && <span className="badge neutral">Purchased</span>}
          </p>
        </div>
        <div className="page-actions">
          {step && moves.includes(step.status) && (
            <Button disabled={busy} onClick={() => void move(step.status)}>
              {step.label}
            </Button>
          )}
          {moves.includes("lost") && (
            <Button variant="outline" disabled={busy} onClick={() => setLosing(true)}>
              Mark lost
            </Button>
          )}
          {l.status === "qualified" && (
            <Button onClick={() => setConvert(true)}>
              <ArrowRightLeft size={14} />
              Convert
            </Button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {losing && (
        <Section title="Mark lost">
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!reason.trim())
                return setError("A reason is required when marking a lead lost.");
              void move("lost", reason.trim());
            }}
          >
            <FormField label="Lost reason *">
              <textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </FormField>
            <div className="form-actions">
              <Button type="button" variant="outline" onClick={() => setLosing(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                Confirm lost
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
        <Section title="Possible duplicates">
          <ul className="duplicate-list">
            {duplicates.map((match) => (
              <li key={match.duplicateId} className="duplicate-pair">
                <p>
                  <strong>{leadDuplicateReasonLabels[match.reason]}</strong>
                </p>
                {match.lead ? (
                  <p>
                    <Link to={`/leads/${match.lead.id}`}>
                      {match.lead.name || "Unnamed lead"}
                    </Link>{" "}
                    <small>{summaryLine(match.lead)}</small>
                  </p>
                ) : (
                  match.client && (
                    <p>
                      Client{" "}
                      <Link to={`/clients/${match.client.id}`}>{match.client.name}</Link>
                    </p>
                  )
                )}
                <div className="page-actions">
                  {match.lead && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void resolve(() => leadsApi.merge(match.duplicateId, l.id))
                      }
                    >
                      Merge into this lead
                    </Button>
                  )}
                  {match.client && l.status === "qualified" && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setLinkClientId(match.client!.id);
                        setConvert(true);
                      }}
                    >
                      Convert and link to {match.client.name}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void resolve(() => leadsApi.dismiss(match.duplicateId))}
                  >
                    Not a duplicate
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {l.status === "converted" && (
        <p role="note" className="demo-callout">
          Converted.{" "}
          {l.convertedClientId && (
            <Link to={`/clients/${l.convertedClientId}`}>View client</Link>
          )}{" "}
          {l.convertedEventId && (
            <Link to={`/events/${l.convertedEventId}`}>View event</Link>
          )}
        </p>
      )}
      <div className="detail-grid">
        <Section title="Contact">
          <div className="info-grid">
            <div>
              <small>Name</small>
              <strong>{l.name || "—"}</strong>
            </div>
            <div>
              <small>Email</small>
              <strong>{l.email || "—"}</strong>
            </div>
            <div>
              <small>Phone</small>
              <strong>{l.phone || "—"}</strong>
            </div>
          </div>
        </Section>
        <Section title="Event">
          <div className="info-grid">
            <div>
              <small>Event date</small>
              <strong>{eventDay(l.eventDate)}</strong>
            </div>
            <div>
              <small>Guests</small>
              <strong>{l.guestCount ?? "—"}</strong>
            </div>
            <div>
              <small>Event type</small>
              <strong>{l.eventType || "—"}</strong>
            </div>
            <div>
              <small>Location</small>
              <strong>{l.location || "—"}</strong>
            </div>
            <div>
              <small>Budget</small>
              <strong>{money(l.budgetCents)}</strong>
            </div>
          </div>
          <h3 className="form-subheading">Message</h3>
          <p>{l.message || "No message."}</p>
        </Section>
        <Section title="Source">
          <div className="info-grid">
            <div>
              <small>Source</small>
              <strong>{l.source}</strong>
            </div>
            <div>
              <small>Channel</small>
              <strong>{leadChannelLabels[l.channel]}</strong>
            </div>
            <div>
              <small>Received</small>
              <strong>{businessDate(l.receivedAt)}</strong>
            </div>
            <div>
              <small>First response</small>
              <strong>
                {l.firstResponseSeconds === null
                  ? "Not yet"
                  : duration(l.firstResponseSeconds)}
              </strong>
            </div>
            <div>
              <small>Source lead</small>
              <strong>
                {l.sourceLeadUrl ? (
                  <a href={l.sourceLeadUrl} target="_blank" rel="noreferrer">
                    {l.sourceLeadId || "Open on source"}
                  </a>
                ) : (
                  l.sourceLeadId || "—"
                )}
              </strong>
            </div>
          </div>
          {l.status === "lost" && (
            <>
              <h3 className="form-subheading">Lost reason</h3>
              <p>{l.lostReason}</p>
            </>
          )}
        </Section>
        {(l.sourceLinks?.length ?? 0) > 1 && (
          <Section title="Source links">
            <ul aria-label="Source links">
              {l.sourceLinks!.map((link) => (
                <li key={link.leadId}>
                  {link.source} · {leadChannelLabels[link.channel]} ·{" "}
                  {link.sourceLeadUrl ? (
                    <a href={link.sourceLeadUrl} target="_blank" rel="noreferrer">
                      {link.sourceLeadId || "Open on source"}
                    </a>
                  ) : (
                    link.sourceLeadId || "—"
                  )}{" "}
                  <small>
                    {link.mergedAt
                      ? `merged ${businessDate(link.mergedAt)} by ${link.mergedBy ?? "—"}`
                      : `received ${businessDate(link.receivedAt)}`}
                  </small>
                </li>
              ))}
            </ul>
          </Section>
        )}
        <Section title="Assignment">
          <p>
            Salesperson:{" "}
            <strong>{l.assignedSalespersonId ?? "Unassigned"}</strong>
          </p>
          <AssignForm
            label="Assign to (user ID)"
            button={l.assignedSalespersonId ? "Reassign" : "Assign"}
            onAssign={async (salespersonId) =>
              lead.replace(await leadsApi.assign(l.id, salespersonId))
            }
          />
        </Section>
      </div>
      {l.rawPayload !== null && l.rawPayload !== undefined && (
        <Section title="Raw payload">
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
