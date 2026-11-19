import { usePermissions } from "../../app/permissions";
import { Suspense, useState } from "react";
import { useResource } from "../../app/useResource";
import { clientsApi, inventoryApi } from "../../services/core";
import {
  NavLink,
  Outlet,
  Link,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Inbox,
  FileText,
  Package,
  ChefHat,
  ShoppingCart,
  Truck,
  Calendar,
  CalendarDays,
  ClipboardCheck,
  MapPin,
  ChartNoAxesCombined,
  Settings,
  CircleHelp,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  Search,
  Menu,
  X,
  Leaf,
  Contact,
  ListChecks,
} from "lucide-react";
import { DetailDrawer } from "../shared";
import { TrackingNotice } from "../TrackingNotice";
import { GlobalSearch } from "../../features/search";
import { NotificationBell } from "../../features/notifications";
import { useActivityTracking } from "../../app/useActivityTracking";
import { useAuth } from "../../app/auth";
import { roleLabel } from "../../services/users";
import { copySlug, LiveEditControls, T } from "../../app/live-copy";
const navigation = [
  { name: "Dashboard", to: "/", icon: LayoutDashboard, key: "nav.primary.dashboard" },
  { name: "Tasks", to: "/tasks", icon: ListChecks, key: "nav.primary.tasks" },
  { name: "SOPs", to: "/sops", icon: FileText, key: "nav.primary.sops" },
  { name: "Leads", to: "/leads", icon: Inbox, key: "nav.primary.leads" },
  { name: "Clients", to: "/clients", icon: Users, key: "nav.primary.clients" },
  { name: "Proposals", to: "/proposals", icon: FileText, key: "nav.primary.proposals" },
  { name: "Inventory", to: "/inventory", icon: Package, key: "nav.primary.inventory" },
  { name: "Recipes", to: "/recipes", icon: ChefHat, key: "nav.primary.recipes" },
  { name: "Purchasing", to: "/purchasing", icon: ShoppingCart, key: "nav.primary.purchasing" },
  { name: "Vendors", to: "/vendors", icon: Truck, key: "nav.primary.vendors" },
  { name: "Events", to: "/events", icon: CalendarDays, key: "nav.primary.events" },
  { name: "Calendar", to: "/calendar", icon: Calendar, key: "nav.primary.calendar" },
  { name: "Day-of", to: "/day-of", icon: ClipboardCheck, key: "nav.primary.day-of" },
  { name: "Production", to: "/production", icon: ListChecks, key: "nav.primary.production" },
  { name: "Venues", to: "/venues", icon: MapPin, key: "nav.primary.venues" },
  { name: "Staff", to: "/staff", icon: Contact, key: "nav.primary.staff" },
  { name: "Reports", to: "/reports", icon: ChartNoAxesCombined, key: "nav.primary.reports" },
];
export function Breadcrumbs() {
  const location = useLocation();
  const parts = location.pathname.split("/").filter(Boolean);
  const name =
    parts[0] === "clients"
      ? "Clients"
      : parts[0]
        ? parts[0][0].toUpperCase() + parts[0].slice(1)
        : "Dashboard";
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <span>
        <T id="breadcrumbs.workspace">Workspace</T>
      </span>
      <span>/</span>
      <Link to={parts[0] ? `/${parts[0]}` : "/"}>
        <T id={`breadcrumbs.${copySlug(name)}`}>{name}</T>
      </Link>
      {parts[1] && (parts[0] === "clients" || (parts[0] === "inventory" && !["ingredients", "bar", "supplies", "counts", "sections", "low-stock"].includes(parts[1]))) && (
        <RecordBreadcrumb key={location.pathname} resource={parts[0]} id={parts[1]} />
      )}
    </nav>
  );
}
function RecordBreadcrumb({ resource, id }: { resource: string; id: string }) {
  const record = useResource(["breadcrumb", resource, id], async () => {
    const result = resource === "clients" ? await clientsApi.get(id) : await inventoryApi.get(id);
    return { name: result.name };
  });
  return record.data ? <><span>/</span><span>{record.data.name}</span></> : null;
}
function Sidebar({
  collapsed,
  setCollapsed,
  mobile,
  setMobile,
}: {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  mobile: boolean;
  setMobile: (v: boolean) => void;
}) {
  const auth = useAuth();
  const displayName = auth?.user.name ?? "Profile";
  return (
    <>
      {mobile && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside
        className={`sidebar ${collapsed ? "collapsed" : ""} ${mobile ? "mobile-open" : ""}`}
      >
        <Link className="logo" to="/" onClick={() => setMobile(false)}>
          {/* eslint-disable-next-line live-copy/wrap-text -- the brand logo, not wording */}
          <span className="brand-mark">f</span>
          <span className="logo-text">
            {/* eslint-disable-next-line live-copy/wrap-text -- the brand logo, not wording */}
            flowbase<span className="logo-dot">.</span>
          </span>
        </Link>
        <button
          className="workspace-switch"
          onClick={() => setCollapsed(!collapsed)}
          title="Toggle sidebar"
        >
          <span className="workspace-avatar">
            <Leaf size={17} />
          </span>
          <span className="sidebar-text">
            <strong>
              <T id="nav.workspace.name">CoreOps</T>
            </strong>
            <small>
              <T id="nav.workspace.kind">Catering workspace</T>
            </small>
          </span>
          <ChevronDown size={14} />
        </button>
        <div className="nav-label sidebar-text">
          <T id="nav.primary.label">WORKSPACE</T>
        </div>
        <nav className="primary-nav">
          {navigation.map(({ name, to, icon: Icon, key: copyKey }) => (
            <NavLink
              end={to === "/"}
              to={to}
              key={name}
              title={name}
              onClick={() => setMobile(false)}
            >
              <Icon size={19} />
              <span className="sidebar-text">
                <T id={copyKey}>{name}</T>
              </span>
              {name === "Proposals" && (
                <span className="nav-count sidebar-text">40</span>
              )}
              {["Purchasing", "Events"].includes(name) && (
                <span className="nav-placeholder sidebar-text">↗</span>
              )}
            </NavLink>
          ))}
          {(auth?.user.role === "admin" || auth?.user.role === "sales_manager") && (
            <NavLink to="/reports/operations" title="Operational reports" onClick={() => setMobile(false)}>
              <ChartNoAxesCombined size={19} />
              <span className="sidebar-text">
                <T id="nav.primary.operational-reports">Operational reports</T>
              </span>
            </NavLink>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="demo-sidebar-note sidebar-text">
            <span className="demo-note-label">
              <T id="nav.demo-note.label">A LITTLE LOOK AROUND</T>
            </span>
            <p>
              <T id="nav.demo-note.line-1">Your operations,</T>
              <br />
              <T id="nav.demo-note.line-2">in flow.</T>
            </p>
            <small>
              <T id="nav.demo-note.explore">Explore the interactive demo.</T>
            </small>
            <span className="demo-version">
              <T id="nav.demo-note.version">DEMO · v0.1</T>
            </span>
          </div>
          <nav className="secondary-nav">
            {[
              { name: "Settings", icon: Settings, to: "/settings", key: "nav.secondary.settings" },
              { name: "Help & resources", icon: CircleHelp, to: "/help", key: "nav.secondary.help" },
            ].map(({ name, icon: Icon, to, key: copyKey }) => (
              <NavLink
                to={to}
                key={to}
                title={name}
                onClick={() => setMobile(false)}
              >
                <Icon size={18} />
                <span className="sidebar-text">
                  <T id={copyKey}>{name}</T>
                </span>
              </NavLink>
            ))}
          </nav>
          <button
            className="sidebar-collapse"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen size={17} />
            ) : (
              <PanelLeftClose size={17} />
            )}
            <span className="sidebar-text">
              <T id="nav.collapse">Collapse sidebar</T>
            </span>
          </button>
          <Link
            to="/profile"
            className="profile"
            onClick={() => setMobile(false)}
          >
            <span className="avatar">
              {displayName.slice(0, 2).toUpperCase()}
            </span>
            <span className="sidebar-text">
              <strong>{displayName}</strong>
              <small>{auth ? roleLabel(auth.user.role) : ""}</small>
            </span>
            <ChevronDown size={15} />
          </Link>
        </div>
      </aside>
    </>
  );
}
function TopHeader({ setMobile }: { setMobile: (v: boolean) => void }) {
  const auth = useAuth();
  const permissions = usePermissions();
  const displayName = auth?.user.name ?? "Profile";
  const navigate = useNavigate();
  const [global, setGlobal] = useState(false);
  const [profile, setProfile] = useState(false);
  return (
    <>
      <header className="top-header">
        <button
          className="mobile-menu"
          aria-label="Open navigation"
          onClick={() => setMobile(true)}
        >
          <Menu size={22} />
        </button>
        <Breadcrumbs />
        <div className="header-right">
          <button
            className="global-search-trigger"
            aria-label="Search anything"
            onClick={() => setGlobal(true)}
          >
            <Search size={16} />
            <span>
              <T id="header.search.trigger">Search anything…</T>
            </span>
            <kbd>/</kbd>
          </button>
          {/* eslint-disable-next-line live-copy/wrap-text -- the DEMO badge stays fixed (FLOW-240) */}
          <span className="header-demo">DEMO</span>
          <NotificationBell />
          <LiveEditControls allowed={permissions.can("copy.edit")} />
          <div className="menu-wrap">
            <button
              className="avatar header-avatar"
              aria-label="Open profile menu"
              onClick={() => setProfile(!profile)}
            >
              {displayName.slice(0, 2).toUpperCase()}
            </button>
            {profile && (
              <div className="dropdown profile-dropdown">
                <strong>{displayName}</strong>
                <small>{auth ? roleLabel(auth.user.role) : ""}</small>
                <Link to="/profile" onClick={() => setProfile(false)}>
                  <T id="header.profile-menu.profile">Employee profile</T>
                </Link>
                {permissions.can("users.manage") && (
                  <Link to="/settings/users" onClick={() => setProfile(false)}>
                    <T id="header.profile-menu.users">Manage users</T>
                  </Link>
                )}
                <button onClick={() => void auth?.signOut()}>
                  <T id="header.profile-menu.sign-out">Sign out</T>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <DetailDrawer
        open={global}
        onClose={() => setGlobal(false)}
        title={<T id="header.search.title">Search your workspace</T>}
        description={
          <T id="header.search.description">
            Find clients, leads, events, venues and inventory items.
          </T>
        }
      >
        <GlobalSearch
          onOpen={(path) => {
            navigate(path);
            setGlobal(false);
          }}
        />
      </DetailDrawer>
    </>
  );
}
export function AppShell() {
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 1200);
  const [mobile, setMobile] = useState(false);
  useActivityTracking();
  return (
    <div className={`app-shell ${collapsed ? "shell-collapsed" : ""}`}>
      <a className="skip-link" href="#main-content">
        <T id="shell.skip-link">Skip to content</T>
      </a>
      <Sidebar {...{ collapsed, setCollapsed, mobile, setMobile }} />
      <div className="app-main">
        <TopHeader setMobile={setMobile} />
        <main id="main-content">
          <TrackingNotice />
          <Suspense
            fallback={
              <p role="status">
                <T id="shell.loading">Loading screen…</T>
              </p>
            }
          >
            <Outlet />
          </Suspense>
        </main>
        <footer className="app-footer">
          <span>
            <span className="footer-dot" /> <T id="shell.footer.workspace">Flowbase workspace.</T>
          </span>
          <span>
            <T id="shell.footer.sample">Dashboard contains sample data</T>
          </span>
        </footer>
      </div>
      {mobile && (
        <button
          className="drawer-mobile-close"
          aria-label="Close mobile navigation"
          onClick={() => setMobile(false)}
        >
          <X size={20} />
        </button>
      )}
    </div>
  );
}
