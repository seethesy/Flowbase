import { useState } from "react";
import { Link } from "react-router-dom";
import type { ProductionItem } from "../../shared/production";
import { utcToBusinessTime } from "../../shared/time";
import { useResource } from "../app/useResource";
import { LoadingSkeleton, Section } from "../components/shared";
import { LoadError } from "../components/record-display";
import { productionApi } from "../services/production";
import "./production.css";

const when = (instant: string) => {
  const { date, time } = utcToBusinessTime(new Date(instant));
  return `${date} ${time}`;
};

function Item({ item }: { item: ProductionItem }) {
  return <li className="production-item">
    <span aria-label={item.complete ? "Complete" : "Open"}>{item.complete ? "✓" : "○"}</span>
    <span><Link to={`/events/${item.eventId}`}>{item.eventTitle}</Link> · {item.title}</span>
    <small>{when(item.due)}</small>
  </li>;
}

export function EventProductionSection({ eventId }: { eventId: string }) {
  const list = useResource(["production-event", eventId], () => productionApi.event(eventId));
  const readiness = useResource(["production-readiness", eventId], () => productionApi.readiness(eventId));
  const [response, setResponse] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const reply = async (check: NonNullable<typeof readiness.data>[number], state: "answered" | "dismissed") => {
    setError("");
    try {
      readiness.replace(await productionApi.respond(eventId, check, state, response[check.key] ?? ""));
      await list.refresh();
    } catch (cause) { setError((cause as Error).message); }
  };
  const grouped = list.data?.items.reduce<Record<string, ProductionItem[]>>((result, item) => {
    (result[when(item.due).slice(0, 10)] ??= []).push(item);
    return result;
  }, {}) ?? {};
  return <Section title="Production list">
    {list.error && <LoadError message={list.error} />}
    {!list.data && !list.error && <LoadingSkeleton />}
    {list.data && <>
      <p><strong>{list.data.percent}% complete</strong> · {list.data.complete} of {list.data.total} items</p>
      {list.data.items.length === 0 && <p className="muted">No assigned production items yet.</p>}
      {Object.entries(grouped).map(([date, items]) =>
        <div key={date}><h3>{date}</h3><ul className="production-items">{items.map((item) => <Item key={item.id} item={item} />)}</ul></div>)}
      {readiness.data && readiness.data.length > 0 && <div className="production-readiness"><h3>Readiness questions</h3>
        {error && <p role="alert">{error}</p>}
        {readiness.data.map((check) => <div key={check.key} className="production-question">
          <p>{check.question} <small>{check.state === "open" ? "Open" : `${check.state} ${check.respondedAt ? when(check.respondedAt) : ""}`}</small></p>
          {check.state === "open" && <><input aria-label={`Answer: ${check.question}`} value={response[check.key] ?? ""}
            onChange={(event) => setResponse((current) => ({ ...current, [check.key]: event.target.value }))} />
            <button type="button" onClick={() => void reply(check, "answered")}>Answer</button>
            <button type="button" onClick={() => void reply(check, "dismissed")}>Dismiss</button></>}
          {check.state !== "open" && check.response && <p>{check.response}</p>}
        </div>)}
      </div>}
    </>}
  </Section>;
}

export function ProductionOverviewPage() {
  const [days, setDays] = useState<7 | 14>(7);
  const [eventId, setEventId] = useState("");
  const [team, setTeam] = useState("");
  const [type, setType] = useState("");
  const overview = useResource(["production-overview", days], () => productionApi.overview(days));
  const items = overview.data?.days.flatMap((day) => day.items) ?? [];
  const events = [...new Map(items.map((item) => [item.eventId, item.eventTitle])).entries()];
  const teams = [...new Set(items.map((item) => item.team))];
  const types = [...new Set(items.map((item) => item.type))];
  return <>
    <div className="record-heading"><div><h1>Production overview</h1><p>Upcoming work across events</p></div></div>
    <div className="production-filters">
      <label>Days <select value={days} onChange={(e) => setDays(Number(e.target.value) as 7 | 14)}><option value="7">7</option><option value="14">14</option></select></label>
      <label>Event <select value={eventId} onChange={(e) => setEventId(e.target.value)}><option value="">All events</option>{events.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
      <label>Team <select value={team} onChange={(e) => setTeam(e.target.value)}><option value="">All teams</option>{teams.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Type <select value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option>{types.map((value) => <option key={value}>{value}</option>)}</select></label>
    </div>
    {overview.error && <LoadError message={overview.error} />}
    {!overview.data && !overview.error && <LoadingSkeleton />}
    {overview.data?.days.map((day) => {
      const shown = day.items.filter((item) => (!eventId || item.eventId === eventId) && (!team || item.team === team) && (!type || item.type === type));
      return <Section key={day.date} title={day.date}>
        {day.overcommitted && <p role="status" className="production-capacity">All {day.truckCapacity} trucks are assigned ({day.trucksAssigned} assignments).</p>}
        {day.truckConflict && <p role="status" className="production-capacity">Truck assignments overlap.</p>}
        {day.staffOvercommitted && <p role="status" className="production-capacity">Staff shifts overlap.</p>}
        {shown.length ? <ul className="production-items">{shown.map((item) => <Item key={`${item.eventId}:${item.id}`} item={item} />)}</ul> : <p className="muted">No matching work.</p>}
      </Section>;
    })}
  </>;
}
