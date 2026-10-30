import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import type { EmploymentType, Role } from "../../shared/access";
import type { ApprovalRequest } from "../../shared/approvals";
import {
  registerApprovalSubject,
  requestApproval,
  type ApprovalRow,
  type NewApprovalRequest,
} from "../../worker/records/approvals";

// Approval workflow engine (FLOW-44) through the real API and database: applying
// exactly the proposed change or failing with a conflict (AC1), rejecting without
// changing anything (AC2), and approval limited to the approver role and Admin
// (AC3), with the queues, withdrawal and notifications around them.

const url = process.env.DATABASE_URL;
if (!url)
  throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } };

const people = {
  admin: "c4400000-0000-4000-8000-000000000001",
  manager: "c4400000-0000-4000-8000-000000000002",
  sam: "c4400000-0000-4000-8000-000000000003",
  sue: "c4400000-0000-4000-8000-000000000004",
  tech: "c4400000-0000-4000-8000-000000000005",
  admin2: "c4400000-0000-4000-8000-000000000006",
};
const directory: [keyof typeof people, Role, EmploymentType][] = [
  ["admin", "admin", "full_time"],
  ["manager", "sales_manager", "full_time"],
  ["sam", "salesperson", "full_time"],
  ["sue", "salesperson", "full_time"],
  ["tech", "technical", "full_time"],
  ["admin2", "admin", "full_time"],
];
const actorOf = (who: keyof typeof people) => {
  const [, role, employmentType] = directory.find(([name]) => name === who)!;
  return { userId: people[who], role, employmentType };
};
const signedInAs = (who: keyof typeof people) => {
  const app = createApp({ withDb, resolveActor: async () => actorOf(who) });
  const call = async (method: string, path: string, body?: unknown) =>
    app.request(
      path,
      {
        method,
        ...(body !== undefined && {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
        }),
      },
      env,
    );
  const send = async <T>(method: string, path: string, body?: unknown, status = 200) => {
    const response = await call(method, path, body);
    expect(response.status, await response.clone().text()).toBe(status);
    return (await response.json()) as T;
  };
  return { call, send };
};
const admin = signedInAs("admin");
const manager = signedInAs("manager");
const sam = signedInAs("sam");
const sue = signedInAs("sue");
const tech = signedInAs("tech");

// Two subjects, registered the way modules register theirs. "test_item_change"
// proposes changes to an inventory item's name and group, approved by Admin.
// "test_signoff" approves something as a whole, approved by the Sales Manager.
const hooks: string[] = [];
registerApprovalSubject("test_item_change", {
  approverRole: "admin",
  readFields: async (tx, subjectId, fields) => {
    const [item] = await tx
      .select({ name: schema.inventoryItems.name, group: schema.inventoryItems.group })
      .from(schema.inventoryItems)
      .where(eq(schema.inventoryItems.id, subjectId))
      .for("update");
    if (!item) return null;
    return Object.fromEntries(fields.map((field) => [field, item[field as keyof typeof item]]));
  },
  applyChange: async (tx, actor, subjectId, values) => {
    await tx
      .update(schema.inventoryItems)
      .set({ ...(values as { name?: string; group?: string }), updatedBy: actor.userId })
      .where(eq(schema.inventoryItems.id, subjectId));
  },
  onApproved: async (_tx, _actor, request) => {
    hooks.push(`approved:${request.id}`);
  },
});
registerApprovalSubject("test_signoff", {
  approverRole: "sales_manager",
  onApproved: async (_tx, _actor, request) => {
    hooks.push(`approved:${request.id}`);
  },
  onRejected: async (_tx, _actor, request) => {
    hooks.push(`rejected:${request.id}`);
  },
  onWithdrawn: async (_tx, _actor, request) => {
    hooks.push(`withdrawn:${request.id}`);
  },
});

