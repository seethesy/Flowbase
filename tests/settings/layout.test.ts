import { describe, expect, it } from "vitest";
import { roles, type Actor } from "../../shared/access";
import { can } from "../../shared/policy";
import {
  canReadField,
  fieldRegistry,
  parseFieldList,
  projectRecord,
  readableFields,
  sourceKeys,
} from "../../shared/fields";
import {
  contrastRatio,
  emptyLayout,
  layoutDocSchema,
  layoutProblems,
  MAX_BLOCKS,
  MAX_CARDS,
  styleContrastOk,
  type LayoutDoc,
} from "../../shared/layout";
import { applyCardQuery, parseCardQuery } from "../../worker/fields";
import { compileCardSql } from "../../worker/card-sql";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { defaultBlocks, readingOrder, withBuiltins } from "../../src/app/live-edit/layout-state";

// Page layouts (FLOW-253 to 256): the field registry and its read rules, the
// LayoutDoc schema and server checks, contrast, and card queries.

const userId = "53000000-0000-4000-8000-000000000001";
const other = "53000000-0000-4000-8000-000000000002";
const as = (role: Actor["role"]): Actor => ({ userId, role });
const admin = as("admin");

const card = (overrides: Record<string, unknown> = {}) => ({
  kind: "card",
  id: "card-1",
  x: 0,
  y: 0,
  w: 6,
  h: 8,
  card: {
    title: "Upcoming",
    source: { type: "list", list: "events" },
    display: { type: "table", columns: [{ key: "title" }] },
    ...overrides,
  },
});
const doc = (input: Record<string, unknown>): LayoutDoc => layoutDocSchema.parse({ version: 1, ...input });

describe("field registry (FLOW-253 AC1)", () => {
  it("covers every registered source, each with a required name field", () => {
    expect([...sourceKeys].sort()).toEqual(
      ["clients", "documents", "events", "inventory", "leads", "proposals", "recipes", "sops", "staff", "tasks", "vendors", "venues", "working-staff"],
    );
    for (const source of sourceKeys) {
      const def = fieldRegistry[source];
      expect(def.fields.some((field) => field.required)).toBe(true);
      expect(new Set(def.fields.map((field) => field.key)).size).toBe(def.fields.length);
      expect(def.fields.some((field) => field.key === def.titleField)).toBe(true);
    }
  });

  it("gives a role no field of a source it can't read", () => {
    for (const role of roles) {
      const actor = as(role);
      for (const source of sourceKeys) {
        if (can(actor, fieldRegistry[source].readAction)) continue;
        expect(readableFields(actor, source)).toEqual([]);
        expect(fieldRegistry[source].fields.some((field) => canReadField(actor, source, field.key))).toBe(false);
      }
    }
  });

  it("lets an Admin read every field", () => {
    for (const source of sourceKeys)
      expect(readableFields(admin, source).map((field) => field.key)).toEqual(
        fieldRegistry[source].fields.map((field) => field.key),
      );
  });

  it("shows a salesperson a lead's budget only on their own leads", () => {
    const salesperson = as("salesperson");
    expect(canReadField(salesperson, "leads", "budgetCents", { assignedSalespersonId: userId })).toBe(true);
    expect(canReadField(salesperson, "leads", "budgetCents", { assignedSalespersonId: other })).toBe(false);
  });

  it("projects only asked-for fields the viewer may read, plus the id", () => {
    const row = { id: "l1", name: "Avery", email: "a@example.test", budgetCents: 5000, assignedSalespersonId: other, secret: 1 };
    expect(projectRecord(admin, "leads", row, ["name", "email", "budgetCents"])).toEqual({
      id: "l1",
      name: "Avery",
      email: "a@example.test",
      budgetCents: 5000,
    });
    const salesperson = as("salesperson");
    expect(projectRecord(salesperson, "leads", row, ["name", "budgetCents", "secret"])).not.toHaveProperty("budgetCents");
    for (const role of roles) {
      const projected = projectRecord(as(role), "leads", row, ["name", "email", "phone", "budgetCents"]);
      for (const key of Object.keys(projected))
        if (key !== "id") expect(canReadField(as(role), "leads", key, row)).toBe(true);
    }
  });

  it("names unknown fields in fields=", () => {
    expect(parseFieldList("leads", "name, email,name")).toEqual({ keys: ["name", "email"] });
    expect(parseFieldList("leads", "name,nope")).toEqual({ unknown: ["nope"] });
  });
});

