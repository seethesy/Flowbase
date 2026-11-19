import { lazy, Suspense } from "react";
import {
  createHashRouter,
  Link,
  Navigate,
  useLocation,
  useParams,
} from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { LiveEditGuard, T } from "./live-copy";
const Dashboard = lazy(() =>
  import("../features/dashboard").then((module) => ({ default: module.Dashboard })),
);
const OperationalReports = lazy(() => import("../features/operational-reports").then((module) => ({ default: module.OperationalReports })));
const OperationsPage = lazy(() => import("../features/operations").then((module) => ({ default: module.OperationsPage })));
const KitchenOrderStatus = lazy(() => import("../features/kitchen-orders").then((module) => ({ default: module.KitchenOrderStatus })));
const ClientList = lazy(() =>
  import("../features/clients").then((module) => ({ default: module.ClientList })),
);
const ClientDetail = lazy(() =>
  import("../features/clients").then((module) => ({ default: module.ClientDetail })),
);
const LeadInbox = lazy(() =>
  import("../features/leads").then((module) => ({ default: module.LeadInbox })),
);
const LeadDetail = lazy(() =>
  import("../features/leads").then((module) => ({ default: module.LeadDetail })),
);
const LeadDashboardPage = lazy(() =>
  import("../features/lead-dashboard").then((module) => ({ default: module.LeadDashboardPage })),
);
const EventList = lazy(() =>
  import("../features/events").then((module) => ({ default: module.EventList })),
);
const EventDetail = lazy(() =>
  import("../features/events").then((module) => ({ default: module.EventDetail })),
);
const EventBeoPage = lazy(() =>
  import("../features/event-beo").then((module) => ({ default: module.EventBeoPage })),
);
const OfflineBeoList = lazy(() =>
  import("../features/offline-beos").then((module) => ({ default: module.OfflineBeoList })),
);
const OfflineBeoPage = lazy(() =>
  import("../features/offline-beos").then((module) => ({ default: module.OfflineBeoPage })),
);
const BeoPrint = lazy(() =>
  import("../features/beo-print").then((module) => ({ default: module.BeoPrint })),
);
const VenueList = lazy(() =>
  import("../features/venues").then((module) => ({ default: module.VenueList })),
);
const VenueDetail = lazy(() =>
  import("../features/venues").then((module) => ({ default: module.VenueDetail })),
);
const PrintSample = lazy(() =>
  import("../features/print-sample").then((module) => ({ default: module.PrintSample })),
);
const Proposals = lazy(() =>
  import("../features/sales").then((module) => ({ default: module.SalesTracker })),
);
const SalesReports = lazy(() => import("../features/sales").then((module) => ({ default: module.SalesReports })));
const TimeReports = lazy(() =>
  import("../features/time-tracking").then((module) => ({ default: module.TimeReports })),
);
const SettingsPage = lazy(() =>
  import("../features/settings").then((module) => ({ default: module.SettingsPage })),
);
const CollectorHealthPage = lazy(() => import("../features/collector-health")
  .then((module) => ({ default: module.CollectorHealthPage })));
const UsagePage = lazy(() => import("../features/usage")
  .then((module) => ({ default: module.UsagePage })));
