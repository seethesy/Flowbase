import { Block, PageGrid } from "./live-edit/page-grid";
import { lazy, Suspense } from "react";
import {
  createHashRouter,
  Link,
  Navigate,
  useLocation,
  useParams,
} from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { RouteError } from "../components/RouteError";
const Dashboard = lazy(() =>
  import("../features/home/dashboard").then((module) => ({ default: module.Dashboard })),
);
const ArchivedPage = lazy(() => import("../features/settings/archived").then((module) => ({ default: module.ArchivedPage })));
const RolesPermissionsPage = lazy(() => import("./roles-permissions").then((module) => ({ default: module.RolesPermissionsPage })));
const OperationsPage = lazy(() => import("../features/events/operations").then((module) => ({ default: module.OperationsPage })));
const ClientDetail = lazy(() =>
  import("../features/sales/clients").then((module) => ({ default: module.ClientDetail })),
);
const LeadInbox = lazy(() =>
  import("../features/leads/leads").then((module) => ({ default: module.LeadInbox })),
);
const ContractsPage = lazy(() => import("../features/leads/financial-lists").then((module) => ({ default: module.ContractsPage })));
const PaymentPage = lazy(() => import("../features/leads/financial-lists").then((module) => ({ default: module.PaymentPage })));
const LeadDetail = lazy(() =>
  import("../features/leads/leads").then((module) => ({ default: module.LeadDetail })),
);
const LeadDashboardPage = lazy(() =>
  import("../features/leads/lead-dashboard").then((module) => ({ default: module.LeadDashboardPage })),
);
const EventDetail = lazy(() =>
  import("../features/events/event-detail").then((module) => ({ default: module.EventDetail })),
);
const EventBeoPage = lazy(() =>
  import("../features/beo/event-beo").then((module) => ({ default: module.EventBeoPage })),
);
const OfflineBeoList = lazy(() =>
  import("../features/beo/offline-beos").then((module) => ({ default: module.OfflineBeoList })),
);
const OfflineBeoPage = lazy(() =>
  import("../features/beo/offline-beos").then((module) => ({ default: module.OfflineBeoPage })),
);
const BeoPrint = lazy(() =>
  import("../features/beo/beo-print").then((module) => ({ default: module.BeoPrint })),
);
const VenueDetail = lazy(() =>
  import("../features/sales/venues").then((module) => ({ default: module.VenueDetail })),
);
const PrintSample = lazy(() =>
  import("../features/beo/print-sample").then((module) => ({ default: module.PrintSample })),
);
const ProposalLibrary = lazy(() =>
  import("../features/sales/proposal-library").then((module) => ({ default: module.ProposalLibrary })),
);
const PastEventsPage = lazy(() => import("../features/sales/sales-tabs").then((module) => ({ default: module.PastEventsPage })));
const SalesNetworkPage = lazy(() => import("../features/sales/sales-tabs").then((module) => ({ default: module.SalesNetworkPage })));
const SalesAnalyticsPage = lazy(() => import("../features/sales/sales-tabs").then((module) => ({ default: module.SalesAnalyticsPage })));
const SalesOverview = lazy(() => import("../features/sales/sales-overview").then((module) => ({ default: module.SalesOverview })));
const PricingPage = lazy(() => import("../features/sales/pricing").then((module) => ({ default: module.PricingPage })));
const SalesTimeTrackingPage = lazy(() => import("../features/sales/time-tracking-page").then((module) => ({ default: module.SalesTimeTrackingPage })));
const MarketingAnalytics = lazy(() => import("../features/home/heading-overview").then((module) => ({ default: module.MarketingAnalytics })));
const MarketingOverview = lazy(() => import("../features/home/heading-overview").then((module) => ({ default: module.MarketingOverview })));
const MarketingSocials = lazy(() => import("../features/home/heading-overview").then((module) => ({ default: module.MarketingSocials })));
const MarketingMovies = lazy(() => import("../features/home/heading-overview").then((module) => ({ default: module.MarketingMovies })));
const MarketingOtherEvents = lazy(() => import("../features/home/heading-overview").then((module) => ({ default: module.MarketingOtherEvents })));
const MarketingSeo = lazy(() => import("../features/home/heading-overview").then((module) => ({ default: module.MarketingSeo })));
const MarketingWebsite = lazy(() => import("../features/home/heading-overview").then((module) => ({ default: module.MarketingWebsite })));
const DocumentsOverview = lazy(() => import("../features/home/heading-overview").then((module) => ({ default: module.DocumentsOverview })));
const SettingsPage = lazy(() =>
  import("../features/settings/settings").then((module) => ({ default: module.SettingsPage })),
);
const InventoryCategoriesPage = lazy(() => import("../features/inventory/inventory-categories")
  .then((module) => ({ default: module.InventoryCategoriesPage })));
