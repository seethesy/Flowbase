import { Dropdown } from "../components/ui/Dropdown";
import { Block, PageGrid } from "../app/page-grid";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { productionWindows, type ProductionItem, type ProductionWindow } from "../../shared/production";
import { utcToBusinessTime } from "../../shared/time";
import { useResource } from "../app/useResource";
import { Button, FilterBar, LoadingSkeleton, Section } from "../components/shared";
import { LoadError } from "../components/record-display";
import { productionApi } from "../services/production";
import { LabelT, Plural, T } from "../app/copy";
import { usePermissions } from "../app/permissions";
import { RoundCheck } from "../components/ui/round-check";
import { tasksApi } from "../services/tasks";
import { orderListsApi } from "../services/order-lists";
import { weekday } from "./calendar-entries";
import { EventsHeading } from "./events-heading";
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
  return <Section title={<T id="production.event-production-section.production-list">Production list</T>}>
    {list.error && <LoadError message={list.error} />}
    {!list.data && !list.error && <LoadingSkeleton />}
    {list.data && <>
      <p><strong><T id="production.event-production-section.complete" values={{ percent: list.data.percent }}>{"{percent}% complete"}</T></strong><T id="production.event-production-section.of-items" values={{ complete: list.data.complete, total: list.data.total }}>{" · {complete} of {total} items"}</T></p>
      {list.data.items.length === 0 && <p className="muted"><T id="production.event-production-section.no-assigned-production-items-yet">No assigned production items yet.</T></p>}
      {Object.entries(grouped).map(([date, items]) =>
        <div key={date}><h3>{date}</h3><ul className="production-items">{items.map((item) => <Item key={item.id} item={item} />)}</ul></div>)}
      {readiness.data && readiness.data.length > 0 && <div className="production-readiness"><h3><T id="production.event-production-section.readiness-questions">Readiness questions</T></h3>
        {error && <p role="alert">{error}</p>}
        {readiness.data.map((check) => <div key={check.key} className="production-question">
          <p>{check.question} <small>{check.state === "open" ? <T id="production.event-production-section.open">Open</T> : `${check.state} ${check.respondedAt ? when(check.respondedAt) : ""}`}</small></p>
          {check.state === "open" && <><input aria-label={`Answer: ${check.question}`} value={response[check.key] ?? ""}
            onChange={(event) => setResponse((current) => ({ ...current, [check.key]: event.target.value }))} />
            <button type="button" onClick={() => void reply(check, "answered")}><T id="production.event-production-section.answer">Answer</T></button>
            <button type="button" onClick={() => void reply(check, "dismissed")}><T id="production.event-production-section.dismiss">Dismiss</T></button></>}
          {check.state !== "open" && check.response && <p>{check.response}</p>}
        </div>)}
      </div>}
    </>}
  </Section>;
}

// The Events screen's Production tab (FLOW-265): readiness questions for the
// events in the window, then the work grouped by day, each line with its type,
// a round check, the event, team and due time. Tasks are checked off here (the
// task's own status); other work completes on its own page and shows its state.
// Shortages offer "Add to order list": a draft order list from the order-by day
// through the event, opened for editing.
const typeLabels: Record<Exclude<ProductionItem["type"], "readiness">, string> = {
  task: "Task",
  pull: "Pull",
  kitchen: "Kitchen",
  shortage: "Shortage",
  staff: "Staff",
  truck: "Truck",
  order: "Order",
  setup: "Setup",
};
const workTypes = Object.keys(typeLabels) as (keyof typeof typeLabels)[];
const clockOf = (instant: string) => {
  const [hours, minutes] = utcToBusinessTime(new Date(instant)).time.split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
};
// A task line's task id: "task:<id>:<version>".
const taskIdOf = (item: ProductionItem) => (item.id.startsWith("task:") ? item.id.split(":")[1] : null);