const tables = sql`truncate table approval_requests, audit_log, jobs, recipe_lines, stock_count_lines, stock_counts, stock_movements, inventory_stock, inventory_cost_history, inventory_bar_details, inventory_consumable_details, inventory_rental_details, inventory_service_details, inventory_items cascade`;
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(tables);
  hooks.length = 0;
  // Added once and kept; other files' users stay as they are.
  await db
    .insert(schema.users)
    .values(
      directory.map(([name, role, employmentType], i) => ({
        id: people[name],
        email: `${name}@approvals.example`,
        name: name[0].toUpperCase() + name.slice(1),
        role,
        employmentType,
        mobile: `20255594${i}`,
        status: "active" as const,
      })),
    )
    .onConflictDoNothing({ target: schema.users.id });
});
afterAll(async () => {
  await db.execute(tables);
  await db.delete(schema.users).where(inArray(schema.users.id, Object.values(people)));
  await client.end();
});

const chairs = async () => {
  const [item] = await db
    .insert(schema.inventoryItems)
    .values({ kind: "rental", name: "Chiavari chairs", group: "Seating", unit: "each" })
    .returning();
  return item;
};
const itemNamed = async (id: string) => {
  const [item] = await db
    .select()
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.id, id));
  return item;
};
const ask = (who: keyof typeof people, input: NewApprovalRequest) =>
  db.transaction((tx) => requestApproval(tx, actorOf(who), input));
const renameRequest = (itemId: string): NewApprovalRequest => ({
  subjectType: "test_item_change",
  subjectId: itemId,
  summary: "Rename Chiavari chairs",
  link: `/inventory/${itemId}`,
  proposedChange: { name: { from: "Chiavari chairs", to: "Chiavari chairs, gold" } },
});
const signoff = (): NewApprovalRequest => ({
  subjectType: "test_signoff",
  subjectId: crypto.randomUUID(),
  summary: "BEO for the fall gala",
  link: null,
});
const eventsNamed = (name: string) =>
  db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.type, `event:${name}`));
const requestRow = async (id: string): Promise<ApprovalRow> => {
  const [row] = await db
    .select()
    .from(schema.approvalRequests)
    .where(eq(schema.approvalRequests.id, id));
  return row;
};
const ours = (payload: unknown) =>
  (payload as { recipientIds: string[] }).recipientIds.filter((id) =>
    Object.values(people).includes(id),
  );
const errorOf = async (response: Response) =>
  ((await response.json()) as { error: { code: string; message: string } }).error;

describe("requesting", () => {
  it("stores a pending request for the subject's approver role, audits it and tells the approvers", async () => {
    const item = await chairs();
    const id = await ask("sam", renameRequest(item.id));
    const approval = await sam.send<ApprovalRequest>("GET", `/api/approvals/${id}`);
    expect(approval).toMatchObject({
      subjectType: "test_item_change",
      subjectId: item.id,
      summary: "Rename Chiavari chairs",
      link: `/inventory/${item.id}`,
      proposedChange: { name: { from: "Chiavari chairs", to: "Chiavari chairs, gold" } },
      requester: { id: people.sam, name: "Sam" },
      approverRole: "admin",
      status: "pending",
      comment: "",
      decidedBy: null,
      decidedAt: null,
      canDecide: false,
      canWithdraw: true,
    });
    // Nothing is applied until it's approved.
    expect((await itemNamed(item.id)).name).toBe("Chiavari chairs");
    const [audit] = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.entityType, "approval_request"),
          eq(schema.auditLog.entityId, id),
        ),
      );
    expect(audit).toMatchObject({ action: "create", createdBy: people.sam });
    const [requested] = await eventsNamed("approval.requested");
    expect(requested.payload).toMatchObject({
      entityId: id,
      title: "Approval needed: Rename Chiavari chairs",
      body: "Sam asked for your approval.",
      link: `/inventory/${item.id}`,
    });
    // Every active Admin, since Admin approves this subject (other files' users
    // may share the database, so only this file's people are compared).
    expect(ours(requested.payload).sort()).toEqual([people.admin, people.admin2].sort());
  });

  it("doesn't tell the requester about their own request", async () => {
    await ask("admin", renameRequest((await chairs()).id));
    const [requested] = await eventsNamed("approval.requested");
    expect(ours(requested.payload)).toEqual([people.admin2]);
  });

  it("refuses an empty change and a subject type nobody registered", async () => {
    const item = await chairs();
    await expect(
      ask("sam", { ...renameRequest(item.id), proposedChange: {} }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      ask("sam", { ...renameRequest(item.id), subjectType: "nothing_here" }),
    ).rejects.toThrow('Approval subject "nothing_here" is not registered.');
    expect(await db.select().from(schema.approvalRequests)).toEqual([]);
  });
});

