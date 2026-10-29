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
} from "lucide-react";
import { DetailDrawer } from "../shared";
import { TrackingNotice } from "../TrackingNotice";
import { GlobalSearch } from "../../features/search";
import { NotificationBell } from "../../features/notifications";
import { useActivityTracking } from "../../app/useActivityTracking";
import { useAuth } from "../../app/auth";
import { roleLabel } from "../../services/users";
const navigation = [
  { name: "Dashboard", to: "/", icon: LayoutDashboard },
  { name: "Leads", to: "/leads", icon: Inbox },
  { name: "Clients", to: "/clients", icon: Users },
  { name: "Proposals", to: "/proposals", icon: FileText },
  { name: "Inventory", to: "/inventory", icon: Package },
  { name: "Recipes", to: "/recipes", icon: ChefHat },
  { name: "Purchasing", to: "/purchasing", icon: ShoppingCart },
  { name: "Vendors", to: "/vendors", icon: Truck },
  { name: "Events", to: "/events", icon: CalendarDays },
  { name: "Calendar", to: "/calendar", icon: Calendar },
  { name: "Venues", to: "/venues", icon: MapPin },
  { name: "Staff", to: "/staff", icon: Contact },
  { name: "Reports", to: "/reports", icon: ChartNoAxesCombined },
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
      <span>Workspace</span>
      <span>/</span>
      <Link to={parts[0] ? `/${parts[0]}` : "/"}>{name}</Link>
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
          <span className="brand-mark">f</span>
          <span className="logo-text">
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
            <strong>CoreOps</strong>
            <small>Catering workspace</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <div className="nav-label sidebar-text">WORKSPACE</div>
        <nav className="primary-nav">
          {navigation.map(({ name, to, icon: Icon }) => (
            <NavLink
              end={to === "/"}
              to={to}
              key={name}
              title={name}
              onClick={() => setMobile(false)}
            >
              <Icon size={19} />
              <span className="sidebar-text">{name}</span>
              {name === "Proposals" && (
                <span className="nav-count sidebar-text">40</span>
              )}
              {["Purchasing", "Events"].includes(name) && (
                <span className="nav-placeholder sidebar-text">↗</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="demo-sidebar-note sidebar-text">
            <span className="demo-note-label">A LITTLE LOOK AROUND</span>
            <p>
              Your operations,
              <br />
              in flow.
            </p>
            <small>Explore the interactive demo.</small>
            <span className="demo-version">DEMO · v0.1</span>
          </div>
          <nav className="secondary-nav">
            {[
              { name: "Settings", icon: Settings, to: "/settings" },
              { name: "Help & resources", icon: CircleHelp, to: "/help" },
            ].map(({ name, icon: Icon, to }) => (
              <NavLink
                to={to}
                key={to}
                title={name}
                onClick={() => setMobile(false)}
              >
                <Icon size={18} />
                <span className="sidebar-text">{name}</span>
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
            <span className="sidebar-text">Collapse sidebar</span>
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
            <span>Search anything…</span>
            <kbd>/</kbd>
          </button>
          <span className="header-demo">DEMO</span>
          <NotificationBell />
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
                  Employee profile
                </Link>
                {permissions.can("users.manage") && (
                  <Link to="/settings/users" onClick={() => setProfile(false)}>
                    Manage users
                  </Link>
                )}
                <button onClick={() => void auth?.signOut()}>Sign out</button>
              </div>
            )}
          </div>
        </div>
      </header>
      <DetailDrawer
        open={global}
        onClose={() => setGlobal(false)}
        title="Search your workspace"
        description="Find clients, leads, events, venues and inventory items."
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
        Skip to content
      </a>
      <Sidebar {...{ collapsed, setCollapsed, mobile, setMobile }} />
      <div className="app-main">
        <TopHeader setMobile={setMobile} />
        <main id="main-content">
          <TrackingNotice />
          <Suspense fallback={<p role="status">Loading screen…</p>}><Outlet /></Suspense>
        </main>
        <footer className="app-footer">
          <span>
            <span className="footer-dot" /> Flowbase workspace.
          </span>
          <span>Dashboard and proposals contain sample data</span>
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
