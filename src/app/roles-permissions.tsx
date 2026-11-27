import { Block, PageGrid } from "./live-edit/page-grid";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Dropdown } from "../components/ui/Dropdown";
import { Button, LoadingSkeleton, PageHeader, Section, ErrorText } from "../components/shared";
import { roles, type Role } from "../../shared/access";
import { layoutItemGone, type LayoutBlock, type LayoutDoc } from "../../shared/layout";
import {
  areas,
  cardShown,
  dashboardCards,
  DASHBOARD_PAGE_KEY,
  levelLabels,
  levelsFor,
  permissionsSchema,
  setPolicyMatrix,
  type AreaKey,
  type Level,
  type Matrix,
} from "../../shared/role-permissions";
import { setNavHidden, type NavHidden } from "../../shared/nav-visibility";
import { navVisibilitySchema } from "../../shared/nav-visibility-schema";
import { layoutApi } from "../services/layout";
import { request } from "../services/core";
import { roleLabel } from "../services/users";
import { useResource } from "./useResource";
import { usePermissions } from "./permissions";
import { codeDefault, withBuiltins, type BuiltinBlock } from "./live-edit/layout-state";
import { layoutQueryKey } from "./copy";
import { queryClient } from "./queryClient";
import { navigationGroups, type NavGroup, type NavTab } from "./navigation";
import { headingBlocked, keyOf, tabBlocked, withCell } from "./live-edit/nav-visibility-editor";
import { RoundCheck } from "../components/ui/round-check";
import "./roles-permissions.css";

// Settings › Roles & permissions (FLOW-269): a grid of areas × roles, each cell a
// colored pill dropdown (None / Read / Own / Write), and a second grid for which
// roles see each dashboard and custom card. Changes stay a draft behind a sticky
// bar until Save; Admin's column is locked. Admin configuration chrome, so its
// wording isn't wrapped in <T> (like the live-edit chrome in src/app).

const pillClass = (level: string) => `perm-pill perm-pill--${level}`;
const dashboardBuiltins: BuiltinBlock[] = dashboardCards.map((card) => ({
  id: card.key,
  name: card.label,
  w: 6,
  h: 12,
}));

// Which roles see each card: block id -> roles (absent = every role).
type CardRoles = Record<string, Role[] | undefined>;
type CardRow = { id: string; name: string };