describe("approving (AC1)", () => {
  it("applies exactly the proposed change, records the decision and tells the requester", async () => {
    const item = await chairs();
    const id = await ask("sam", renameRequest(item.id));
    const approved = await admin.send<ApprovalRequest>(
      "POST",
      `/api/approvals/${id}/approve`,
      { comment: "Looks right." },
    );
    expect(approved).toMatchObject({
      status: "approved",
      comment: "Looks right.",
      decidedBy: { id: people.admin, name: "Admin" },
      canDecide: false,
      canWithdraw: false,
    });
    expect(approved.decidedAt).not.toBeNull();
    const after = await itemNamed(item.id);
    expect(after.name).toBe("Chiavari chairs, gold");
    // Fields outside the change are untouched.
    expect(after).toMatchObject({ group: "Seating", unit: "each", kind: "rental" });
    expect(hooks).toEqual([`approved:${id}`]);
    const [decided] = await eventsNamed("approval.decided");
    expect(decided.payload).toMatchObject({
      entityId: id,
      recipientIds: [people.sam],
      title: "Approved: Rename Chiavari chairs",
      body: "Looks right.",
      link: `/inventory/${item.id}`,
    });
    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, id));
    expect(audit.map((row) => row.action).sort()).toEqual(["create", "update"]);
  });

  it("fails with a conflict when the record changed after the request, and changes nothing", async () => {
    const item = await chairs();
    const id = await ask("sam", renameRequest(item.id));
    await db
      .update(schema.inventoryItems)
      .set({ name: "Chiavari chairs, silver" })
      .where(eq(schema.inventoryItems.id, item.id));
    const response = await admin.call("POST", `/api/approvals/${id}/approve`, {});
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toMatchObject({ code: "APPROVAL_CONFLICT" });
    expect((await itemNamed(item.id)).name).toBe("Chiavari chairs, silver");
    expect(await requestRow(id)).toMatchObject({ status: "pending", decidedBy: null });
    expect(hooks).toEqual([]);
    expect(await eventsNamed("approval.decided")).toEqual([]);
    // The approver can still reject it.
    await admin.send("POST", `/api/approvals/${id}/reject`, {
      comment: "Someone renamed it since.",
    });
  });

  it("fails with a conflict when only one of several fields changed", async () => {
    const item = await chairs();
    const id = await ask("sam", {
      ...renameRequest(item.id),
      proposedChange: {
        name: { from: "Chiavari chairs", to: "Gold chairs" },
        group: { from: "Seating", to: "Chairs" },
      },
    });
    await db
      .update(schema.inventoryItems)
      .set({ group: "Furniture" })
      .where(eq(schema.inventoryItems.id, item.id));
    const response = await admin.call("POST", `/api/approvals/${id}/approve`, {});
    expect(response.status).toBe(409);
    expect(await itemNamed(item.id)).toMatchObject({
      name: "Chiavari chairs",
      group: "Furniture",
    });
  });

  it("fails with a conflict when the record is gone", async () => {
    const item = await chairs();
    const id = await ask("sam", renameRequest(item.id));
    await db.delete(schema.inventoryItems).where(eq(schema.inventoryItems.id, item.id));
    const response = await admin.call("POST", `/api/approvals/${id}/approve`, {});
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toMatchObject({ code: "APPROVAL_CONFLICT" });
    expect((await requestRow(id)).status).toBe("pending");
  });

  it("decides a request only once", async () => {
    const id = await ask("sam", renameRequest((await chairs()).id));
    await admin.send("POST", `/api/approvals/${id}/approve`, {});
    for (const action of ["approve", "reject", "withdraw"]) {
      const response = await (action === "withdraw" ? sam : admin).call(
        "POST",
        `/api/approvals/${id}/${action}`,
        { comment: "Again" },
      );
      expect(response.status, action).toBe(409);
      expect(await errorOf(response)).toMatchObject({ code: "APPROVAL_CLOSED" });
    }
    expect(hooks).toEqual([`approved:${id}`]);
  });
});