describe("layout document (FLOW-253)", () => {
  it("accepts the empty layout and fills defaults", () => {
    expect(layoutDocSchema.parse({ version: 1 })).toEqual(emptyLayout());
    expect(layoutProblems("leads.detail", emptyLayout())).toEqual([]);
  });

  it("rejects raw CSS, other versions, and blocks outside the 12 columns", () => {
    const builtin = { kind: "builtin", id: "notes", x: 0, y: 0, w: 6, h: 4 };
    expect(layoutDocSchema.safeParse({ version: 2 }).success).toBe(false);
    expect(layoutDocSchema.safeParse({ version: 1, blocks: [{ ...builtin, style: { text: "red" } }] }).success).toBe(false);
    expect(layoutDocSchema.safeParse({ version: 1, blocks: [{ ...builtin, style: { text: "#fff; x" } }] }).success).toBe(false);
    expect(layoutDocSchema.safeParse({ version: 1, blocks: [{ ...builtin, x: 8, w: 6 }] }).success).toBe(false);
    expect(layoutDocSchema.parse({ version: 1, blocks: [{ ...builtin, style: { text: "#ABCDEF" } }] }).blocks[0].style).toEqual({
      text: "#abcdef",
    });
  });

  it(`holds at most ${MAX_BLOCKS} blocks and ${MAX_CARDS} cards`, () => {
    const text = (n: number) => ({ kind: "text", id: `text-${n}`, variant: "text", text: "Hi", x: 0, y: n, w: 12, h: 1 });
    expect(layoutDocSchema.safeParse({ version: 1, blocks: Array.from({ length: MAX_BLOCKS + 1 }, (_, n) => text(n)) }).success).toBe(false);
    const cards = Array.from({ length: MAX_CARDS + 1 }, (_, n) => card({ title: `Card ${n}` })).map((block, n) => ({ ...block, id: `card-${n}` }));
    expect(layoutProblems("dashboard.home", doc({ blocks: cards })).map((problem) => problem.path)).toContain("blocks");
  });

  it("enforces 4.5:1 contrast on the server, a single color against the default", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(styleContrastOk({ text: "#202c27", background: "#edf3ee" })).toBe(true);
    expect(styleContrastOk({ text: "#e8e7e7" })).toBe(false);
    expect(styleContrastOk({ background: "#3f3f3f" })).toBe(false);
    expect(styleContrastOk({ text: "#ffffff", background: "#3f3f3f" })).toBe(true);
    const low = doc({ blocks: [{ kind: "builtin", id: "notes", x: 0, y: 0, w: 6, h: 4, style: { text: "#eeeeee" } }] });
    expect(layoutProblems("leads.detail", low)[0].message).toMatch(/too close/);
  });

  it("rejects unknown sources, relations, fields, operators and sorts (FLOW-256 AC6)", () => {
    const problems = (overrides: Record<string, unknown>, page = "leads.detail") =>
      layoutProblems(page, doc({ blocks: [card(overrides)] })).map((problem) => problem.message);
    expect(problems({})).toEqual([]);
    expect(problems({ display: { type: "table", columns: [{ key: "nope" }] } })[0]).toMatch(/Unknown field/);
    expect(problems({ filters: [{ field: "title", op: "before" }] })[0]).toMatch(/doesn't apply/);
    expect(problems({ filters: [{ field: "internalNotes", op: "contains", value: "x" }] })[0]).toMatch(/Can't filter/);
    expect(problems({ sort: { field: "internalNotes", dir: "asc" } })[0]).toMatch(/Can't sort/);
    expect(problems({ source: { type: "related", relation: "nope" } })[0]).toMatch(/Unknown related list/);
    expect(problems({ source: { type: "related", relation: "events" }, display: { type: "table", columns: [{ key: "title" }] } })).toEqual([]);
    expect(problems({ source: { type: "record" } }, "dashboard.home")[0]).toMatch(/no record/);
  });

  it("keeps locked and required columns, and knows each table (FLOW-254)", () => {
    const tables = (columns: { key: string }[]) =>
      layoutProblems("leads.inbox", doc({ tables: { "leads.inbox.table": { columns } } })).map((problem) => problem.message);
    expect(tables([{ key: "name" }, { key: "guestCount" }, { key: "notes" }, { key: "latestBeo" }])).toEqual([]);
    expect(tables([{ key: "open" }, { key: "name" }])[0]).toMatch(/Unknown field "open"/);
    expect(tables([{ key: "status" }])[0]).toMatch(/Client can't be hidden/);
    expect(tables([{ key: "name" }, { key: "name" }])[0]).toMatch(/twice/);
    expect(layoutProblems("x.y", doc({ tables: { "nope.table": { columns: [] } } }))[0].message).toMatch(/Unknown table/);
  });

  it("keeps required field boxes and checks box fields (FLOW-255)", () => {
    const boxes = (list: unknown[], page = "leads.detail") =>
      layoutProblems(page, doc({ fieldBoxes: { "lead-facts": { boxes: list } } })).map((problem) => problem.message);
    const name = { id: "field-1", kind: "field", field: "name", x: 0, y: 0, w: 6, h: 2 };
    expect(boxes([name, { id: "note-1", kind: "note", text: "Call first", x: 0, y: 2, w: 12, h: 2 }])).toEqual([]);
    expect(boxes([{ ...name, field: "email" }])[0]).toMatch(/Client can't be hidden/);
    expect(boxes([name, { ...name, id: "field-2", field: "nope" }])[0]).toMatch(/Unknown field/);
    expect(boxes([name], "events.detail")[0]).toMatch(/Unknown field card/);
  });
});

describe("block placement (FLOW-253)", () => {
  const builtins = [
    { id: "a", name: "A", w: 12, h: 4 },
    { id: "b", name: "B", w: 6, h: 3 },
  ];

  it("stacks built-ins in code order by default", () => {
    expect(defaultBlocks(builtins)).toEqual([
      { kind: "builtin", id: "a", x: 0, y: 0, w: 12, h: 4 },
      { kind: "builtin", id: "b", x: 0, y: 4, w: 6, h: 3 },
    ]);
  });

  it("drops built-ins the code no longer has and adds a new one where its code order puts it (FLOW-278)", () => {
    // "a" comes before "b" in code: it goes above the saved "b", which moves down.
    const saved = doc({ blocks: [{ kind: "builtin", id: "old", x: 0, y: 0, w: 12, h: 9 }, { kind: "builtin", id: "b", x: 6, y: 0, w: 6, h: 3 }] });
    expect(withBuiltins(saved, builtins)).toEqual([
      { kind: "builtin", id: "b", x: 6, y: 4, w: 6, h: 3 },
      { kind: "builtin", id: "a", x: 0, y: 0, w: 12, h: 4 },
    ]);
    // A new block last in code goes to the bottom.
    expect(withBuiltins(doc({ blocks: [{ kind: "builtin", id: "a", x: 0, y: 0, w: 12, h: 4 }] }), builtins)).toEqual([
      { kind: "builtin", id: "a", x: 0, y: 0, w: 12, h: 4 },
      { kind: "builtin", id: "b", x: 0, y: 4, w: 6, h: 3 },
    ]);
  });

  it("loads a saved event layout after its removed board block disappears", () => {
    const saved = doc({ blocks: [
      { kind: "builtin", id: "day-of", x: 0, y: 0, w: 12, h: 8, removed: true },
      { kind: "builtin", id: "closeout", x: 0, y: 8, w: 12, h: 8 },
    ] });
    expect(withBuiltins(saved, [{ id: "closeout", name: "Closeout", w: 12, h: 8 }]).map((block) => block.id))
      .toEqual(["closeout"]);
  });

  it("orders blocks top to bottom, then left to right, for phones", () => {
    expect(readingOrder([{ id: "r", x: 6, y: 0 }, { id: "l", x: 0, y: 0 }, { id: "d", x: 0, y: 2 }]).map((b) => b.id)).toEqual([
      "l",
      "r",
      "d",
    ]);
  });
});

describe("card queries (FLOW-256)", () => {
  const rows = [
    { id: "1", title: "Gala", status: "closed", guestCount: 120, date: "2026-11-25", assignedSalespersonId: userId },
    { id: "2", title: "Brunch", status: "inquiry", guestCount: null, date: "2026-12-30", assignedSalespersonId: other },
    { id: "3", title: "Wedding", status: "closed", guestCount: 80, date: "2026-11-22", assignedSalespersonId: other },
  ];
  const now = new Date("2026-11-20T12:00:00Z");

  it("parses where, orderBy and take, defaulting take to 10", () => {
    const params = new URLSearchParams({ where: JSON.stringify([{ field: "status", op: "is", value: "closed" }]), orderBy: "guestCount:desc" });
    expect(parseCardQuery("events", params)).toEqual({
      filters: [{ field: "status", op: "is", value: "closed" }],
      sort: { field: "guestCount", dir: "desc" },
      take: 10,
    });
    expect(parseCardQuery("events", new URLSearchParams())).toBeNull();
  });

  it("rejects unknown fields, operators, sorts and limits", () => {
    const bad: Record<string, string>[] = [
      { where: JSON.stringify([{ field: "nope", op: "is" }]) },
      { where: JSON.stringify([{ field: "title", op: "before" }]) },
      { where: "{not json" },
      { orderBy: "internalNotes:asc" },
      { orderBy: "title:up" },
      { take: "0" },
      { take: "101" },
    ];
    for (const params of bad) expect(() => parseCardQuery("events", new URLSearchParams(params))).toThrow();
  });

  it("filters, sorts with empty values last, and cuts to the limit", () => {
    const query = parseCardQuery("events", new URLSearchParams({ orderBy: "guestCount:asc", take: "2" }))!;
    expect(applyCardQuery(admin, "events", rows, query, now).map((row) => row.id)).toEqual(["3", "1"]);
    const closed = parseCardQuery("events", new URLSearchParams({ where: JSON.stringify([{ field: "status", op: "is", value: "closed" }]) }))!;
    expect(applyCardQuery(admin, "events", rows, closed, now).map((row) => row.id)).toEqual(["1", "3"]);
    const mine = parseCardQuery("events", new URLSearchParams({ where: JSON.stringify([{ field: "assignedSalespersonId", op: "is_me" }]) }))!;
    expect(applyCardQuery(admin, "events", rows, mine, now).map((row) => row.id)).toEqual(["1"]);
    const soon = parseCardQuery("events", new URLSearchParams({ where: JSON.stringify([{ field: "date", op: "within_days", value: 7 }]) }))!;
    expect(applyCardQuery(admin, "events", rows, soon, now).map((row) => row.id).sort()).toEqual(["1", "3"]);
  });

  it("treats a field the viewer can't read as empty, so a sort can't reveal it", () => {
    const leads = [
      { id: "a", name: "A", budgetCents: 900000, assignedSalespersonId: other },
      { id: "b", name: "B", budgetCents: 100, assignedSalespersonId: userId },
    ];
    const query = parseCardQuery("leads", new URLSearchParams({ orderBy: "budgetCents:desc" }))!;
    expect(applyCardQuery(as("salesperson"), "leads", leads, query, now).map((row) => row.id)).toEqual(["b", "a"]);
    expect(applyCardQuery(admin, "leads", leads, query, now).map((row) => row.id)).toEqual(["a", "b"]);
  });
});

// FLOW-308: which parts of a card run in the list's own SQL query.
describe("card queries in SQL", () => {
  const dialect = new PgDialect();
  const card = (source: "leads" | "events" | "recipes", params: Record<string, string>, actor = admin) =>
    compileCardSql(actor, source, parseCardQuery(source, new URLSearchParams(params))!);
  const text = (part: SQL | undefined) => (part ? dialect.sqlToQuery(part).sql : "");

  it("reads exactly take rows when every filter and the sort are plain columns", () => {
    const query = card("leads", {
      where: JSON.stringify([{ field: "status", op: "is", value: "inquiry" }, { field: "guestCount", op: "after", value: 10 }]),
      orderBy: "receivedAt:desc",
      take: "10",
    });
    expect(query.limit).toBe(10);
    expect(text(query.where)).toContain('"leads"."status"');
    expect(text(query.where)).toContain('"leads"."guest_count"');
    expect(query.orderBy).toHaveLength(1);
    expect(text(query.orderBy[0])).toContain("nulls last");
  });

  it("reads one page when a filter or the sort is computed or has a read rule", () => {
    // needsReview is computed; budgetCents is hidden from some viewers.
    const computed = card("leads", { where: JSON.stringify([{ field: "needsReview", op: "is", value: "true" }]), take: "5" });
    expect(computed.limit).toBe(500);
    expect(computed.where).toBeUndefined();
    const hidden = card("leads", { orderBy: "budgetCents:desc", take: "5" }, as("salesperson"));
    expect(hidden.limit).toBe(500);
    expect(hidden.orderBy).toEqual([]);
    // The filters that can run in SQL still narrow the page.
    const mixed = card("leads", {
      where: JSON.stringify([{ field: "needsReview", op: "is", value: "true" }, { field: "name", op: "contains", value: "ava" }]),
      take: "5",
    });
    expect(mixed.limit).toBe(500);
    expect(text(mixed.where)).toContain("strpos");
  });

  it("keeps sources without a SQL column map to one page in memory", () => {
    const query = card("recipes", { orderBy: "name:asc", take: "3" });
    expect(query).toEqual({ orderBy: [], limit: 500 });
  });

  it("sorts an event's date in business time", () => {
    const query = card("events", { orderBy: "date:asc", take: "3" });
    expect(query.limit).toBe(3);
    expect(text(query.orderBy[0])).toContain("at time zone");
  });
});
