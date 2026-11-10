import { useState } from "react";
import type { FlowEvent } from "../../shared/core-records";
import { closeoutLineProblem, type Closeout, type CloseoutLine } from "../../shared/closeout";
import { useResource } from "../app/useResource";
import { Button, FormField, LoadingSkeleton, Section } from "../components/shared";
import { LoadError } from "../components/record-display";
import { closeoutApi } from "../services/closeout";

type Entry = { returned: string; damaged: string; missing: string; used: string };
const amount = (value: string) => (value.trim() === "" ? 0 : Number(value));
const startEntry = (line: CloseoutLine): Entry => ({
  returned: line.consumable ? "0" : String(line.pulled ?? 0),
  damaged: "0",
  missing: "0",
  used: "0",
});

// The closeout and returns form on the event hub (FLOW-157). Phone first: one card
// per pulled line with number fields, then the sub-rental returns and final notes.
export function EventCloseoutSection({ event }: { event: FlowEvent }) {
  const closeout = useResource(["event-closeout", event.id], () => closeoutApi.get(event.id));
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [vendorNotes, setVendorNotes] = useState<Record<string, string>>({});
  const [vendorReturned, setVendorReturned] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (closeout.error) return <Section title="Closeout and returns"><LoadError message={closeout.error} /></Section>;
  if (!closeout.data) return <LoadingSkeleton />;
  const data: Closeout = closeout.data;

  if (data.closedOut)
    return (
      <Section title="Closeout and returns">
        <p>
          Closed out{data.closedByName ? ` by ${data.closedByName}` : ""} on{" "}
          {data.closedAt ? new Date(data.closedAt).toLocaleDateString() : ""}.
        </p>
        <ul aria-label="Closeout lines" className="planning-list">
          {data.lines.map((line) => (
            <li key={line.lineId} className="planning-row">
              <strong>{line.name}</strong>
              <span>
                {line.consumable
                  ? `Used ${line.used ?? 0}, left over ${line.leftover ?? 0}`
                  : `Returned ${line.returned ?? 0}, damaged ${line.damaged ?? 0}, missing ${line.missing ?? 0}`}
              </span>
            </li>
          ))}
        </ul>
        {data.subRentals.map((rental) => (
          <p key={rental.vendorId}>
            {rental.vendorName}: {rental.status === "returned" ? "returned" : rental.status}
            {rental.notes ? ` — ${rental.notes}` : ""}
          </p>
        ))}
        {data.notes && <p>{data.notes}</p>}
      </Section>
    );

  if (!data.canClose)
    return (
      <Section title="Closeout and returns">
        <p>
          {event.status === "preparation"
            ? "Only managers can close out an event."
            : "An event can be closed out once it is in Preparation."}
        </p>
      </Section>
    );

  const entryOf = (line: CloseoutLine) => entries[line.lineId] ?? startEntry(line);
  const change = (line: CloseoutLine, field: keyof Entry, value: string) =>
    setEntries({ ...entries, [line.lineId]: { ...entryOf(line), [field]: value } });
  const open = data.subRentals.filter((rental) => rental.status !== "returned");
  const submit = async () => {
    setError("");
    for (const line of data.lines) {
      const entry = entryOf(line);
      const problem = closeoutLineProblem(line, {
        returned: amount(entry.returned), damaged: amount(entry.damaged),
        missing: amount(entry.missing), used: amount(entry.used),
      });
      if (problem) return setError(problem);
    }
    setBusy(true);
    try {
      await closeoutApi.submit(event.id, {
        lines: data.lines.map((line) => {
          const entry = entryOf(line);
          return {
            lineId: line.lineId, returned: amount(entry.returned), damaged: amount(entry.damaged),
            missing: amount(entry.missing), used: amount(entry.used),
          };
        }),
        subRentals: open
          .filter((rental) => vendorReturned[rental.vendorId])
          .map((rental) => ({ vendorId: rental.vendorId, notes: vendorNotes[rental.vendorId] ?? "" })),
        notes,
      });
      closeout.reload();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Closeout and returns">
      {error && <p role="alert" className="error-message">{error}</p>}
      {!data.lines.length && <p>The pull list is empty; there is nothing to check in.</p>}
      {data.lines.map((line) => {
        const entry = entryOf(line);
        return (
          <fieldset key={line.lineId} className="planning-row">
            <legend>{line.name} {line.pulled !== null && <small>({line.pulled} pulled)</small>}</legend>
            {line.consumable ? (
              <FormField label={`${line.name} used`}>
                <input inputMode="decimal" value={entry.used} onChange={(e) => change(line, "used", e.target.value)} />
              </FormField>
            ) : (
              <>
                <FormField label={`${line.name} returned`}>
                  <input inputMode="decimal" value={entry.returned} onChange={(e) => change(line, "returned", e.target.value)} />
                </FormField>
                <FormField label={`${line.name} damaged`}>
                  <input inputMode="decimal" value={entry.damaged} onChange={(e) => change(line, "damaged", e.target.value)} />
                </FormField>
                <FormField label={`${line.name} missing`}>
                  <input inputMode="decimal" value={entry.missing} onChange={(e) => change(line, "missing", e.target.value)} />
                </FormField>
              </>
            )}
          </fieldset>
        );
      })}
      {open.map((rental) => (
        <fieldset key={rental.vendorId} className="planning-row">
          <legend>Sub-rental: {rental.vendorName}</legend>
          <label>
            <input
              type="checkbox"
              checked={!!vendorReturned[rental.vendorId]}
              onChange={(e) => setVendorReturned({ ...vendorReturned, [rental.vendorId]: e.target.checked })}
            />{" "}
            Returned to {rental.vendorName}
          </label>
          <FormField label={`${rental.vendorName} return notes`}>
            <input
              value={vendorNotes[rental.vendorId] ?? ""}
              maxLength={1000}
              onChange={(e) => setVendorNotes({ ...vendorNotes, [rental.vendorId]: e.target.value })}
            />
          </FormField>
        </fieldset>
      ))}
      <FormField label="Final notes">
        <textarea value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} />
      </FormField>
      <Button disabled={busy} onClick={() => void submit()}>Close out event</Button>
    </Section>
  );
}
