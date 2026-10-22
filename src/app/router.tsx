import {
  createHashRouter,
  Link,
  Navigate,
  useLocation,
  useParams,
} from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { Dashboard } from "../features/dashboard";
import { ClientList, ClientDetail } from "../features/clients";
import { LeadInbox, LeadDetail } from "../features/leads";
import { EventList, EventDetail } from "../features/events";
import { VenueList, VenueDetail } from "../features/venues";
import { PrintSample } from "../features/print-sample";
import { Proposals } from "../features/proposals";
import { SettingsPage, TimeReports } from "../features/time-tracking";
import {
  InventoryList,
  InventoryDetail,
  IngredientList,
  BarList,
  SectionList,
} from "../features/inventory";
import {
  CountList,
  CountMode,
  LowStockList,
} from "../features/stock-counts";
import { Button, PageHeader, Section } from "../components/shared";
import { Leaf } from "lucide-react";
function Placeholder() {
  return (
    <>
      <PageHeader
        title="Room to grow"
        subtitle="A peek at what comes next for your workspace."
      />
      <Section title="Not included in demo">
        <div className="placeholder-content">
          <Leaf size={40} />
          <h2>One step at a time.</h2>
          <p>
            This module is a placeholder in Flowbase v0.1. Explore Clients,
            proposals, and inventory to see the interactive prototype.
          </p>
          <Button asChild>
            <Link to="/">Back to overview</Link>
          </Button>
        </div>
      </Section>
    </>
  );
}
function Profile() {
  return (
    <>
      <PageHeader
        title="Alex Chen"
        subtitle="Operations manager · CoreOps catering workspace"
      />
      <Section title="Employee profile">
        <p>Fictional employee · Demo session</p>
        <p>
          Alex coordinates client relationships, event proposals, and inventory
          for the team.
        </p>
        <p className="demo-callout">
          No authentication or account changes are included in this prototype.
        </p>
      </Section>
    </>
  );
}
function LegacyRoute({ to }: { to: string }) {
  const location = useLocation();
  const { id } = useParams();
  return (
    <Navigate
      replace
      to={`${to}${id ? `/${encodeURIComponent(id.replace(/^cus-/, "cli-"))}` : ""}${location.search}`}
    />
  );
}
export const router = createHashRouter([
  // Printable documents render without the app shell.
  { path: "/print/sample", element: <PrintSample /> },
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <Dashboard /> },
      { path: "/leads", element: <LeadInbox /> },
      { path: "/leads/:id", element: <LeadDetail /> },
      { path: "/clients", element: <ClientList /> },
      { path: "/clients/:id", element: <ClientDetail /> },
      { path: "/crm", element: <LegacyRoute to="/clients" /> },
      { path: "/crm/:id", element: <LegacyRoute to="/clients" /> },
      { path: "/customers", element: <LegacyRoute to="/clients" /> },
      { path: "/customers/:id", element: <LegacyRoute to="/clients" /> },
      { path: "/contracts", element: <LegacyRoute to="/proposals" /> },
      { path: "/proposals", element: <Proposals /> },
      { path: "/inventory", element: <InventoryList /> },
      { path: "/inventory/ingredients", element: <IngredientList /> },
      { path: "/inventory/bar", element: <BarList /> },
      { path: "/inventory/low-stock", element: <LowStockList /> },
      { path: "/inventory/counts", element: <CountList /> },
      { path: "/inventory/counts/:id", element: <CountMode /> },
      { path: "/inventory/sections", element: <SectionList /> },
      { path: "/inventory/:id", element: <InventoryDetail /> },
      { path: "/events", element: <EventList /> },
      { path: "/events/:id", element: <EventDetail /> },
      { path: "/venues", element: <VenueList /> },
      { path: "/venues/:id", element: <VenueDetail /> },
      { path: "/profile", element: <Profile /> },
      { path: "/reports", element: <TimeReports /> },
      { path: "/settings", element: <SettingsPage /> },
      ...["purchasing", "help", "*"].map(
        (path) => ({ path, element: <Placeholder /> }),
      ),
    ],
  },
]);
