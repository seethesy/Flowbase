import { usePermissions } from "../../app/permissions";
import { Fragment, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { useResource } from "../../app/useResource";
import { clientsApi, eventsApi, inventoryApi, recipesApi, venuesApi } from "../../services/core";
import { leadsApi } from "../../services/leads";
import { vendorsApi } from "../../services/vendors";
import { staffApi } from "../../services/staff";
import {
  Navigate,
  Outlet,
  Link,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  LayoutDashboard,
  Inbox,
  FileText,
  Package,
  ChefHat,
  CalendarDays,
  ChartNoAxesCombined,
  Settings,
  CircleHelp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
  Menu,
  X,
  Leaf,
  Contact,
  Image as ImageIcon,
  type LucideIcon,
} from "lucide-react";
import { DetailDrawer, RoleText } from "../shared";
import { TrackingNotice } from "../TrackingNotice";
import { GlobalSearch } from "../../features/search";
import { NotificationBell } from "../../features/notifications";
import { useActivityTracking } from "../../app/useActivityTracking";
import { LiveEditControls, LiveEditLayer } from "../../app/live-edit";
import { T, useLiveEdit } from "../../app/copy";
import { useAuth } from "../../app/auth";
import {
  breadcrumbTrail,
  firstVisiblePage,
  matchNavigation,
  navigationGroups,
  navKey,
  pageHiddenFrom,
  secondaryPages,
  visibleGroups,
  visibleTabs,
  type NavGroup,
  type NavTab,
  type RecordKind,
} from "../../app/navigation";
const groupIcons: Record<string, LucideIcon> = {
  Dashboard: LayoutDashboard,
  Sales: Inbox,
  Events: CalendarDays,
  Staffing: Contact,
  Inventory: Package,
  Kitchen: ChefHat,
  Marketing: ImageIcon,
  Documents: FileText,
  Reports: ChartNoAxesCombined,
};
// Headings, tabs and crumbs share one key per name (nav.<name>, FLOW-240), so an
// edited name reads the same in the sidebar, the tabs and the breadcrumb.
// Navigation links say which heading they came from,
// so the sidebar, tabs and breadcrumb stay on it.
type NavState = { navGroup?: string } | null;
function useNavMatch() {
  const location = useLocation();
  const state = location.state as NavState;
  return {
    pathname: location.pathname,
    preferredGroup: state?.navGroup,
    match: matchNavigation(location.pathname, state?.navGroup),
  };
}
export function Breadcrumbs() {
  const { pathname, preferredGroup } = useNavMatch();
  const { actor } = usePermissions();
  const crumbs = breadcrumbTrail(pathname, actor, preferredGroup);
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {crumbs.map((crumb, index) => {
        const label = crumb.record ? (
          <RecordName key={pathname} {...crumb.record} fallback={crumb.label} />
        ) : (
          <T id={navKey(crumb.copyId)}>{crumb.label}</T>
        );
        return (
          <span className={index === 0 ? "crumb crumb-root" : "crumb"} key={`${index}:${crumb.label}`}>
            {index > 0 && <span className="crumb-separator" aria-hidden="true">/</span>}
            {crumb.to ? (
              <Link to={crumb.to} state={preferredGroup ? { navGroup: preferredGroup } : undefined}>
                {label}
              </Link>
            ) : (
              <span aria-current="page">{label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
const recordNames: Record<RecordKind, (id: string) => Promise<{ name?: string; title?: string }>> = {
  clients: (id) => clientsApi.get(id),
  leads: (id) => leadsApi.get(id),
  events: (id) => eventsApi.get(id),
  venues: (id) => venuesApi.get(id),
  vendors: (id) => vendorsApi.get(id),
  inventory: (id) => inventoryApi.get(id),
  recipes: (id) => recipesApi.get(id),
  staff: (id) => staffApi.get(id),
};
function RecordName({ kind, id, fallback }: { kind: RecordKind; id: string; fallback: string }) {
  const record = useResource(["breadcrumb", kind, id], async () => {
    const result = await recordNames[kind](id);
    return { name: result.name ?? result.title ?? "" };
  });
  return <>{record.data?.name || fallback}</>;
}
const COLLAPSED_KEY = "flowbase.sidebar.collapsed";
// Remembered per browser (FLOW-246). Storage can be unavailable (private mode).
function storedCollapsed() {
  try {
    const stored = window.localStorage.getItem(COLLAPSED_KEY);
    if (stored !== null) return stored === "true";
  } catch {
    // Fall through to the screen-width default.
  }
  return window.innerWidth < 1200;
}
function storeCollapsed(value: boolean) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, String(value));
  } catch {
    // Not remembered; the toggle still works for this visit.
  }
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
  const { actor } = usePermissions();
  const { match, pathname } = useNavMatch();
  const displayName = auth?.user.name ?? "Profile";
  const groups = visibleGroups(actor);
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
          <span className="brand-mark"><T id="app-shell.sidebar.f">f</T></span>
          <span className="logo-text">
            <T id="app-shell.sidebar.flowbase">flowbase</T><span className="logo-dot">.</span>
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
            <strong><T id="app-shell.sidebar.coreops">CoreOps</T></strong>
            <small><T id="app-shell.sidebar.catering-workspace">Catering workspace</T></small>
          </span>
          <ChevronDown size={14} />
        </button>
        <div className="nav-label sidebar-text"><T id="app-shell.sidebar.workspace">WORKSPACE</T></div>
        <nav className="primary-nav" aria-label="Main">
          {groups.map(({ copyId, name, tabs }) => {
            const Icon = groupIcons[name] ?? LayoutDashboard;
            // The heading stays highlighted on any of its tabs or record pages.
            const active = match?.group.name === name;
            const group = navigationGroups.find((each) => each.copyId === copyId);
            return (
              <Fragment key={name}>
                <Link
                  to={tabs[0].to}
                  state={{ navGroup: name }}
                  title={name}
                  className={active ? "active" : undefined}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setMobile(false)}
                >
                  <Icon size={19} />
                  <span className="sidebar-text">
                    <T id={navKey(copyId)}>{name}</T>
                  </span>
                </Link>
                {/* Live edit (FLOW-284): which roles see this heading. */}
                {group && <NavWhoSees group={group} />}
              </Fragment>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <nav className="secondary-nav" aria-label="Settings and help">
            {secondaryPages.map(({ copyId, name, to }) => {
              const Icon = to === "/settings" ? Settings : CircleHelp;
              const active = pathname === to || pathname.startsWith(`${to}/`);
              return (
                <Link
                  to={to}
                  key={to}
                  title={name}
                  className={active ? "active" : undefined}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setMobile(false)}
                >
                  <Icon size={18} />
                  <span className="sidebar-text">
                    <T id={navKey(copyId)}>{name}</T>
                  </span>
                </Link>
              );
            })}
          </nav>
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
              <small>{auth ? <RoleText role={auth.user.role} /> : ""}</small>
            </span>
            <ChevronDown size={15} />
          </Link>
        </div>
      </aside>
      {/* Full-height collapse edge on the sidebar's right eighth (FLOW-246). */}
      <button
        type="button"
        className="sidebar-edge"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className="sidebar-edge-bar" aria-hidden="true">
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </span>
      </button>
    </>
  );
}
// The current heading's sub-pages, as tabs at the top of the page (FLOW-246).
function SectionTabs() {
  const { actor } = usePermissions();
  const { match } = useNavMatch();
  if (!match) return null;
  const tabs = visibleTabs(match.group, actor);
  if (tabs.length < 2) return null;
  return (
    <nav className="section-tabs" aria-label={`${match.group.name} pages`}>
      {tabs.map((tab) => {
        const active = tab.to === match.tab.to;
        return (
          <Fragment key={tab.to}>
            <Link
              to={tab.to}
              state={{ navGroup: match.group.name }}
              className={active ? "active" : undefined}
              aria-current={active ? "page" : undefined}
            >
              <T id={navKey(tab.copyId)}>{tab.name}</T>
            </Link>
            {/* Live edit (FLOW-284): which roles see this tab. */}
            <NavWhoSees group={match.group} tab={tab} />
          </Fragment>
        );
      })}
    </nav>
  );
}
// What a hidden page shows (FLOW-284), loaded only when one is opened.
const HiddenPage = lazy(() =>
  import("../../app/nav-visibility-editor").then((module) => ({ default: module.HiddenPage })),
);

// The live-edit "Who sees this" popover (FLOW-284), loaded only in edit mode so
// it stays out of the first load.
const NavWhoSeesEditor = lazy(() =>
  import("../../app/nav-visibility-editor").then((module) => ({ default: module.NavWhoSees })),
);
function NavWhoSees(props: { group: NavGroup; tab?: NavTab }) {
  const { editing } = useLiveEdit();
  if (!editing) return null;
  return (
    <Suspense fallback={null}>
      <NavWhoSeesEditor {...props} />
    </Suspense>
  );
}

// A direct link to a page the Admin hid from this role (FLOW-284 req. 5): an
// empty state with a link to the role's first page. The landing page (/) goes
// straight to that first page. The API still answers by area permissions.
function HiddenPageGuard({ children }: { children: ReactNode }) {
  const { actor } = usePermissions();
  const { match, pathname } = useNavMatch();
  if (!actor || !match || !pageHiddenFrom(match, actor)) return <>{children}</>;
  const first = firstVisiblePage(actor);
  if (pathname === "/" && first && first !== "/") return <Navigate to={first} replace />;
  return (
    <Suspense fallback={null}>
      <HiddenPage first={first} />
    </Suspense>
  );
}
function TopHeader({ setMobile }: { setMobile: (v: boolean) => void }) {
  const auth = useAuth();
  const permissions = usePermissions();
  const displayName = auth?.user.name ?? "Profile";
  const navigate = useNavigate();
  const location = useLocation();
  const [global, setGlobal] = useState(false);
  const [profile, setProfile] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  // The profile menu closes on an outside click, Escape, or navigation (FLOW-247).
  useEffect(() => setProfile(false), [location.key, location.pathname]);
  useEffect(() => {
    if (!profile) return;
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setProfile(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfile(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [profile]);
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
            <span><T id="app-shell.top-header.search-anything">Search anything…</T></span>
          </button>
          <NotificationBell />
          <LiveEditControls />
          <div className="menu-wrap" ref={menu}>
            <button
              className="avatar header-avatar"
              aria-label="Open profile menu"
              aria-expanded={profile}
              onClick={() => setProfile(!profile)}
            >
              {displayName.slice(0, 2).toUpperCase()}
            </button>
            {profile && (
              <div className="dropdown profile-dropdown">
                <strong>{displayName}</strong>
                <small>{auth ? <RoleText role={auth.user.role} /> : ""}</small>
                <Link to="/profile" onClick={() => setProfile(false)}>
                  <T id="app-shell.top-header.employee-profile">Employee profile</T>
                </Link>
                {permissions.can("users.manage") && (
                  <Link to="/settings/users" onClick={() => setProfile(false)}>
                    <T id="app-shell.top-header.manage-users">Manage users</T>
                  </Link>
                )}
                <button onClick={() => void auth?.signOut()}><T id="app-shell.top-header.sign-out">Sign out</T></button>
              </div>
            )}
          </div>
        </div>
      </header>
      <DetailDrawer
        open={global}
        onClose={() => setGlobal(false)}
        title={<T id="app-shell.top-header.search-your-workspace">Search your workspace</T>}
        description={<T id="app-shell.top-header.find-clients-leads-events-venues">Find clients, leads, events, venues and inventory items.</T>}
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
  const location = useLocation();
  const dashboardParams = new URLSearchParams(location.search);
  const dashboardRole = dashboardParams.get("dashboardRole");
  const [collapsed, setCollapsedState] = useState(storedCollapsed);
  const setCollapsed = (value: boolean) => {
    setCollapsedState(value);
    storeCollapsed(value);
  };
  const [mobile, setMobile] = useState(false);
  useActivityTracking();
  return (
    <div className={`app-shell ${collapsed ? "shell-collapsed" : ""}`}>
      <a className="skip-link" href="#main-content">
        <T id="app-shell.app-shell.skip-to-content">Skip to content</T>
      </a>
      <Sidebar {...{ collapsed, setCollapsed, mobile, setMobile }} />
      <div className="app-main">
        <TopHeader setMobile={setMobile} />
        <main id="main-content">
          <TrackingNotice />
          <SectionTabs />
          {dashboardParams.get("fromDashboard") === "1" && <Link className="back-link" to={`/${dashboardRole ? `?role=${encodeURIComponent(dashboardRole)}` : ""}`}><T id="app-shell.app-shell.back-to-dashboard">← Back</T></Link>}
          <HiddenPageGuard>
            <Suspense fallback={<p role="status"><T id="app-shell.app-shell.loading-screen">Loading screen…</T></p>}><Outlet /></Suspense>
          </HiddenPageGuard>
        </main>
        <footer className="app-footer">
          <span>
            <span className="footer-dot" /><T id="app-shell.app-shell.flowbase-workspace">{" Flowbase workspace."}</T>
          </span>
          <span><T id="app-shell.app-shell.dashboard-contains-sample-data">Dashboard contains sample data</T></span>
        </footer>
      </div>
      <LiveEditLayer />
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