describe("FLOW-73 Master inventory approvals", () => {
  const createRental = () => admin.send<{ id: string; rental: { priceCents: number } }>(
    "POST", "/api/inventory/items", { kind: "rental", subtype: "decor", name: "Gold chairs",
      rental: { priceCents: 800 } }, 201);

  it("keeps a salesperson's price pending until Admin approves it", async () => {
    const item = await createRental();
    const result = await sam.send<{ approvalId: string; applied: boolean }>(
      "POST", "/api/inventory/items/changes", { changes: [{ type: "field", itemId: item.id,
        field: "priceCents", value: 900 }] }, 202);
    expect(result.applied).toBe(false);
    const before = await admin.send<{ rental: { priceCents: number } }>("GET", `/api/inventory/items/${item.id}`);
    expect(before.rental.priceCents).toBe(800);
    const pending = await sam.send<{ field: string; proposedBy: string }[]>(
      "GET", `/api/inventory/items/pending?ids=${item.id}`);
    expect(pending).toMatchObject([{ field: "priceCents", proposedBy: "Sam" }]);
    await admin.send("POST", `/api/approvals/${result.approvalId}/approve`, {});
    const after = await admin.send<{ rental: { priceCents: number } }>("GET", `/api/inventory/items/${item.id}`);
    expect(after.rental.priceCents).toBe(900);
  });

  it("applies a Sales Manager price edit directly and audits it", async () => {
    const item = await createRental();
    const result = await manager.send<{ approvalId: null; applied: boolean }>(
      "POST", "/api/inventory/items/changes", { changes: [{ type: "field", itemId: item.id,
        field: "priceCents", value: 950 }] });
    expect(result).toEqual({ applied: true, approvalId: null });
    expect((await admin.send<{ rental: { priceCents: number } }>("GET", `/api/inventory/items/${item.id}`)).rental.priceCents).toBe(950);
    expect((await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityId, item.id),
      eq(schema.auditLog.action, "update")))).length).toBe(1);
  });

  it("sends the rejection reason to the proposer", async () => {
    const item = await createRental();
    const result = await sam.send<{ approvalId: string }>("POST", "/api/inventory/items/changes",
      { changes: [{ type: "field", itemId: item.id, field: "priceCents", value: 1000 }] }, 202);
    await admin.send("POST", `/api/approvals/${result.approvalId}/reject`, { comment: "Too expensive" });
    const [decided] = await eventsNamed("approval.decided");
    expect(decided.payload).toMatchObject({ recipientIds: [people.sam], body: "Too expensive" });
  });

  it("submits three Master grid cells in one approval request", async () => {
    const item = await createRental();
    const result = await sam.send<{ approvalId: string }>("POST", "/api/inventory/items/changes", {
      changes: [
        { type: "field", itemId: item.id, field: "name", value: "Gold banquet chairs" },
        { type: "field", itemId: item.id, field: "group", value: "Premium seating" },
        { type: "field", itemId: item.id, field: "priceCents", value: 1000 },
      ],
    }, 202);
    const approval = await sam.send<ApprovalRequest>("GET", `/api/approvals/${result.approvalId}`);
    expect(Object.keys(approval.proposedChange ?? {})).toHaveLength(3);
    expect((await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.subjectType, "inventory_batch"))).length).toBe(1);
  });

  it("refuses a part-time proposal", async () => {
    const item = await createRental();
    const app = createApp({ withDb, resolveActor: async () => ({ ...actorOf("sam"), employmentType: "part_time" }) });
    const response = await app.request("/api/inventory/items/changes", { method: "POST",
      body: JSON.stringify({ changes: [{ type: "field", itemId: item.id,
        field: "priceCents", value: 1000 }] }) }, env);
    expect(response.status).toBe(403);
  });
  it("routes service prices through the same approval decision", async () => {
    const service = await admin.send<{ id: string }>("POST", "/api/inventory/items", {
      kind: "service", name: "Balloon arch", service: { priceCents: 20000 },
    }, 201);
    const result = await sam.send<{ approvalId: string }>("POST", "/api/inventory/items/changes", {
      changes: [{ type: "field", itemId: service.id, field: "priceCents", value: 22000 }],
    }, 202);
    expect((await admin.send<{ service: { priceCents: number } }>("GET", `/api/inventory/items/${service.id}`)).service.priceCents).toBe(20000);
    await admin.send("POST", `/api/approvals/${result.approvalId}/approve`, {});
    expect((await admin.send<{ service: { priceCents: number } }>("GET", `/api/inventory/items/${service.id}`)).service.priceCents).toBe(22000);
  });
});