const DocumentsPage = lazy(() => import("../features/documents/documents")
  .then((module) => ({ default: module.DocumentsPage })));
const TemplatesPage = lazy(() => import("../features/documents/documents")
  .then((module) => ({ default: module.TemplatesPage })));
// Photo galleries (FLOW-271, FLOW-298).
const MarketingPhotosPage = lazy(() => import("../features/documents/photos").then((module) => ({ default: module.MarketingPhotosPage })));
const KitchenPhotosPage = lazy(() => import("../features/documents/photos").then((module) => ({ default: module.KitchenPhotosPage })));
const InventoryPhotosPage = lazy(() => import("../features/documents/photos").then((module) => ({ default: module.InventoryPhotosPage })));
const CollectorHealthPage = lazy(() => import("../features/home/collector-health")
  .then((module) => ({ default: module.CollectorHealthPage })));
const UsagePage = lazy(() => import("../features/settings/usage")
  .then((module) => ({ default: module.UsagePage })));
const StaffDetail = lazy(() =>
  import("../features/staff/staff").then((module) => ({ default: module.StaffDetail })),
);
const StaffDirectory = lazy(() =>
  import("../features/staff/staff").then((module) => ({ default: module.StaffDirectory })),
);
const PayrollPage = lazy(() =>
  import("../features/staff/payroll").then((module) => ({ default: module.PayrollPage })),
);
const StaffProfile = lazy(() =>
  import("../features/staff/staff").then((module) => ({ default: module.StaffProfile })),
);
const InventoryList = lazy(() =>
  import("../features/inventory/inventory").then((module) => ({ default: module.InventoryList })),
);
const OrderTab = lazy(() => import("../features/inventory/inventory-order").then((module) => ({ default: module.OrderTab })));
const OrderListDetail = lazy(() => import("../features/inventory/order-lists").then((module) => ({ default: module.OrderListDetail })));
const ApprovalQueue = lazy(() => import("../features/inventory/approval-queue").then((module) => ({ default: module.ApprovalQueue })));
const InventoryDetail = lazy(() =>
  import("../features/inventory/inventory").then((module) => ({ default: module.InventoryDetail })),
);
const IngredientList = lazy(() =>
  import("../features/inventory/inventory").then((module) => ({ default: module.IngredientList })),
);
const BarList = lazy(() =>
  import("../features/inventory/inventory").then((module) => ({ default: module.BarList })),
);
const LocationsPage = lazy(() =>
  import("../features/inventory/inventory").then((module) => ({ default: module.LocationsPage })),
);
const CountMode = lazy(() =>
  import("../features/inventory/stock-counts").then((module) => ({ default: module.CountMode })),
);
const ImportList = lazy(() => import("../features/settings/imports").then((module) => ({ default: module.ImportList })));
const ImportPage = lazy(() => import("../features/settings/imports").then((module) => ({ default: module.ImportPage })));
const RecipeList = lazy(() => import("../features/kitchen/recipe-list").then((module) => ({ default: module.RecipeList })));
const RecipeDetail = lazy(() => import("../features/kitchen/recipe-detail").then((module) => ({ default: module.RecipeDetail })));
const ClientRecipeBook = lazy(() => import("../features/kitchen/recipe-books").then((module) => ({ default: module.ClientRecipeBook })));
const ClientRecipePrint = lazy(() => import("../features/kitchen/recipe-books").then((module) => ({ default: module.ClientRecipePrint })));
const KitchenOverviewPage = lazy(() => import("../features/kitchen/kitchen-overview").then((module) => ({ default: module.KitchenOverviewPage })));
const MenusPage = lazy(() => import("../features/kitchen/kitchen-screen").then((module) => ({ default: module.MenusPage })));
const KitchenRecipePrint = lazy(() => import("../features/kitchen/recipe-books").then((module) => ({ default: module.KitchenRecipePrint })));
import { Button, EmptyState, PageHeader, Section } from "../components/shared";
import { Leaf } from "lucide-react";
import { useAuth } from "./auth";
const NotificationSettings = lazy(() =>
  import("../features/home/notifications").then((module) => ({ default: module.NotificationSettings })),
);
// FullCalendar lives in this chunk only (FLOW-63).
const CalendarPage = lazy(() =>
  import("../features/events/calendar").then((module) => ({ default: module.CalendarPage })),
);
const BeoListPage = lazy(() =>
  import("../features/beo/beo-list").then((module) => ({ default: module.BeoListPage })),
);
const ProductionOverviewPage = lazy(() =>
  import("../features/events/production").then((module) => ({ default: module.ProductionOverviewPage })),
);
const TaskDetail = lazy(() =>
  import("../features/tasks/tasks").then((module) => ({ default: module.TaskDetail })),
);
const TaskDashboardPage = lazy(() =>
  import("../features/tasks/task-dashboard").then((module) => ({ default: module.TaskDashboardPage })),
);
const TaskList = lazy(() =>
  import("../features/tasks/task-lists").then((module) => ({ default: module.TaskList })),
);
const TaskTemplates = lazy(() =>
  import("../features/tasks/task-templates").then((module) => ({ default: module.TaskTemplates })),
);
const SopLibrary = lazy(() => import("../features/tasks/sops").then((module) => ({ default: module.SopLibrary })));
const SopDetail = lazy(() => import("../features/tasks/sops").then((module) => ({ default: module.SopDetail })));
const VendorList = lazy(() => import("../features/inventory/vendors").then((module) => ({ default: module.VendorList })));
const VendorDetail = lazy(() => import("../features/inventory/vendors").then((module) => ({ default: module.VendorDetail })));
const UserManagement = lazy(() =>
  import("../features/settings/users").then((module) => ({ default: module.UserManagement })),
);
function Placeholder() {
  return (
    <>
      <PageHeader pageKey="placeholder.page"
        title="Room to grow"
        subtitle="A peek at what comes next for your workspace."
      />
      <PageGrid pageKey="placeholder.page"><Block id="content" name="Page content" h={10}>
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
      </Block></PageGrid>
    </>
  );
}
// Schedule has a place in the navigation before it has a screen (FLOW-246).
function ComingSoon({ title }: { title: string }) {
  return (
    <>
      <PageHeader pageKey="coming-soon.page" title={title} subtitle="This page is on its way." />
      <PageGrid pageKey="coming-soon.page"><Block id="content" name="Page content" h={6}>
      <section className="panel">
        <EmptyState title="Coming soon" description={`${title} isn't available yet.`} />
      </section>
      </Block></PageGrid>
    </>
  );
}
function Profile() {
  const auth = useAuth();
  const user = auth?.user;
  return (
    <>
      <PageHeader pageKey="notifications.settings"
        title={user?.name ?? "Employee profile"}
        subtitle="Your profile and how Flowbase reaches you"
      />
      {user && <StaffProfile id={user.id} heading={false} />}
      {user && <NotificationSettings />}
      <Button onClick={() => void auth?.signOut()}>Sign out</Button>
    </>
  );
}
// An old address: keeps its record id and query. `view` picks the view of a page
// that now holds two former pages (FLOW-340, e.g. /venues → Sales › Network).
function LegacyRoute({ to, view }: { to: string; view?: string }) {
  const location = useLocation();
  const { id } = useParams();
  const search = new URLSearchParams(location.search);
  if (view) search.set("view", view);
  const query = search.toString();
  return (
    <Navigate
      replace
      to={`${to}${id ? `/${encodeURIComponent(id.replace(/^cus-/, "cli-"))}` : ""}${query ? `?${query}` : ""}`}
    />
  );
}
// OAuth restores the hash before this is called. Reuse the instance across
// StrictMode renders so only one browser-history listener is installed.
let router: ReturnType<typeof createHashRouter> | undefined;
export const getRouter = () =>
  (router ??= createHashRouter([
    // Printable documents render without the app shell.
    { path: "/print/sample", element: <Suspense fallback={<p role="status">Loading document…</p>}><PrintSample /></Suspense>, errorElement: <RouteError /> },
    { path: "/print/recipes/client", element: <Suspense fallback={<p role="status">Loading document…</p>}><ClientRecipePrint /></Suspense>, errorElement: <RouteError /> },
    // Saved BEOs, read with no signal (FLOW-150): outside the app shell too.
    { path: "/offline", element: <Suspense fallback={<p role="status">Loading…</p>}><OfflineBeoList /></Suspense>, errorElement: <RouteError /> },
    { path: "/offline/events/:id", element: <Suspense fallback={<p role="status">Loading…</p>}><OfflineBeoPage /></Suspense>, errorElement: <RouteError /> },
    { path: "/print/events/:id/beo", element: <Suspense fallback={<p role="status">Loading document…</p>}><BeoPrint /></Suspense>, errorElement: <RouteError /> },
    { path: "/print/recipes/:id", element: <Suspense fallback={<p role="status">Loading document…</p>}><KitchenRecipePrint /></Suspense>, errorElement: <RouteError /> },
    {
      element: <AppShell />,
      // A screen that fails to load, e.g. a chunk removed by a deploy (FLOW-325).
      errorElement: <RouteError />,
      children: [
        { path: "/", element: <Dashboard /> },
        { path: "/leads", element: <LeadInbox /> },
        { path: "/leads/contracts", element: <ContractsPage /> },
        { path: "/leads/payment", element: <PaymentPage /> },
        { path: "/leads/dashboard", element: <LeadDashboardPage /> },
        { path: "/leads/:id", element: <LeadDetail /> },
        // FLOW-340: the Clients and Venues lists are Sales › Network, the Sales
        // tracker and its reports Sales › Analytics. Record pages stay put.
        { path: "/clients", element: <LegacyRoute to="/sales/network" /> },
        { path: "/clients/:id", element: <ClientDetail /> },
        { path: "/crm", element: <LegacyRoute to="/clients" /> },
        { path: "/crm/:id", element: <LegacyRoute to="/clients" /> },
        { path: "/customers", element: <LegacyRoute to="/clients" /> },
        { path: "/customers/:id", element: <LegacyRoute to="/clients" /> },
        { path: "/contracts", element: <LegacyRoute to="/sales" /> },
        { path: "/proposals", element: <ProposalLibrary /> },
        // The headings' Overview tabs (FLOW-295).
        { path: "/sales/overview", element: <SalesOverview /> },
        { path: "/marketing/overview", element: <MarketingOverview /> },
        // Marketing's working areas (FLOW-341), empty until the Admin adds cards.
        { path: "/marketing/socials", element: <MarketingSocials /> },
        { path: "/marketing/movies", element: <MarketingMovies /> },
        { path: "/marketing/other-events", element: <MarketingOtherEvents /> },
        { path: "/marketing/seo", element: <MarketingSeo /> },
        { path: "/marketing/website", element: <MarketingWebsite /> },
        { path: "/marketing/analytics", element: <MarketingAnalytics /> },
        { path: "/documents/overview", element: <DocumentsOverview /> },
        { path: "/reports/overview", element: <Navigate to="/sales/time-tracking" replace /> },
        { path: "/sales", element: <LegacyRoute to="/sales/analytics" /> },
        { path: "/sales/reports", element: <LegacyRoute to="/sales/analytics" view="reports" /> },
        { path: "/sales/past-events", element: <PastEventsPage /> },
        { path: "/sales/network", element: <SalesNetworkPage /> },
        { path: "/sales/analytics", element: <SalesAnalyticsPage /> },
        { path: "/sales/pricing", element: <PricingPage /> },
        { path: "/sales/time-tracking", element: <SalesTimeTrackingPage /> },
        { path: "/inventory", element: <InventoryList /> },
        // FLOW-292: ordering is Inventory › Order. Purchasing, the order lists'
        // old address, Low stock and Kitchen orders land there.
        { path: "/inventory/order", element: <OrderTab /> },
        { path: "/inventory/orders", element: <Navigate to="/inventory/order" replace /> },
        { path: "/purchasing", element: <Navigate to="/inventory/order" replace /> },
        { path: "/inventory/low-stock", element: <Navigate to="/inventory/order" replace /> },
        { path: "/kitchen/orders", element: <Navigate to="/inventory/order#kitchen" replace /> },
        { path: "/inventory/orders/:id", element: <OrderListDetail /> },
        { path: "/approvals", element: <ApprovalQueue /> },
        // FLOW-291: Ingredients live only under Kitchen; the removed Master
        // sheet, Supplies and Counts pages land on the Inventory tab, Sections on
        // Settings › Locations.
        { path: "/kitchen/ingredients", element: <IngredientList /> },
        { path: "/inventory/ingredients", element: <Navigate to="/kitchen/ingredients" replace /> },
        { path: "/inventory/bar", element: <BarList /> },
        { path: "/inventory/master", element: <Navigate to="/inventory" replace /> },
        { path: "/inventory/supplies", element: <Navigate to="/inventory" replace /> },
        { path: "/inventory/counts", element: <Navigate to="/inventory" replace /> },
        { path: "/inventory/counts/:id", element: <CountMode /> },
        { path: "/inventory/sections", element: <Navigate to="/settings/locations" replace /> },
        { path: "/inventory/:id", element: <InventoryDetail /> },
        { path: "/recipes", element: <RecipeList /> },
        { path: "/kitchen/overview", element: <KitchenOverviewPage /> },
        { path: "/kitchen/menus", element: <MenusPage /> },
        { path: "/recipes/client", element: <ClientRecipeBook /> },
        { path: "/recipes/:id", element: <RecipeDetail /> },
        // Events › Overview (FLOW-294): the calendar with its events table. The
        // old Calendar tab, the removed Day-of board and the retired events
        // list (/events, FLOW-349) land here, keeping their ?date= and filters.
        { path: "/events", element: <LegacyRoute to="/events/overview" /> },
        { path: "/events/overview", element: <CalendarPage /> },
        { path: "/events/:id", element: <EventDetail /> },
        { path: "/events/:id/beo/:beoId", element: <EventBeoPage /> },
        { path: "/calendar", element: <LegacyRoute to="/events/overview" /> },
        { path: "/beos", element: <BeoListPage /> },
        { path: "/day-of", element: <LegacyRoute to="/events/overview" /> },
        { path: "/production", element: <ProductionOverviewPage /> },
        { path: "/venues", element: <LegacyRoute to="/sales/network" view="venues" /> },
        { path: "/venues/:id", element: <VenueDetail /> },
        { path: "/vendors", element: <VendorList /> },
        { path: "/vendors/:id", element: <VendorDetail /> },
        { path: "/staff", element: <StaffDirectory /> },
        { path: "/staff/:id", element: <StaffDetail /> },
        { path: "/staffing/schedule", element: <ComingSoon title="Schedule" /> },
        // Payroll (FLOW-270): Admin and Technical; the API refuses everyone else.
        { path: "/staffing/payroll", element: <PayrollPage /> },
        { path: "/marketing", element: <MarketingPhotosPage /> },
        { path: "/kitchen/photos", element: <KitchenPhotosPage /> },
        { path: "/inventory/photos", element: <InventoryPhotosPage /> },
        { path: "/documents", element: <DocumentsPage /> },
        { path: "/documents/templates", element: <TemplatesPage /> },
        { path: "/profile", element: <Profile /> },
        { path: "/tasks", element: <TaskDashboardPage /> },
        { path: "/tasks/all", element: <TaskList /> },
        { path: "/tasks/templates", element: <TaskTemplates /> },
        { path: "/tasks/:id", element: <TaskDetail /> },
        { path: "/sops", element: <SopLibrary /> },
        { path: "/sops/:id", element: <SopDetail /> },
        { path: "/reports", element: <Navigate to="/sales/time-tracking" replace /> },
        { path: "/reports/operations", element: <Navigate to="/sales/time-tracking" replace /> },
        // Imports left the Inventory heading for Settings (FLOW-290/291); old
        // /imports links land on the Settings page.
        { path: "/settings/imports", element: <ImportList /> },
        { path: "/settings/imports/:module", element: <ImportPage /> },
        { path: "/imports", element: <Navigate to="/settings/imports" replace /> },
        { path: "/imports/:id", element: <LegacyRoute to="/settings/imports" /> },
        { path: "/settings", element: <SettingsPage /> },
        { path: "/settings/inventory-categories", element: <InventoryCategoriesPage /> },
        { path: "/settings/locations", element: <LocationsPage /> },
        { path: "/settings/collector", element: <CollectorHealthPage /> },
        { path: "/settings/usage", element: <UsagePage /> },
        { path: "/settings/operations", element: <OperationsPage /> },
        { path: "/settings/users", element: <UserManagement /> },
        { path: "/settings/permissions", element: <RolesPermissionsPage /> },
        { path: "/settings/archived", element: <ArchivedPage /> },
        ...["help", "*"].map((path) => ({
          path,
          element: <Placeholder />,
        })),
      ],
    },
  ]));
