import { lazy, Suspense } from "react";
import { DemoScreen } from "./store";
import {
  createHashRouter,
  Link,
  Navigate,
  useLocation,
  useParams,
} from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
const Dashboard = lazy(() =>
  import("../features/dashboard").then((module) => ({ default: module.Dashboard })),
);
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
  import("../features/proposals").then((module) => ({ default: module.Proposals })),
);
const TimeReports = lazy(() =>
  import("../features/time-tracking").then((module) => ({ default: module.TimeReports })),
);
const SettingsPage = lazy(() =>
  import("../features/settings").then((module) => ({ default: module.SettingsPage })),
);
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
const VendorList = lazy(() => import("../features/vendors").then((module) => ({ default: module.VendorList })));
const VendorDetail = lazy(() => import("../features/vendors").then((module) => ({ default: module.VendorDetail })));
const UserManagement = lazy(() =>
  import("../features/users").then((module) => ({ default: module.UserManagement })),
);
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
  const auth = useAuth();
  const user = auth?.user;
  return (
    <>
      <PageHeader
        title={user?.name ?? "Employee profile"}
        subtitle={user ? roleLabel(user.role) : ""}
      />
      <Section title="Employee profile">
        <p>{user?.email}</p>
        <p>
          {user?.employmentType === "full_time" ? "Full-time" : "Part-time"}
        </p>
        <Button onClick={() => void auth?.signOut()}>Sign out</Button>
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
    { path: "/print/sample", element: <Suspense fallback={<p role="status">Loading document…</p>}><PrintSample /></Suspense> },
    { path: "/print/recipes/client", element: <Suspense fallback={<p role="status">Loading document…</p>}><ClientRecipePrint /></Suspense> },
    { path: "/print/recipes/:id", element: <Suspense fallback={<p role="status">Loading document…</p>}><KitchenRecipePrint /></Suspense> },
    {
      element: <AppShell />,
      children: [
        { path: "/", element: <DemoScreen><Dashboard /></DemoScreen> },
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
        { path: "/proposals", element: <DemoScreen><Proposals /></DemoScreen> },
        { path: "/inventory", element: <InventoryList /> },
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
        { path: "/reports", element: <TimeReports /> },
        { path: "/imports", element: <ImportList /> },
        { path: "/imports/:module", element: <ImportPage /> },
        { path: "/settings", element: <SettingsPage /> },
        { path: "/settings/users", element: <UserManagement /> },
        ...["purchasing", "help", "*"].map((path) => ({
          path,
          element: <Placeholder />,
        })),
      ],
    },
  ]));
