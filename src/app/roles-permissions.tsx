import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Dropdown } from "../components/ui/Dropdown";
import { Button, LoadingSkeleton, PageHeader, Section } from "../components/shared";
import { LoadError } from "../components/record-display";
import { roles, type Role } from "../../shared/access";
import { emptyLayout, type LayoutBlock, type LayoutDoc } from "../../shared/layout";
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
import { layoutApi } from "../services/layout";
import { request } from "../services/core";
import { roleLabel } from "../services/users";
import { useResource } from "./useResource";
import { usePermissions } from "./permissions";
import { defaultBlocks, withBuiltins, type BuiltinBlock } from "./layout-state";
import { layoutQueryKey } from "./copy";
import { queryClient } from "./queryClient";
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
    block.kind === "card" ? [{ id: block.id, name: block.card.title }] : [],
  );
  return [...dashboardCards.map((card) => ({ id: card.key, name: card.label })), ...custom];
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
    const [{ matrix }, layout] = await Promise.all([
      request(permissionsSchema, "/api/permissions"),
      layoutApi.get(DASHBOARD_PAGE_KEY),
    ]);
    return { matrix, doc: layout?.layout ?? null };
  });
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [cards, setCards] = useState<CardRoles>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!loaded.data) return;
    setMatrix(loaded.data.matrix);
    setCards(cardRolesOf(loaded.data.doc));
  }, [loaded.data]);
  const rows = useMemo(() => cardRows(loaded.data?.doc ?? null), [loaded.data]);

  if (!can("users.manage")) return <p role="alert">Only Admin can change roles and permissions.</p>;

  const savedMatrix = loaded.data?.matrix;
  const savedCards = cardRolesOf(loaded.data?.doc ?? null);
  const matrixDirty = !!matrix && !!savedMatrix && !sameJson(matrix, savedMatrix);
  const cardsDirty = rows.some((row) => !sameJson(cards[row.id], savedCards[row.id]));
  const dirty = matrixDirty || cardsDirty;

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
        const base: LayoutDoc = doc
          ? { ...doc, blocks: withBuiltins(doc, dashboardBuiltins) }
          : { ...emptyLayout(), blocks: defaultBlocks(dashboardBuiltins) };
        const blocks = base.blocks.map(
          (block): LayoutBlock => (block.kind === "text" ? block : { ...block, visibleTo: cards[block.id] }),
        );
        await layoutApi.save(DASHBOARD_PAGE_KEY, { ...base, blocks });
        await queryClient.invalidateQueries({ queryKey: layoutQueryKey(DASHBOARD_PAGE_KEY) });
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
      <PageHeader
        title="Roles & permissions"
        subtitle="What each role can read or write, area by area, and which roles see each dashboard card."
      />
      {loaded.error ? (
        <LoadError message={loaded.error} />
      ) : !matrix ? (
        <LoadingSkeleton />
      ) : (
        <>
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
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
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