describe("rejecting (AC2)", () => {
  it("leaves the record unchanged, records the comment and tells the requester", async () => {
    const item = await chairs();
    const id = await ask("sam", renameRequest(item.id));
    const rejected = await admin.send<ApprovalRequest>(
      "POST",
      `/api/approvals/${id}/reject`,
      { comment: "Keep the plain name." },
    );
    expect(rejected).toMatchObject({
      status: "rejected",
      comment: "Keep the plain name.",
      decidedBy: { id: people.admin },
    });
    expect(await itemNamed(item.id)).toMatchObject({
      name: "Chiavari chairs",
      updatedAt: item.updatedAt,
    });
    expect(hooks).toEqual([]);
    const [decided] = await eventsNamed("approval.decided");
    expect(decided.payload).toMatchObject({
      recipientIds: [people.sam],
      title: "Rejected: Rename Chiavari chairs",
      body: "Keep the plain name.",
    });
  });

  it("needs a comment", async () => {
    const id = await ask("sam", renameRequest((await chairs()).id));
    for (const body of [{}, { comment: "   " }]) {
      const response = await admin.call("POST", `/api/approvals/${id}/reject`, body);
      expect(response.status).toBe(400);
      expect((await errorOf(response)).message).toBe("Say why it's rejected.");
    }
    expect((await requestRow(id)).status).toBe("pending");
  });

  it("runs the module's rejection hook for a sign-off", async () => {
    const id = await ask("sam", signoff());
    await manager.send("POST", `/api/approvals/${id}/reject`, { comment: "Not yet." });
    expect(hooks).toEqual([`rejected:${id}`]);
  });
});

describe("who may approve (AC3)", () => {
  it("refuses the requester and hides the request from people with no part in it", async () => {
    const item = await chairs();
    const id = await ask("sam", renameRequest(item.id));
    // The requester sees it but can't decide it.
    const own = await sam.call("POST", `/api/approvals/${id}/approve`, {});
    expect(own.status).toBe(403);
    // Another salesperson, Technical (no approval rights) and the Sales Manager
    // (not this subject's approver) can't see it at all.
    for (const outsider of [sue, tech, manager]) {
      expect((await outsider.call("GET", `/api/approvals/${id}`)).status).toBe(404);
      expect(
        (await outsider.call("POST", `/api/approvals/${id}/approve`, {})).status,
      ).toBe(404);
      expect(
        (await outsider.call("POST", `/api/approvals/${id}/reject`, { comment: "No" }))
          .status,
      ).toBe(404);
    }
    expect((await itemNamed(item.id)).name).toBe("Chiavari chairs");
    expect((await requestRow(id)).status).toBe("pending");
  });

  it("lets the approver role and Admin approve, and no one else", async () => {
    const first = await ask("sam", signoff());
    const second = await ask("sue", signoff());
    // The Sales Manager approves sign-offs; any Admin can act on any request.
    const byManager = await manager.send<ApprovalRequest>(
      "POST",
      `/api/approvals/${first}/approve`,
      {},
    );
    expect(byManager).toMatchObject({ status: "approved", decidedBy: { id: people.manager } });
    await admin.send("POST", `/api/approvals/${second}/approve`, {});
    expect(hooks).toEqual([`approved:${first}`, `approved:${second}`]);

    const third = await ask("sam", signoff());
    expect((await sue.call("POST", `/api/approvals/${third}/approve`, {})).status).toBe(404);
    expect((await tech.call("POST", `/api/approvals/${third}/approve`, {})).status).toBe(404);
    expect((await sam.call("POST", `/api/approvals/${third}/approve`, {})).status).toBe(403);
    expect((await requestRow(third)).status).toBe("pending");
  });
});

