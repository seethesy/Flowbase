import { useEffect, useRef, useState } from "react";
import { Eye } from "lucide-react";
import { roles, type Role } from "../../../shared/access";
import { Link } from "react-router-dom";
import { navHidden, navTabKey, normalizeNavHidden, setNavHidden, type NavHidden } from "../../../shared/nav-visibility";
import { navVisibilitySchema } from "../../../shared/nav-visibility-schema";
import { EmptyState } from "../../components/shared";
import { request } from "../../services/core";
import { areas } from "../../../shared/role-permissions";
import { RoundCheck } from "../../components/ui/round-check";
import { roleLabel } from "../../services/users";
import { T, useLiveEdit } from "../copy";
import { canSee, type NavGroup, type NavTab } from "../navigation";
import { usePermissions } from "../permissions";

// Who sees each sidebar heading and tab (FLOW-284): the reach rules that the
// Settings grid and the live-edit "Who sees this" popover share. Admin
// configuration chrome, so its wording isn't wrapped in <T> (like the live-edit
// chrome in src/app).

const roleActor = (role: Role) => ({ userId: "00000000-0000-4000-8000-000000000000", role });

// A heading's Overview tab (FLOW-295) opens when another tab under it does.
const isOverview = (group: NavGroup, tab: NavTab) =>
  tab.copyId === "overview" && typeof tab.visible === "function" && group.tabs[0] === tab;

// Why a role can't open a tab whatever the setting says, or null if it can. The
// setting only narrows, so such a cell has no effect (AC3).
export function tabBlocked(group: NavGroup, tab: NavTab, role: Role): string | null {
  if (role === "admin") return null;
  const actor = roleActor(role);
  if (isOverview(group, tab))
    return group.tabs.slice(1).some((other) => canSee(other, actor)) ? null : `Nothing else under ${group.name} for this role`;
  if (canSee(tab, actor)) return null;
  if (typeof tab.visible === "string") {
    const area = areas.find((each) => [...each.read, ...each.write].includes(tab.visible as never));
    if (area) return `No access to ${area.label}`;
  }
  return "This role can't open it";
}
export const headingBlocked = (group: NavGroup, role: Role): string | null =>
  group.tabs.some((tab) => !tabBlocked(group, tab, role)) ? null : `No access to anything under ${group.name}`;

export const keyOf = (group: NavGroup, tab?: NavTab) => (tab ? navTabKey(group.copyId, tab.copyId) : group.copyId);

// The setting with one cell changed: shown (true) takes the key off the role's
// hidden list.
export function withCell(hidden: NavHidden, role: Role, key: string, shown: boolean): NavHidden {
  const list = hidden[role].filter((each) => each !== key);
  return normalizeNavHidden({ ...hidden, [role]: shown ? list : [...list, key] });
}

const sameHidden = (a: NavHidden, b: NavHidden) =>
  JSON.stringify(normalizeNavHidden(a)) === JSON.stringify(normalizeNavHidden(b));

// The live-edit "Who sees this" button and popover beside a sidebar heading or
// a tab (FLOW-284 req. 3). Changes stay pending until the live-edit Save.
export function NavWhoSees({ group, tab }: { group: NavGroup; tab?: NavTab }) {
  const live = useLiveEdit();
  const { can } = usePermissions();
  const [open, setOpen] = useState(false);
  // Fixed under the button, so the tab bar's scroll box doesn't clip it.
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  if (!live.editing || !can("users.manage")) return null;
  const name = tab ? `${group.name} › ${tab.name}` : group.name;
  const key = keyOf(group, tab);
  const current = live.navPending ?? navHidden();
  const set = (role: Role, shown: boolean) => {
    const next = withCell(current, role, key, shown);
    live.stageNav(sameHidden(next, navHidden()) ? null : next);
  };
  return (
    <span className="nav-who-sees" ref={wrap}>
      <button
        type="button"
        className="nav-who-sees-toggle"
        aria-label={`Who sees ${name}`}
        title="Who sees this"
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          setPosition({
            top: Math.min(rect.bottom + 6, window.innerHeight - 320),
            left: Math.max(8, Math.min(rect.left, window.innerWidth - 288)),
          });
          setOpen(!open);
        }}
      >
        <Eye size={14} />
      </button>
      {open && (
        <div
          className="nav-who-sees-popover"
          role="dialog"
          aria-label={`Who sees ${name}`}
          style={position}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") setOpen(false);
          }}
        >
          <strong>Who sees this</strong>
          <p className="muted">Hides it from the sidebar, tabs and breadcrumb. The role's permissions still apply.</p>
          <ul>
            {roles.map((role) => {
              const headingOff = !!tab && current[role].includes(group.copyId);
              const blocked = role === "admin" ? null : headingOff ? `${group.name} is hidden` : tab ? tabBlocked(group, tab, role) : headingBlocked(group, role);
              const shown = role === "admin" || (!headingOff && !current[role].includes(key));
              return (
                <li key={role}>
                  <label title={blocked ?? undefined}>
                    <RoundCheck
                      checked={shown && !blocked}
                      disabled={role === "admin" || !!blocked}
                      onChange={(event) => set(role, event.target.checked)}
                    />
                    {roleLabel(role)}
                    {role === "admin" ? <small> always</small> : blocked ? <small> {blocked}</small> : null}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </span>
  );
}

// Saves the live-edit "Who sees this" changes with the live-edit Save. The
// sidebar, tabs and breadcrumb re-read the setting (src/app/auth.tsx).
export async function saveNavHidden(next: NavHidden) {
  const { hidden } = await request(navVisibilitySchema, "/api/permissions/navigation", "PUT", { hidden: next });
  setNavHidden(hidden);
  window.dispatchEvent(new Event("flowbase:policy-changed"));
}

// A page the Admin hid from this role (FLOW-284 req. 5), with a link to the
// role's first visible page. The API still answers by area permissions.
export function HiddenPage({ first }: { first: string | null }) {
  return (
    <section className="panel hidden-page">
      <EmptyState
        title={<T id="app-shell.hidden-page.title">Not available for your role</T>}
        description={<T id="app-shell.hidden-page.description">Your Admin has hidden this page for your role.</T>}
      />
      {first && (
        <p className="hidden-page-link">
          <Link to={first}>
            <T id="app-shell.hidden-page.go-to-first-page">Go to your first page</T>
          </Link>
        </p>
      )}
    </section>
  );
}