function cardRows(doc: LayoutDoc | null): CardRow[] {
  const custom = (doc?.blocks ?? []).flatMap((block) =>
    block.kind === "card" && !layoutItemGone(block) ? [{ id: block.id, name: block.card.title }] : [],
  );
  return [...dashboardCards.filter((card) => !doc?.blocks.some((block) => block.id === card.key && layoutItemGone(block))).map((card) => ({ id: card.key, name: card.label })), ...custom];
}
function cardRolesOf(doc: LayoutDoc | null): CardRoles {
  const result: CardRoles = {};
  for (const block of doc?.blocks ?? [])
    if (block.kind === "builtin" || block.kind === "card") result[block.id] = block.visibleTo;
  return result;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function RolesPermissionsPage() {
  const { can } = usePermissions();
  const loaded = useResource(["permissions", "editor"], async () => {
    const [{ matrix }, layout, { hidden }] = await Promise.all([
      request(permissionsSchema, "/api/permissions"),
      layoutApi.get(DASHBOARD_PAGE_KEY),
      request(navVisibilitySchema, "/api/permissions/navigation"),
    ]);
    return { matrix, doc: layout?.layout ?? null, hidden };
  });
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [cards, setCards] = useState<CardRoles>({});
  const [nav, setNav] = useState<NavHidden | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!loaded.data) return;
    setMatrix(loaded.data.matrix);
    setCards(cardRolesOf(loaded.data.doc));
    setNav(loaded.data.hidden);
  }, [loaded.data]);
  const rows = useMemo(() => cardRows(loaded.data?.doc ?? null), [loaded.data]);

  if (!can("users.manage")) return <p role="alert">Only Admin can change roles and permissions.</p>;

  const savedMatrix = loaded.data?.matrix;
  const savedCards = cardRolesOf(loaded.data?.doc ?? null);
  const matrixDirty = !!matrix && !!savedMatrix && !sameJson(matrix, savedMatrix);
  const cardsDirty = rows.some((row) => !sameJson(cards[row.id], savedCards[row.id]));
  const navDirty = !!nav && !!loaded.data && !sameJson(nav, loaded.data.hidden);
  const dirty = matrixDirty || cardsDirty || navDirty;

  const setLevel = (role: Role, area: AreaKey, level: Level) =>
    setMatrix((current) => current && { ...current, [role]: { ...current[role], [area]: level } });
  const toggleCard = (id: string, role: Role, shown: boolean) =>
    setCards((current) => {
      const base = current[id] ?? [...roles];
      const next = shown ? roles.filter((r) => r === role || base.includes(r)) : base.filter((r) => r !== role);
      return { ...current, [id]: next.length === roles.length ? undefined : next };
    });
  const discard = () => {
    if (!loaded.data) return;
    setMatrix(loaded.data.matrix);
    setCards(cardRolesOf(loaded.data.doc));
    setNav(loaded.data.hidden);
    setError("");
    setNotice("");
  };

  const save = async () => {
    if (!matrix || !loaded.data) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      if (matrixDirty) {
        const result = await request(permissionsSchema, "/api/permissions", "PUT", { matrix });
        setPolicyMatrix(result.matrix);
      }
      if (cardsDirty) {
        const doc = loaded.data.doc;
        // The dashboard.s page grid (FLOW-319), saved as version 3 (FLOW-357).
        const base: LayoutDoc = doc ? withBuiltins(doc, dashboardBuiltins) : codeDefault(dashboardBuiltins);
        const blocks = base.blocks.map(
          (block): LayoutBlock => (block.kind === "text" ? block : { ...block, visibleTo: cards[block.id] }),
        );
        await layoutApi.save(DASHBOARD_PAGE_KEY, { ...base, blocks });
        await queryClient.invalidateQueries({ queryKey: layoutQueryKey(DASHBOARD_PAGE_KEY) });
      }
      if (navDirty && nav) {
        const result = await request(navVisibilitySchema, "/api/permissions/navigation", "PUT", { hidden: nav });
        setNavHidden(result.hidden);
      }
      loaded.reload();
      setNotice("Permissions saved. They apply from each person's next request.");
      // Show it in this browser now: other screens read `can` on render.
      window.dispatchEvent(new Event("flowbase:policy-changed"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save. Please retry.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Link className="back-link" to="/settings">
        ← Settings
      </Link>
      <PageHeader pageKey="settings.permissions"
        title="Roles & permissions"
        subtitle="What each role can read or write, area by area, and which roles see each dashboard card, sidebar heading and tab."
      />
      {loaded.error ? (
        <ErrorText message={loaded.error} />
      ) : !matrix ? (
        <LoadingSkeleton />
      ) : (
        <>
          <PageGrid pageKey="settings.permissions">
          <Block id="areas" name="Area permissions" h={24}>
          <Section title="Areas">
            <p className="muted">
              None hides the area. Read lets a role view every record. Own lets a role work only on records assigned to
              them. Write lets a role change every record. Admin always has Write.
            </p>
            <div className="table-scroll">
              <table className="perm-grid" aria-label="Area permissions by role">
                <thead>
                  <tr>
                    <th scope="col">Area</th>
                    {roles.map((role) => (
                      <th scope="col" key={role}>
                        {roleLabel(role)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {areas.map((area) => (
                    <tr key={area.key}>
                      <th scope="row">{area.label}</th>
                      {roles.map((role) => (
                        <td key={role}>
                          {role === "admin" ? (
                            <span
                              className={pillClass("write")}
                              aria-label={`${area.label} for ${roleLabel(role)}: Write, locked`}
                            >
                              {levelLabels.write}
                            </span>
                          ) : (
                            <Dropdown
                              variant="pill"
                              aria-label={`${area.label} for ${roleLabel(role)}`}
                              value={matrix[role][area.key]}
                              pill={pillClass}
                              options={levelsFor(area).map((option) => ({ value: option, label: levelLabels[option] }))}
                              onValueChange={(next) => setLevel(role, area.key, next as Level)}
                            />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          </Block>
          <Block id="cards" name="Card visibility" h={16}>
          <Section title="Dashboard and custom cards">
            <p className="muted">
              A card shows only to the roles marked Visible, and only if the role can also read the area it comes from.
            </p>
            <div className="table-scroll">
              <table className="perm-grid" aria-label="Card visibility by role">
                <thead>
                  <tr>
                    <th scope="col">Card</th>
                    {roles.map((role) => (
                      <th scope="col" key={role}>
                        {roleLabel(role)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <th scope="row">{row.name}</th>
                      {roles.map((role) => (
                        <td key={role}>
                          <Dropdown
                            variant="pill"
                            aria-label={`${row.name} for ${roleLabel(role)}`}
                            value={cardShown(cards[row.id], role) ? "visible" : "hidden"}
                            pill={(value) => pillClass(value === "visible" ? "write" : "none")}
                            options={[
                              { value: "visible", label: "Visible" },
                              { value: "hidden", label: "Hidden" },
                            ]}
                            onValueChange={(next) => toggleCard(row.id, role, next === "visible")}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          </Block>
          {nav && (
            <Block id="navigation" name="Navigation visibility" h={24}>
              <NavigationSection hidden={nav} onChange={setNav} />
            </Block>
          )}
          </PageGrid>
          <ErrorText message={error} />
          {notice && <p role="status">{notice}</p>}
          {dirty && (
            <div className="perm-save-bar" role="region" aria-label="Unsaved changes">
              <span>You have unsaved changes.</span>
              <Button variant="outline" onClick={discard} disabled={saving}>
                Discard
              </Button>
              <Button onClick={() => void save()} disabled={saving}>
                {saving ? "Saving…" : "Save permissions"}
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}

// Which roles see each sidebar heading and tab (FLOW-284): headings with their
// tabs under them, a checkbox per role. Unchecking a heading hides every tab
// under it. A cell the role can't reach anyway is disabled with the reason.
function NavigationSection({ hidden, onChange }: { hidden: NavHidden; onChange: (next: NavHidden) => void }) {
  const cell = (group: NavGroup, tab: NavTab | undefined, role: Role) => {
    const name = tab ? `${group.name} › ${tab.name}` : group.name;
    if (role === "admin")
      return <RoundCheck checked disabled aria-label={`${name} for ${roleLabel(role)}: always shown`} readOnly />;
    const headingOff = !!tab && hidden[role].includes(group.copyId);
    const blocked = headingOff ? `${group.name} is hidden` : tab ? tabBlocked(group, tab, role) : headingBlocked(group, role);
    const shown = !headingOff && !hidden[role].includes(keyOf(group, tab));
    return (
      <span className="perm-nav-cell" title={blocked ?? undefined}>
        <RoundCheck
          aria-label={`${name} for ${roleLabel(role)}`}
          checked={shown && !blocked}
          disabled={!!blocked}
          onChange={(event) => onChange(withCell(hidden, role, keyOf(group, tab), event.target.checked))}
        />
        {blocked && <small className="muted">{blocked}</small>}
      </span>
    );
  };
  return (
    <Section title="Navigation">
      <p className="muted">
        Choose which roles see each sidebar heading and tab. A role sees a tab only if it is checked here and the role
        can open it. This only hides navigation: it isn't a security boundary, and what a role can read or write still
        follows the areas above. Admin always sees everything.
      </p>
      <div className="table-scroll">
        <table className="perm-grid perm-nav-grid" aria-label="Navigation by role">
          <thead>
            <tr>
              <th scope="col">Heading or tab</th>
              {roles.map((role) => (
                <th scope="col" key={role}>
                  {roleLabel(role)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {navigationGroups.flatMap((group) => [
              <tr key={group.copyId} className="perm-nav-heading">
                <th scope="row">{group.name}</th>
                {roles.map((role) => (
                  <td key={role}>{cell(group, undefined, role)}</td>
                ))}
              </tr>,
              ...group.tabs.map((tab) => (
                <tr key={keyOf(group, tab)}>
                  <th scope="row" className="perm-nav-tab">
                    {tab.name}
                  </th>
                  {roles.map((role) => (
                    <td key={role}>{cell(group, tab, role)}</td>
                  ))}
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