describe("queues", () => {
  it("shows each approver role its pending requests, oldest first, and Admin all of them", async () => {
    const item = await chairs();
    const rename = await ask("sam", renameRequest(item.id));
    const signoffOne = await ask("sam", signoff());
    const signoffTwo = await ask("sue", signoff());
    const done = await ask("sue", signoff());
    await manager.send("POST", `/api/approvals/${done}/approve`, {});

    const ids = (rows: ApprovalRequest[]) => rows.map((row) => row.id);
    expect(
      ids(await manager.send<ApprovalRequest[]>("GET", "/api/approvals?queue=true")),
    ).toEqual([signoffOne, signoffTwo]);
    expect(
      ids(await admin.send<ApprovalRequest[]>("GET", "/api/approvals?queue=true")),
    ).toEqual([rename, signoffOne, signoffTwo]);
    // No requests for these roles to approve.
    expect(await sue.send("GET", "/api/approvals?queue=true")).toEqual([]);
    expect(await tech.send("GET", "/api/approvals?queue=true")).toEqual([]);

    // A requester sees their own requests, newest first, whatever their state.
    const mine = await sue.send<ApprovalRequest[]>("GET", "/api/approvals?mine=true");
    expect(ids(mine)).toEqual([done, signoffTwo]);
    expect(mine.map((row) => row.status)).toEqual(["approved", "pending"]);
    // The queue rows say what the viewer may do.
    const [first] = await manager.send<ApprovalRequest[]>("GET", "/api/approvals?queue=true");
    expect(first).toMatchObject({ canDecide: true, canWithdraw: false });
  });

  it("finds a subject's requests and pages through them", async () => {
    const item = await chairs();
    const requests = [];
    for (let i = 0; i < 3; i += 1) requests.push(await ask("sam", renameRequest(item.id)));
    await ask("sam", signoff());
    const forItem = await admin.send<ApprovalRequest[]>(
      "GET",
      `/api/approvals?subjectType=test_item_change&subjectId=${item.id}&status=pending`,
    );
    expect(forItem.map((row) => row.id)).toEqual([...requests].reverse());

    const page = await admin.call("GET", "/api/approvals?queue=true&limit=2");
    expect(page.headers.get("X-Has-More")).toBe("true");
    const firstPage = (await page.json()) as ApprovalRequest[];
    const rest = await admin.send<ApprovalRequest[]>(
      "GET",
      `/api/approvals?queue=true&limit=2&cursor=${encodeURIComponent(page.headers.get("X-Next-Cursor")!)}`,
    );
    expect([...firstPage, ...rest].map((row) => row.id).slice(0, 3)).toEqual(requests);
    expect(firstPage.length + rest.length).toBe(4);
  });

  it("rejects an unknown filter", async () => {
    expect((await admin.call("GET", "/api/approvals?status=maybe")).status).toBe(400);
  });
});

describe("withdrawing", () => {
  it("lets the requester take back a pending request, and no one else", async () => {
    const id = await ask("sam", signoff());
    expect((await admin.call("POST", `/api/approvals/${id}/withdraw`)).status).toBe(403);
    expect((await manager.call("POST", `/api/approvals/${id}/withdraw`)).status).toBe(403);
    expect((await sue.call("POST", `/api/approvals/${id}/withdraw`)).status).toBe(404);
    const withdrawn = await sam.send<ApprovalRequest>("POST", `/api/approvals/${id}/withdraw`);
    expect(withdrawn).toMatchObject({
      status: "withdrawn",
      decidedBy: { id: people.sam },
      canDecide: false,
      canWithdraw: false,
    });
    expect(hooks).toEqual([`withdrawn:${id}`]);
    // A withdrawn request leaves the queue and can't be approved.
    expect(await manager.send("GET", "/api/approvals?queue=true")).toEqual([]);
    expect((await manager.call("POST", `/api/approvals/${id}/approve`, {})).status).toBe(409);
    expect(await eventsNamed("approval.decided")).toEqual([]);
  });

  it("applies nothing from a withdrawn change", async () => {
    const item = await chairs();
    const id = await ask("sam", renameRequest(item.id));
    await sam.send("POST", `/api/approvals/${id}/withdraw`);
    expect((await itemNamed(item.id)).name).toBe("Chiavari chairs");
  });
});
