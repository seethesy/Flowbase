import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { FlowEvent } from "../../../shared/core-records";
import { beoApi } from "../../services/beo";
import { useResource } from "../../app/useResource";
import { Button, FormDrawer } from "../../components/shared";
import { Allowed } from "../../app/permissions";
import { T } from "../../app/copy";
import { EventPicker } from "../events/event-picker";

// New BEO on the BEOs tab (FLOW-336): pick an event without a live BEO and
// generate it as the event's BEO page does (Generate BEO, FLOW-143), then open it.
// Events that already have one are listed but can't be picked.
export function NewBeoButton() {
  const [open, setOpen] = useState(false);
  return (
    <Allowed action="events.write">
      <Button onClick={() => setOpen(true)}><T id="beo-list.new-beo.button">New BEO</T></Button>
      {open && <NewBeoDrawer onClose={() => setOpen(false)} />}
    </Allowed>
  );
}

export function NewBeoDrawer({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const existing = useResource(["beos", "all", "events"], () => beoApi.list({ when: "all" }));
  const withBeo = new Set((existing.data ?? []).map((row) => row.eventId));
  const [event, setEvent] = useState<FlowEvent | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!event) return setError("Choose an event.");
    setSaving(true);
    setError("");
    try {
      const beo = await beoApi.generate(event.id);
      navigate(`/events/${event.id}/beo/${beo.id}`);
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
      title={<T id="beo-list.new-beo.title">New BEO</T>}
      description={<T id="beo-list.new-beo.description">{"Builds the BEO from the event's menu, staff and timeline. An event has one BEO."}</T>}
      onSubmit={save}
      error={error || existing.error}
      saving={saving}
      saveDisabled={!existing.data}
      saveLabel={<T id="beo-list.new-beo.save">Create BEO</T>}
      cancelLabel={<T id="beo-list.new-beo.cancel">Cancel</T>}
    >
      <EventPicker value={event} onChange={setEvent}
        unavailable={(row) => (withBeo.has(row.id) ? "already has a BEO" : null)} />
    </FormDrawer>
  );
}
