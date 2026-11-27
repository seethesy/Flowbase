import { Block, PageGrid } from "../../app/live-edit/page-grid";
import { usePermissions } from "../../app/permissions";
import { LoadMore, usePagedList } from "../../app/paging";
import { T } from "../../app/copy";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { ErrorText, LoadingSkeleton, PageHeader, Tabs } from "../../components/shared";
import { eventsApi } from "../../services/core";
import type { EventPeriod } from "../../../shared/core-records";
import { MarketingAnalytics, NothingYet } from "../home/heading-overview";
import { EventTable } from "../events/event-list";
import { ClientList } from "./clients";
import { VenueList } from "./venues";
import { SalesReports, SalesTracker } from "./sales";

// The Sales heading's tabs (FLOW-340): Overview, Past Events, Network, Analytics,
// Pricing, Time Tracking. Past Events, Network and Analytics are views switched
// by sub-tabs (?view=). The former Clients, Venues, Sales tracker and Sales
// reports pages are views that keep their page keys, so the Admin's saved
// layouts and wording of those pages still apply.

// Events dated before today, newest first, split as Ash defined (FLOW-340 A2):
// Past reached Closed (Closed, Preparation or Finished); Lost never did or was
// marked Lost. The API applies the rule and the viewer's event scope
// (`?period=`). Each view has its own page key (the generator needs it literal).
function PeriodEvents({ period }: { period: EventPeriod }) {
  const events = usePagedList(["events", period], (cursor) => eventsApi.list({ period }, cursor));
  return events.error ? <ErrorText message={events.error} />
    : events.loading && !events.data ? <LoadingSkeleton />
    : <>
      <EventTable events={events.data ?? []} exportName={`${period}-events`} exportAll={events.loadAll}
        onSaved={() => events.reload()} />
      <LoadMore list={events} label={<T id="sales.past-events.load-more">Load more events</T>} />
    </>;
}

function PastEventsView() {
  return (
    <>
      <PageHeader pageKey="sales.past-events" title={<T id="sales.past-events.title">Past events</T>}
        subtitle={<T id="sales.past-events.subtitle">Events dated before today that reached Closed, newest first.</T>} />
      <PageGrid pageKey="sales.past-events">
        <Block id="table" name="Past events table" h={24}><PeriodEvents period="past" /></Block>
      </PageGrid>
    </>
  );
}

function LostEventsView() {
  return (
    <>
      <PageHeader pageKey="sales.lost-events" title={<T id="sales.lost-events.title">Lost events</T>}
        subtitle={<T id="sales.lost-events.subtitle">Events dated before today that never reached Closed or were marked Lost, newest first.</T>} />
      <PageGrid pageKey="sales.lost-events">
        <Block id="table" name="Lost events table" h={24}><PeriodEvents period="lost" /></Block>
      </PageGrid>
    </>
  );
}

export function PastEventsPage() {
  return (
    <SubPages copyKey="sales.past-events-views" views={[
      { view: "past", name: "Past", page: <PastEventsView /> },
      { view: "lost", name: "Lost", page: <LostEventsView /> },
    ]} />
  );
}

// Corporate and Industry (FLOW-340 A1) have no records of their own yet: each
// starts as an empty page the Admin fills in live edit, like the heading
// Overviews.
function CorporateView() {
  return (
    <>
      <PageHeader pageKey="sales.corporate" title={<T id="sales.corporate.title">Corporate</T>} />
      <PageGrid pageKey="sales.corporate"><NothingYet /></PageGrid>
    </>
  );
}

function IndustryView() {
  return (
    <>
      <PageHeader pageKey="sales.industry" title={<T id="sales.industry.title">Industry</T>} />
      <PageGrid pageKey="sales.industry"><NothingYet /></PageGrid>
    </>
  );
}

// One page holding several views, switched by tabs below the heading's tab
// bar: the view is in the URL (?view=), so the old addresses redirect straight
// to it and Back returns to the other one. Each view is the former page itself,
// with its own heading, page key and saved layout.
function SubPages<V extends string>({ views, copyKey }: { views: { view: V; name: string; page: ReactNode }[]; copyKey: string }) {
  const [params, setParams] = useSearchParams();
  const current = views.find((entry) => entry.view === params.get("view")) ?? views[0];
  if (!current) return null;
  return (
    <>
      {views.length > 1 && (
        <Tabs copyKey={copyKey} tabs={views.map((entry) => entry.name)} value={current.name}
          onChange={(name) => {
            const next = views.find((entry) => entry.name === name) ?? views[0];
            setParams(next === views[0] ? {} : { view: next.view });
          }} />
      )}
      <div id="record-panel" role="tabpanel" aria-label={current.name}>{current.page}</div>
    </>
  );
}

// Clients, Venues, Corporate and Industry (FLOW-340 A1). A role sees the record
// views it may read.
export function SalesNetworkPage() {
  const { can } = usePermissions();
  return (
    <SubPages copyKey="sales.network" views={[
      ...(can("clients.read") ? [{ view: "clients" as const, name: "Clients", page: <ClientList /> }] : []),
      ...(can("venues.read") ? [{ view: "venues" as const, name: "Venues", page: <VenueList /> }] : []),
      { view: "corporate" as const, name: "Corporate", page: <CorporateView /> },
      { view: "industry" as const, name: "Industry", page: <IndustryView /> },
    ]} />
  );
}

// The Sales tracker, the sales reports and Marketing analytics (FLOW-340 A1); the
// last is the same page as Marketing › Analytics (FLOW-341 A1).
export function SalesAnalyticsPage() {
  const { can } = usePermissions();
  return (
    <SubPages copyKey="sales.analytics" views={[
      { view: "tracker", name: "Sales tracker", page: <SalesTracker /> },
      { view: "reports", name: "Sales reports", page: <SalesReports /> },
      ...(can("marketing.read") ? [{ view: "marketing" as const, name: "Marketing analytics", page: <MarketingAnalytics /> }] : []),
    ]} />
  );
}