const StaffDetail = lazy(() =>
  import("../features/staff").then((module) => ({ default: module.StaffDetail })),
);
const StaffDirectory = lazy(() =>
  import("../features/staff").then((module) => ({ default: module.StaffDirectory })),
);
const StaffProfile = lazy(() =>
  import("../features/staff").then((module) => ({ default: module.StaffProfile })),
);
const InventoryList = lazy(() =>
  import("../features/inventory").then((module) => ({ default: module.InventoryList })),
);
const MasterInventory = lazy(() => import("../features/inventory-master").then((module) => ({ default: module.MasterInventory })));
const OrderLists = lazy(() => import("../features/order-lists").then((module) => ({ default: module.OrderLists })));
const OrderListDetail = lazy(() => import("../features/order-lists").then((module) => ({ default: module.OrderListDetail })));
const ApprovalQueue = lazy(() => import("../features/approval-queue").then((module) => ({ default: module.ApprovalQueue })));
const InventoryDetail = lazy(() =>
  import("../features/inventory").then((module) => ({ default: module.InventoryDetail })),
);
const IngredientList = lazy(() =>
  import("../features/inventory").then((module) => ({ default: module.IngredientList })),
);
const BarList = lazy(() =>
  import("../features/inventory").then((module) => ({ default: module.BarList })),
);
const SectionList = lazy(() =>
  import("../features/inventory").then((module) => ({ default: module.SectionList })),
);
const CountList = lazy(() =>
  import("../features/stock-counts").then((module) => ({ default: module.CountList })),
);
const CountMode = lazy(() =>
  import("../features/stock-counts").then((module) => ({ default: module.CountMode })),
);
const LowStockList = lazy(() =>
  import("../features/stock-counts").then((module) => ({ default: module.LowStockList })),
);
const SuppliesList = lazy(() => import("../features/inventory").then((module) => ({ default: module.SuppliesList })));
const ImportList = lazy(() => import("../features/imports").then((module) => ({ default: module.ImportList })));
const ImportPage = lazy(() => import("../features/imports").then((module) => ({ default: module.ImportPage })));
const RecipeList = lazy(() => import("../features/recipes").then((module) => ({ default: module.RecipeList })));
const RecipeDetail = lazy(() => import("../features/recipes").then((module) => ({ default: module.RecipeDetail })));
const ClientRecipeBook = lazy(() => import("../features/recipe-books").then((module) => ({ default: module.ClientRecipeBook })));
const ClientRecipePrint = lazy(() => import("../features/recipe-books").then((module) => ({ default: module.ClientRecipePrint })));
const KitchenRecipePrint = lazy(() => import("../features/recipe-books").then((module) => ({ default: module.KitchenRecipePrint })));
import { Button, PageHeader, Section } from "../components/shared";
import { Leaf } from "lucide-react";
import { useAuth } from "./auth";
import { roleLabel } from "../services/users";
const NotificationSettings = lazy(() =>
  import("../features/notifications").then((module) => ({ default: module.NotificationSettings })),
);
// FullCalendar lives in this chunk only (FLOW-63).
const CalendarPage = lazy(() =>
  import("../features/calendar").then((module) => ({ default: module.CalendarPage })),
);
const DayOfPage = lazy(() =>
  import("../features/day-of").then((module) => ({ default: module.DayOfPage })),
);
const ProductionOverviewPage = lazy(() =>
  import("../features/production").then((module) => ({ default: module.ProductionOverviewPage })),
);
const TaskDetail = lazy(() =>
  import("../features/tasks").then((module) => ({ default: module.TaskDetail })),
);
const TaskDashboardPage = lazy(() =>
  import("../features/task-lists").then((module) => ({ default: module.TaskDashboardPage })),
);
const TaskList = lazy(() =>
  import("../features/task-lists").then((module) => ({ default: module.TaskList })),
);
const TaskTemplates = lazy(() =>
  import("../features/task-templates").then((module) => ({ default: module.TaskTemplates })),
);
const SopLibrary = lazy(() => import("../features/sops").then((module) => ({ default: module.SopLibrary })));
const SopDetail = lazy(() => import("../features/sops").then((module) => ({ default: module.SopDetail })));
const VendorList = lazy(() => import("../features/vendors").then((module) => ({ default: module.VendorList })));
const VendorDetail = lazy(() => import("../features/vendors").then((module) => ({ default: module.VendorDetail })));
const UserManagement = lazy(() =>
  import("../features/users").then((module) => ({ default: module.UserManagement })),
);
function Placeholder() {
  return (
    <>
      <PageHeader
        title={<T id="app.router.placeholder.room-to-grow">Room to grow</T>}
        subtitle={<T id="app.router.placeholder.a-peek-at-what-comes-next">A peek at what comes next for your workspace.</T>}
      />
      <Section title={<T id="app.router.placeholder.not-included-in-demo">Not included in demo</T>}>
        <div className="placeholder-content">
          <Leaf size={40} />
          <h2><T id="app.router.placeholder.one-step-at-a-time">One step at a time.</T></h2>
          <p>
            <T id="app.router.placeholder.this-module-is-a-placeholder-in">This module is a placeholder in Flowbase v0.1. Explore Clients, proposals, and inventory to see the interactive prototype.</T>
          </p>
          <Button asChild>
            <Link to="/"><T id="app.router.placeholder.back-to-overview">Back to overview</T></Link>
          </Button>
        </div>
      </Section>
    </>
  );
}
function Profile() {
  const auth = useAuth();
  const user = auth?.user;
  return (
    <>
      <PageHeader
        title={user?.name ?? <T id="app.router.profile.employee-profile">Employee profile</T>}
        subtitle={user ? roleLabel(user.role) : ""}
      />
      <Section title={<T id="app.router.profile.employee-profile">Employee profile</T>}>
        <p>{user?.email}</p>
        <p>
          {user?.employmentType === "full_time" ? <T id="app.router.profile.full-time">Full-time</T> : <T id="app.router.profile.part-time">Part-time</T>}
        </p>
        <Button onClick={() => void auth?.signOut()}><T id="app.router.profile.sign-out">Sign out</T></Button>
      </Section>
      {user && <StaffProfile id={user.id} heading={false} />}
      {user && <NotificationSettings />}
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
// OAuth restores the hash before this is called. Reuse the instance across
// StrictMode renders so only one browser-history listener is installed.
let router: ReturnType<typeof createHashRouter> | undefined;
export const getRouter = () =>
  (router ??= createHashRouter([
    // Printable documents render without the app shell.
    { path: "/print/sample", element: <Suspense fallback={<p role="status"><T id="app.router.file.loading-document">Loading document…</T></p>}><PrintSample /></Suspense> },
    { path: "/print/recipes/client", element: <Suspense fallback={<p role="status"><T id="app.router.file.loading-document">Loading document…</T></p>}><ClientRecipePrint /></Suspense> },
    // Saved BEOs, read with no signal (FLOW-150): outside the app shell too.
    { path: "/offline", element: <Suspense fallback={<p role="status"><T id="app.router.file.loading">Loading…</T></p>}><OfflineBeoList /></Suspense> },
    { path: "/offline/events/:id", element: <Suspense fallback={<p role="status"><T id="app.router.file.loading">Loading…</T></p>}><OfflineBeoPage /></Suspense> },
    { path: "/print/events/:id/beo", element: <Suspense fallback={<p role="status"><T id="app.router.file.loading-document">Loading document…</T></p>}><BeoPrint /></Suspense> },
    { path: "/print/recipes/:id", element: <Suspense fallback={<p role="status"><T id="app.router.file.loading-document">Loading document…</T></p>}><KitchenRecipePrint /></Suspense> },
    {
      // Unsaved wording edits ask before leaving a page (FLOW-240).
      element: (
        <>
          <LiveEditGuard />
          <AppShell />
        </>
      ),
      children: [
        { path: "/", element: <Dashboard /> },
        { path: "/leads", element: <LeadInbox /> },
        { path: "/leads/dashboard", element: <LeadDashboardPage /> },
        { path: "/leads/:id", element: <LeadDetail /> },
        { path: "/clients", element: <ClientList /> },
        { path: "/clients/:id", element: <ClientDetail /> },
        { path: "/crm", element: <LegacyRoute to="/clients" /> },
        { path: "/crm/:id", element: <LegacyRoute to="/clients" /> },
        { path: "/customers", element: <LegacyRoute to="/clients" /> },
        { path: "/customers/:id", element: <LegacyRoute to="/clients" /> },
        { path: "/contracts", element: <LegacyRoute to="/proposals" /> },
        { path: "/proposals", element: <Proposals /> },
        { path: "/sales/reports", element: <SalesReports /> },
        { path: "/inventory", element: <InventoryList /> },
        { path: "/inventory/master", element: <MasterInventory /> },
        { path: "/inventory/orders", element: <OrderLists /> },
        { path: "/kitchen/orders", element: <KitchenOrderStatus /> },
        { path: "/inventory/orders/:id", element: <OrderListDetail /> },
        { path: "/approvals", element: <ApprovalQueue /> },
        { path: "/inventory/ingredients", element: <IngredientList /> },
        { path: "/inventory/bar", element: <BarList /> },
        { path: "/inventory/supplies", element: <SuppliesList /> },
        { path: "/inventory/low-stock", element: <LowStockList /> },
        { path: "/inventory/counts", element: <CountList /> },
        { path: "/inventory/counts/:id", element: <CountMode /> },
        { path: "/inventory/sections", element: <SectionList /> },
        { path: "/inventory/:id", element: <InventoryDetail /> },
        { path: "/recipes", element: <RecipeList /> },
        { path: "/recipes/client", element: <ClientRecipeBook /> },
        { path: "/recipes/:id", element: <RecipeDetail /> },
        { path: "/events", element: <EventList /> },
        { path: "/events/:id", element: <EventDetail /> },
        { path: "/events/:id/beo/:beoId", element: <EventBeoPage /> },
        { path: "/calendar", element: <CalendarPage /> },
        { path: "/day-of", element: <DayOfPage /> },
        { path: "/production", element: <ProductionOverviewPage /> },
        { path: "/venues", element: <VenueList /> },
        { path: "/venues/:id", element: <VenueDetail /> },
        { path: "/vendors", element: <VendorList /> },
        { path: "/vendors/:id", element: <VendorDetail /> },
        { path: "/staff", element: <StaffDirectory /> },
        { path: "/staff/:id", element: <StaffDetail /> },
        { path: "/profile", element: <Profile /> },
        { path: "/tasks", element: <TaskDashboardPage /> },
        { path: "/tasks/all", element: <TaskList /> },
        { path: "/tasks/templates", element: <TaskTemplates /> },
        { path: "/tasks/:id", element: <TaskDetail /> },
        { path: "/sops", element: <SopLibrary /> },
        { path: "/sops/:id", element: <SopDetail /> },
        { path: "/reports", element: <TimeReports /> },
        { path: "/reports/operations", element: <OperationalReports /> },
        { path: "/imports", element: <ImportList /> },
        { path: "/imports/:module", element: <ImportPage /> },
        { path: "/settings", element: <SettingsPage /> },
        { path: "/settings/collector", element: <CollectorHealthPage /> },
        { path: "/settings/usage", element: <UsagePage /> },
        { path: "/settings/operations", element: <OperationsPage /> },
        { path: "/settings/users", element: <UserManagement /> },
        ...["purchasing", "help", "*"].map((path) => ({
          path,
          element: <Placeholder />,
        })),
      ],
    },
  ]));
