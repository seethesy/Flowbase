import { useState } from "react";
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
  FileText,
  Package,
  ShoppingCart,
  CalendarDays,
  ChartNoAxesCombined,
  Settings,
  CircleHelp,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  Bell,
  Search,
  Menu,
  X,
  ArrowUpRight,
  Leaf,
  Plus,
} from "lucide-react";
import { Button, DetailDrawer, SearchInput, EmptyState } from "../shared";
import { useDemo } from "../../app/store";
import { RecordForm } from "../../features/forms";
const navigation = [
  { name: "Dashboard", to: "/", icon: LayoutDashboard },
  { name: "CRM", to: "/crm", icon: Users },
  { name: "Contracts", to: "/contracts", icon: FileText },
  { name: "Inventory", to: "/inventory", icon: Package },
  { name: "Purchasing", to: "/purchasing", icon: ShoppingCart },
  { name: "Events", to: "/events", icon: CalendarDays },
  { name: "Reports", to: "/reports", icon: ChartNoAxesCombined },
];
export function Breadcrumbs() {
  const location = useLocation();
  const store = useDemo();
  const parts = location.pathname.split("/").filter(Boolean);
  const name =
    parts[0] === "crm"
      ? "CRM"
      : parts[0]
        ? parts[0][0].toUpperCase() + parts[0].slice(1)
        : "Dashboard";
  const record =
    parts[0] === "crm"
      ? store.customers.find(parts[1])?.name
      : store.inventory.find(parts[1])?.name;
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <span>Workspace</span>
      <span>/</span>
      <Link to={parts[0] ? `/${parts[0]}` : "/"}>{name}</Link>
      {record && (
        <>
          <span>/</span>
          <span>{record}</span>
        </>
      )}
    </nav>
  );
}
export function Sidebar({
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
              {name === "Contracts" && (
                <span className="nav-count sidebar-text">40</span>
              )}
              {["Purchasing", "Events", "Reports"].includes(name) && (
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
            <span className="avatar">AC</span>
            <span className="sidebar-text">
              <strong>Alex Chen</strong>
              <small>Operations manager</small>
            </span>
            <ChevronDown size={15} />
          </Link>
        </div>
      </aside>
    </>
  );
}
export function TopHeader({ setMobile }: { setMobile: (v: boolean) => void }) {
  const store = useDemo();
  const navigate = useNavigate();
  const location = useLocation();
  const [global, setGlobal] = useState(false);
  const [search, setSearch] = useState("");
  const [alerts, setAlerts] = useState(false);
  const [create, setCreate] = useState(false);
  const [profile, setProfile] = useState(false);
  const kind = location.pathname.startsWith("/inventory")
    ? "item"
    : location.pathname === "/crm"
      ? "customer"
      : "contract";
  const results = search.trim()
    ? [
        ...store.customers.records
          .map((c) => ({
            id: c.id,
            title: c.name,
            kind: "Customer",
            path: `/crm/${c.id}`,
          })),
        ...store.inventory.records
          .map((i) => ({
            id: i.id,
            title: i.name,
            kind: i.id,
            path: `/inventory/${i.id}`,
          })),
        ...store.contracts.records
          .map((c) => ({
            id: c.id,
            title: c.name,
            kind: "Contract",
            path: `/contracts?view=table&q=${encodeURIComponent(c.id)}`,
          })),
      ]
        .filter((r) =>
          (r.title + " " + r.id).toLowerCase().includes(search.toLowerCase()),
        )
        .slice(0, 12)
    : [];
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
            onClick={() => setGlobal(true)}
          >
            <Search size={16} />
            <span>Search anything…</span>
            <kbd>/</kbd>
          </button>
          <span className="header-demo">DEMO</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Notifications"
            className="notification-button"
            onClick={() => setAlerts(true)}
          >
            <Bell size={19} />
            <span className="notification-dot" />
          </Button>
          <div className="menu-wrap">
            <button
              className="avatar header-avatar"
              aria-label="Open profile menu"
              onClick={() => setProfile(!profile)}
            >
              AC
            </button>
            {profile && (
              <div className="dropdown profile-dropdown">
                <strong>Alex Chen</strong>
                <small>Operations manager</small>
                <Link to="/profile" onClick={() => setProfile(false)}>
                  Employee profile
                </Link>
                <button
                  onClick={() => {
                    setProfile(false);
                    store.notify("Demo data resets when you refresh the page.");
                  }}
                >
                  About this session
                </button>
              </div>
            )}
          </div>
          <Button
            size="icon"
            aria-label={`Quick new ${kind}`}
            onClick={() => setCreate(true)}
          >
            <Plus size={17} />
          </Button>
        </div>
      </header>
      <DetailDrawer
        open={global}
        onClose={() => setGlobal(false)}
        title="Search your workspace"
        description="Find fictional customers, contracts, and inventory items."
      >
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search demo records…"
        />
        {results.map((r) => (
          <button
            key={`${r.kind}-${r.id}`}
            className="search-result"
            onClick={() => {
              navigate(r.path);
              setGlobal(false);
              setSearch("");
            }}
          >
            <div>
              <strong>{r.title}</strong>
              <small>{r.kind}</small>
            </div>
            <ArrowUpRight size={17} />
          </button>
        ))}
        {!results.length && (
          <EmptyState
            title={search ? "No matching records" : "Everything, in one place"}
            description={
              search
                ? "Try another name or SKU."
                : "Type a name, contract number, or SKU to begin."
            }
          />
        )}
      </DetailDrawer>
      <DetailDrawer
        open={alerts}
        onClose={() => setAlerts(false)}
        title="Notifications"
        description="Sample alerts from your demo workspace."
      >
        <Link
          className="notification-row"
          to="/inventory?status=Alerts"
          onClick={() => setAlerts(false)}
        >
          <Package size={20} />
          <div>
            <strong>Inventory needs attention</strong>
            <p>Review low-stock and out-of-stock items.</p>
          </div>
        </Link>
        <Link
          className="notification-row"
          to="/contracts?stage=Sent"
          onClick={() => setAlerts(false)}
        >
          <FileText size={20} />
          <div>
            <strong>Proposals ready for follow-up</strong>
            <p>Your team has sent contracts to review.</p>
          </div>
        </Link>
        <Link
          className="notification-row"
          to="/crm/cus-1"
          onClick={() => setAlerts(false)}
        >
          <CalendarDays size={20} />
          <div>
            <strong>Tomorrow’s event</strong>
            <p>Autumn leadership retreat · 40 guests</p>
          </div>
        </Link>
      </DetailDrawer>
      {create && <RecordForm kind={kind} onClose={() => setCreate(false)} />}
    </>
  );
}
export function AppShell() {
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 1200);
  const [mobile, setMobile] = useState(false);
  return (
    <div className={`app-shell ${collapsed ? "shell-collapsed" : ""}`}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Sidebar {...{ collapsed, setCollapsed, mobile, setMobile }} />
      <div className="app-main">
        <TopHeader setMobile={setMobile} />
        <main id="main-content">
          <Outlet />
        </main>
        <footer className="app-footer">
          <span>
            <span className="footer-dot" /> Fictional data. Real possibilities.
          </span>
          <span>Interactive prototype · Changes reset on refresh</span>
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
