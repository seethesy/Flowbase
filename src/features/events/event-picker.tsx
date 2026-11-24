import { useState } from "react";
import type { FlowEvent } from "../../../shared/core-records";
import { eventsApi } from "../../services/core";
import { useResource } from "../../app/useResource";
import { useDebounced } from "../../app/paging";
import { FormField, ErrorText } from "../../components/shared";
import { Dropdown } from "../../components/ui/Dropdown";
import { T, useCopy } from "../../app/copy";
import { date as eventDay } from "./event-format";

// Picks an event by searching the server as you type (FLOW-336), for the New
// proposal and New BEO drawers. An event can be listed but not pickable, with the
// reason after its name (e.g. it already has a BEO).
export function EventPicker({
  value,
  onChange,
  unavailable = () => null,
}: {
  value: FlowEvent | null;
  onChange: (event: FlowEvent | null) => void;
  unavailable?: (event: FlowEvent) => string | null;
}) {
  const placeholder = useCopy("events.event-picker.search.placeholder", "Type an event name");
  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim());
  const events = useResource(
    ["events", "picker", term],
    async () => (await eventsApi.list({ search: term || undefined })).rows,
    { reference: true, keepPrevious: true },
  );
  const rows = events.data ?? [];
  const listed = value && !rows.some((event) => event.id === value.id) ? [value, ...rows] : rows;
  return (
    <>
      <ErrorText message={events.error ?? ""} />
      <FormField label={<T id="events.event-picker.find-event">Find event</T>}>
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={placeholder} data-copy-id="events.event-picker.search.placeholder" />
      </FormField>
      <FormField label={<T id="events.event-picker.event">Event *</T>}>
        <Dropdown
          aria-label="Event"
          value={value?.id ?? ""}
          options={[
            { value: "", label: <T id="events.event-picker.choose-an-event">Choose an event</T>, text: "Choose an event" },
            ...listed.map((event) => {
              const reason = unavailable(event);
              const text = `${event.title} · ${eventDay(event.date)}${reason ? ` (${reason})` : ""}`;
              return { value: event.id, label: text, text, disabled: Boolean(reason) };
            }),
          ]}
          onValueChange={(id) => onChange(listed.find((event) => event.id === id) ?? null)}
        />
      </FormField>
    </>
  );
}
