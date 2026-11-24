import type { ReactNode } from "react";
import { PageHeader } from "../../components/shared";
import { T } from "../../app/copy";

// The Events screen's heading (FLOW-265), the same on its tabs (Overview, BEOs,
// Production; FLOW-294), each with its own line under it and actions.
const subtitles = {
  overview: <T id="events-screen.calendar.events-at-negotiation-or-later-by-date">Events at Negotiation or later, by date.</T>,
  beos: <T id="events-screen.beos.every-events-beo">{"Every event's BEO. Each approved version is also saved as a PDF in Documents."}</T>,
  production: <T id="events-screen.production.upcoming-work-across-events">Upcoming work across events: tasks, pulls, kitchen prep, shortages, staffing and trucks.</T>,
};

// Each tab's page layout, so its heading lines can be edited there (FLOW-282).
const pageKeys: Record<keyof typeof subtitles, string> = {
  overview: "calendar.page",
  beos: "beos.list",
  production: "production.overview",
};

export function EventsHeading({ tab, children }: { tab: keyof typeof subtitles; children?: ReactNode }) {
  return (
    <PageHeader pageKey={pageKeys[tab]} title={<T id="events-screen.events-heading.events">Events</T>} subtitle={subtitles[tab]}>
      {children}
    </PageHeader>
  );
}
