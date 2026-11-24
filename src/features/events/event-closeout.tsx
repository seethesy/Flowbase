import { useState } from "react";
import { Block, PageGrid } from "../../app/live-edit/page-grid";
import type { FlowEvent } from "../../../shared/core-records";
import { closeoutLineProblem, type Closeout, type CloseoutLine } from "../../../shared/closeout";
import { useResource } from "../../app/useResource";
import { Button, FormField, LoadingSkeleton, Section, ErrorText } from "../../components/shared";
import { closeoutApi } from "../../services/closeout";
import { RoundCheck } from "../../components/ui/round-check";
import { T } from "../../app/copy";

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
  if (closeout.error) return <Section title={<T id="event-closeout.event-closeout-section.closeout-and-returns">Closeout and returns</T>}><ErrorText message={closeout.error} /></Section>;
  if (!closeout.data) return <LoadingSkeleton />;
  const data: Closeout = closeout.data;

  if (data.closedOut)
    return (
      <Section title={<T id="event-closeout.event-closeout-section.closeout-and-returns">Closeout and returns</T>}>
        <p>
          <T id="event-closeout.event-closeout-section.closed-out">Closed out</T>{data.closedByName ? <T id="event-closeout.event-closeout-section.by" values={{ closedByName: data.closedByName }}>{" by {closedByName}"}</T> : ""}<T id="event-closeout.event-closeout-section.on" values={{ value: data.closedAt ? new Date(data.closedAt).toLocaleDateString() : "" }}>{" on {value}."}</T>
        </p>
        <ul aria-label="Closeout lines" className="planning-list">
          {data.lines.map((line) => (
            <li key={line.lineId} className="planning-row">
              <strong>{line.name}</strong>
              <span>
                {line.consumable
                  ? <T id="event-closeout.event-closeout-section.used-left-over" values={{ value: line.used ?? 0, value2: line.leftover ?? 0 }}>{"Used {value}, left over {value2}"}</T>
                  : <T id="event-closeout.event-closeout-section.returned-damaged-missing" values={{ value: line.returned ?? 0, value2: line.damaged ?? 0, value3: line.missing ?? 0 }}>{"Returned {value}, damaged {value2}, missing {value3}"}</T>}
              </span>
            </li>
          ))}
        </ul>
        {data.subRentals.map((rental) => (
          <p key={rental.vendorId}>
            {rental.vendorName}: {rental.status === "returned" ? <T id="event-closeout.event-closeout-section.returned">returned</T> : rental.status}
            {rental.notes ? ` — ${rental.notes}` : ""}
          </p>
        ))}
        {data.notes && <p>{data.notes}</p>}
      </Section>
    );

  if (!data.canClose)
    return (
      <Section title={<T id="event-closeout.event-closeout-section.closeout-and-returns">Closeout and returns</T>}>
        <p>
          {event.status === "preparation" ? <T id="event-closeout.event-closeout-section.only-managers-can-close-out">Only managers can close out an event.</T> : <T id="event-closeout.event-closeout-section.an-event-can-be-closed">An event can be closed out once it is in Preparation.</T>}
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
    <Section title={<T id="event-closeout.event-closeout-section.closeout-and-returns">Closeout and returns</T>}>
      <ErrorText message={error} />
      <PageGrid pageKey="events.closeout">
      <Block id="pull-list" name="Pull list" h={12}>
{!data.lines.length && <p><T id="event-closeout.event-closeout-section.the-pull-list-is-empty">The pull list is empty; there is nothing to check in.</T></p>}
      {data.lines.map((line) => {
        const entry = entryOf(line);
        return (
          <fieldset key={line.lineId} className="planning-row">
            <legend>{line.name} {line.pulled !== null && <small><T id="event-closeout.event-closeout-section.pulled" values={{ pulled: line.pulled }}>{"({pulled} pulled)"}</T></small>}</legend>
            {line.consumable ? (
              <FormField label={<T id="event-closeout.event-closeout-section.used" values={{ name: line.name }}>{"{name} used"}</T>}>
                <input inputMode="decimal" value={entry.used} onChange={(e) => change(line, "used", e.target.value)} />
              </FormField>
            ) : (
              <>
                <FormField label={<T id="event-closeout.event-closeout-section.returned-2" values={{ name: line.name }}>{"{name} returned"}</T>}>
                  <input inputMode="decimal" value={entry.returned} onChange={(e) => change(line, "returned", e.target.value)} />
                </FormField>
                <FormField label={<T id="event-closeout.event-closeout-section.damaged" values={{ name: line.name }}>{"{name} damaged"}</T>}>
                  <input inputMode="decimal" value={entry.damaged} onChange={(e) => change(line, "damaged", e.target.value)} />
                </FormField>
                <FormField label={<T id="event-closeout.event-closeout-section.missing" values={{ name: line.name }}>{"{name} missing"}</T>}>
                  <input inputMode="decimal" value={entry.missing} onChange={(e) => change(line, "missing", e.target.value)} />
                </FormField>
              </>
            )}
          </fieldset>
        );
      })}

      </Block>
      {open.length > 0 && <Block id="sub-rentals" name="Sub-rental returns" h={6}>
{open.map((rental) => (
        <fieldset key={rental.vendorId} className="planning-row">
          <legend><T id="event-closeout.event-closeout-section.sub-rental" values={{ vendorName: rental.vendorName }}>{"Sub-rental: {vendorName}"}</T></legend>
          <label>
            <RoundCheck
              checked={!!vendorReturned[rental.vendorId]}
              onChange={(e) => setVendorReturned({ ...vendorReturned, [rental.vendorId]: e.target.checked })}
            /><T id="event-closeout.event-closeout-section.returned-to" values={{ vendorName: rental.vendorName }}>{" Returned to {vendorName}"}</T>
          </label>
          <FormField label={<T id="event-closeout.event-closeout-section.return-notes" values={{ vendorName: rental.vendorName }}>{"{vendorName} return notes"}</T>}>
            <input
              value={vendorNotes[rental.vendorId] ?? ""}
              maxLength={1000}
              onChange={(e) => setVendorNotes({ ...vendorNotes, [rental.vendorId]: e.target.value })}
            />
          </FormField>
        </fieldset>
      ))}

      </Block>}
      <Block id="finish" name="Final notes" h={5}>
<FormField label={<T id="event-closeout.event-closeout-section.final-notes">Final notes</T>}>
        <textarea value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} />
      </FormField>
      <Button disabled={busy} onClick={() => void submit()}><T id="event-closeout.event-closeout-section.close-out-event">Close out event</T></Button>

      </Block>
      </PageGrid>
    </Section>
  );
}