export function ProductionOverviewPage() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [days, setDays] = useState<ProductionWindow>(7);
  const [eventId, setEventId] = useState("");
  const [team, setTeam] = useState("");
  const [type, setType] = useState("");
  const [error, setError] = useState("");
  const [answering, setAnswering] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const overview = useResource(["production-overview", days], () => productionApi.overview(days));
  const today = utcToBusinessTime(new Date()).date;
  const items = overview.data?.days.flatMap((day) => day.items) ?? [];
  const events = [...new Map(items.map((item) => [item.eventId, item.eventTitle])).entries()];
  const teams = [...new Set(items.map((item) => item.team))].sort();
  const run = async (action: () => Promise<unknown>) => {
    setError("");
    try { await action(); overview.reload(); }
    catch (cause) { setError((cause as Error).message); }
  };
  const respond = (check: NonNullable<typeof overview.data>["readiness"][number], state: "answered" | "dismissed") =>
    run(async () => {
      await productionApi.respond(check.eventId, check, state, state === "answered" ? answer : "");
      setAnswering(null);
      setAnswer("");
    });
  // A task's check shows at once and goes back if the save fails.
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const isChecked = (item: ProductionItem) => {
    const id = taskIdOf(item);
    return id && id in checked ? checked[id] : item.complete;
  };
  const toggle = (item: ProductionItem) => {
    const id = taskIdOf(item);
    if (!id) return;
    const next = !isChecked(item);
    setChecked((current) => ({ ...current, [id]: next }));
    void run(async () => {
      try { await tasksApi.update(id, { status: next ? "done" : "todo" }); }
      catch (cause) {
        setChecked((current) => ({ ...current, [id]: !next }));
        throw cause;
      }
    });
  };
  const addToOrderList = (item: ProductionItem) =>
    run(async () => {
      const from = utcToBusinessTime(new Date(item.due)).date;
      const list = await orderListsApi.create(from < item.eventDate ? from : item.eventDate, item.eventDate);
      navigate(`/inventory/orders/${list.id}`);
    });
  const readiness = (overview.data?.readiness ?? []).filter((check) => !eventId || check.eventId === eventId);
  const shownDays = (overview.data?.days ?? [])
    .map((day) => ({
      ...day,
      items: day.items.filter((item) => (!eventId || item.eventId === eventId) && (!team || item.team === team) && (!type || item.type === type)),
    }))
    .filter((day) => day.items.length || day.overcommitted || day.truckConflict || day.staffOvercommitted);
  return <>
    <EventsHeading tab="production" />
    <PageGrid pageKey="production.overview">
    <Block id="filters" name="Filters" h={3}>
    <FilterBar>
      <Dropdown variant="filter" aria-label="Days" value={String(days)}
        options={productionWindows.map((value) => ({ value: String(value),
          label: <T id="production.overview.next-days" values={{ days: value }}>{"Next {days} days"}</T>, text: `Next ${value} days` }))}
        onValueChange={(next) => setDays(Number(next) as ProductionWindow)} />
      <Dropdown variant="filter" aria-label="Team" value={team}
        options={[{ value: "", label: <T id="production.overview.all-teams">All teams</T>, text: "All teams" },
          ...teams.map((value) => ({ value, label: value }))]}
        onValueChange={setTeam} />
      <Dropdown variant="filter" aria-label="Type" value={type}
        options={[{ value: "", label: <T id="production.overview.all-types">All types</T>, text: "All types" },
          ...workTypes.map((value) => ({ value, label: <LabelT id="labels.production-type" value={value}>{typeLabels[value]}</LabelT>, text: typeLabels[value] }))]}
        onValueChange={setType} />
      <Dropdown variant="filter" aria-label="Event" value={eventId}
        options={[{ value: "", label: <T id="production.overview.all-events">All events</T>, text: "All events" },
          ...events.map(([id, title]) => ({ value: id, label: title }))]}
        onValueChange={setEventId} />
    </FilterBar>
    </Block>
    <Block id="readiness" name="Readiness questions" h={6}>
    {error && <p role="alert" className="error-message">{error}</p>}
    {overview.error && <LoadError message={overview.error} />}
    {!overview.data && !overview.error && <LoadingSkeleton />}
    {readiness.length > 0 && <section className="production-readiness-panel" aria-label="Readiness questions">
      <h2><T id="production.overview.readiness-questions" values={{ count: readiness.length }}>{"Readiness questions ({count})"}</T></h2>
      {readiness.map((check) => <div key={`${check.eventId}:${check.key}`} className="production-readiness-row">
        <p><strong>{check.eventTitle}:</strong> {check.question}</p>
        {answering === `${check.eventId}:${check.key}`
          ? <form className="production-readiness-answer" onSubmit={(event) => { event.preventDefault(); void respond(check, "answered"); }}>
            <input aria-label={`Answer: ${check.question}`} value={answer} autoFocus onChange={(event) => setAnswer(event.target.value)} />
            <Button type="submit" variant="outline"><T id="production.overview.save-answer">Save</T></Button>
            <Button type="button" variant="ghost" onClick={() => setAnswering(null)}><T id="production.overview.cancel">Cancel</T></Button>
          </form>
          : <div className="production-readiness-actions">
            <Button variant="outline" onClick={() => { setAnswering(`${check.eventId}:${check.key}`); setAnswer(""); }}>
              <T id="production.event-production-section.answer">Answer</T>
            </Button>
            <Button variant="outline" onClick={() => void respond(check, "dismissed")}>
              <T id="production.event-production-section.dismiss">Dismiss</T>
            </Button>
          </div>}
      </div>)}
    </section>}
    </Block>
    <Block id="days" name="Days" h={30}>
    {overview.data && !shownDays.length && <p className="muted"><T id="production.production-overview-page.no-matching-work">No matching work.</T></p>}
    {shownDays.map((day) => <section key={day.date} className="production-day" aria-label={weekday(day.date)}>
      <header>
        <h2>{day.date === today ? <T id="production.overview.today-date" values={{ date: weekday(day.date) }}>{"Today · {date}"}</T> : weekday(day.date)}</h2>
        <small><Plural id="production.overview.items" count={day.items.length} one="{count} item" other="{count} items" /></small>
      </header>
      {day.overcommitted && <p role="status" className="production-capacity"><T id="production.production-overview-page.all-trucks-are-assigned-assignments" values={{ truckCapacity: day.truckCapacity, trucksAssigned: day.trucksAssigned }}>{"All {truckCapacity} trucks are assigned ({trucksAssigned} assignments)."}</T></p>}
      {day.truckConflict && <p role="status" className="production-capacity"><T id="production.production-overview-page.truck-assignments-overlap">Truck assignments overlap.</T></p>}
      {day.staffOvercommitted && <p role="status" className="production-capacity"><T id="production.production-overview-page.staff-shifts-overlap">Staff shifts overlap.</T></p>}
      <ul className="production-work">
        {day.items.map((item) => <li key={`${item.eventId}:${item.id}`} className={isChecked(item) ? "complete" : undefined}>
          {item.type === "shortage"
            ? <span className="production-check-spacer" />
            : <RoundCheck checked={isChecked(item)} disabled={!taskIdOf(item)}
              aria-label={`Complete ${item.title}`} onChange={() => toggle(item)} />}
          <span className={`production-type production-type--${item.type}`}>
            {item.type !== "readiness" && <LabelT id="labels.production-type" value={item.type}>{typeLabels[item.type]}</LabelT>}
          </span>
          <span className="production-title">{item.title}</span>
          <Link className="production-event" to={`/events/${item.eventId}`}>{item.eventTitle}</Link>
          <span className="production-team">{item.team}</span>
          {item.type === "shortage"
            ? <>
              <span className="production-due production-due--late">{weekday(utcToBusinessTime(new Date(item.due)).date).split(",")[0]}</span>
              {can("order_lists.write") && <Button variant="outline" onClick={() => void addToOrderList(item)}>
                <T id="production.overview.add-to-order-list">Add to order list</T>
              </Button>}
            </>
            : <span className="production-due">{clockOf(item.due)}</span>}
        </li>)}
      </ul>
    </section>)}
    </Block>
    </PageGrid>
  </>;
}
