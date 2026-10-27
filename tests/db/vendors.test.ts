import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import { ensureVendor } from "../../worker/records/vendors";
import type { RunWithDb } from "../../worker/hono";
import type { Actor, EmploymentType, Role } from "../../shared/access";
import type { InventoryItem, ItemInput } from "../../shared/inventory";
import type { SearchResult } from "../../shared/search";
import type { HistoryEntry } from "../../shared/audit";
import type {
  Vendor,
  VendorDetail,
  VendorInput,
} from "../../shared/vendors";

// Vendor directory (FLOW-84) and sub-rental items (FLOW-75) against the CI
// Postgres service, through the real API.
const url = process.env.DATABASE_URL;
if (!url)
  throw new Error(
    "DATABASE_URL must point to the disposable CI Postgres service.",
  );
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } };

const people = {
  admin: "a1000000-0000-4000-8000-000000000001",
  lead: "a1000000-0000-4000-8000-000000000002",
  staff: "a1000000-0000-4000-8000-000000000003",
};
const signedInAs = (
  userId: string,
  role: Role,
  employmentType: EmploymentType = "full_time",
) => {
  const actor: Actor = { userId, role, employmentType };
  const app = createApp({ withDb, resolveActor: async () => actor });
  const call = async (path: string, method = "GET", body?: unknown) => {
    const response = await app.request(
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
    return { status: response.status, json: await response.json() };
  };
  return {
    actor,
    call,
    get: async <T>(path: string) => {
      const result = await call(path);
      expect(result.status, JSON.stringify(result.json)).toBe(200);
      return result.json as T;
    },
    create: async (input: VendorInput) => {
      const result = await call("/api/vendors", "POST", input);
      expect(result.status, JSON.stringify(result.json)).toBe(201);
      return result.json as VendorDetail;
    },
    createItem: async (input: ItemInput) => {
      const result = await call("/api/inventory/items", "POST", input);
      expect(result.status, JSON.stringify(result.json)).toBe(201);
      return result.json as InventoryItem;
    },
    search: async (q: string) =>
      (
        await call(`/api/search?q=${encodeURIComponent(q)}`)
      ).json as SearchResult[],
  };
};
const admin = signedInAs(people.admin, "admin");
// Kitchen leads edit inventory, and so the directory, but a part-time one can't
// see or change contacts.
const partTimeLead = signedInAs(people.lead, "kitchen_lead", "part_time");
const fullTimeStaff = signedInAs(people.staff, "staff");
const partTimeStaff = signedInAs(people.staff, "staff", "part_time");

const imperio: VendorInput = {
  name: "Imperio",
  type: "beverage_distributor",
  portalUrl: "https://portal.imperio.example",
  accountNumber: "IMP-4410",
  contacts: [
    {
      name: "Dana Reyes",
      role: "Sales rep",
      email: "dana@imperio.example",
      phone: "(202) 555-0177",
    },
  ],
  orderCutoff: "Tuesday 2 pm for Thursday delivery",
  deliveryDays: ["thu"],
  minimumOrderCents: 25000,
  leadTimeDays: 2,
  orderingInstructions: "Order in the portal; call Dana for specials.",
};
const partyRentals: VendorInput = {
  name: "Capital Party Rentals",
  type: "rental_vendor",
  leadTimeDays: 7,
};

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(
    sql`truncate table recipe_lines, recipes, stock_count_lines, stock_counts, stock_movements, inventory_stock, inventory_cost_history, inventory_bar_details, inventory_consumable_details, inventory_service_details, inventory_rental_details, inventory_items, vendor_contacts, vendors, audit_log, ingest_receipts, jobs`,
  );
});
afterAll(async () => {
  await client.end();
});

describe("vendor directory (FLOW-84)", () => {
  it("saves every ordering field and writes history", async () => {
    const vendor = await admin.create(imperio);
    expect(vendor).toMatchObject({
      ...imperio,
      contacts: [expect.objectContaining(imperio.contacts![0])],
      notes: "",
      archivedAt: null,
      items: [],
    });
    const history = await admin.get<HistoryEntry[]>(
      `/api/vendors/${vendor.id}/history`,
    );
    expect(history.map((entry) => entry.action)).toEqual(["create"]);
  });

  it("AC1: refuses any field named like a password and stores none", async () => {
    for (const body of [
      { ...imperio, password: "hunter2" },
      { ...imperio, portalPassword: "hunter2" },
      { ...imperio, contacts: [{ name: "Dana", pass: "hunter2" }] },
    ]) {
      const result = await admin.call("/api/vendors", "POST", body);
      expect(result.status).toBe(400);
      expect(result.json.error.message).toMatch(/never stores portal passwords/);
    }
    const created = await admin.create(imperio);
    const result = await admin.call(`/api/vendors/${created.id}`, "PUT", {
      ...imperio,
      portal_pwd: "hunter2",
    });
    expect(result.status).toBe(400);
    const columns = await db.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns where table_name in ('vendors', 'vendor_contacts')`,
    );
    expect(
      columns.map((row) => row.column_name).filter((name) => /pass|pwd/i.test(name)),
    ).toEqual([]);
  });

  it("AC3: hides contacts and the account number from part-time users", async () => {
    const vendor = await admin.create(imperio);
    for (const who of [partTimeStaff, partTimeLead]) {
      const seen = await who.get<VendorDetail>(`/api/vendors/${vendor.id}`);
      expect(seen.contacts).toBeNull();
      expect(seen.accountNumber).toBeNull();
      expect(seen.orderCutoff).toBe(imperio.orderCutoff);
      const [listed] = await who.get<Vendor[]>("/api/vendors");
      expect(listed.contacts).toBeNull();
      expect(listed.accountNumber).toBeNull();
      const history = await who.get<HistoryEntry[]>(
        `/api/vendors/${vendor.id}/history`,
      );
      expect(JSON.stringify(history)).not.toContain("IMP-4410");
      expect(JSON.stringify(history)).not.toContain("dana@imperio.example");
    }
    const seen = await fullTimeStaff.get<VendorDetail>(
      `/api/vendors/${vendor.id}`,
    );
    expect(seen.accountNumber).toBe("IMP-4410");
    expect(seen.contacts?.[0].email).toBe("dana@imperio.example");
  });

  it("lets a part-time editor change ordering details without touching contacts", async () => {
    const vendor = await admin.create(imperio);
    // Without contacts or an account number: the stored ones stay.
    const rest = { ...imperio, contacts: undefined, accountNumber: undefined };
    const result = await partTimeLead.call(`/api/vendors/${vendor.id}`, "PUT", {
      ...rest,
      orderCutoff: "Monday noon",
    });
    expect(result.status, JSON.stringify(result.json)).toBe(200);
    const stored = await admin.get<VendorDetail>(`/api/vendors/${vendor.id}`);
    expect(stored).toMatchObject({
      orderCutoff: "Monday noon",
      accountNumber: "IMP-4410",
      contacts: [expect.objectContaining({ name: "Dana Reyes" })],
    });
    for (const change of [{ accountNumber: "X" }, { contacts: [] }])
      expect(
        (
          await partTimeLead.call(`/api/vendors/${vendor.id}`, "PUT", {
            ...rest,
            ...change,
          })
        ).status,
      ).toBe(403);
    expect(
      (await partTimeStaff.call("/api/vendors", "POST", partyRentals)).status,
    ).toBe(403);
  });

  it("keeps one live vendor per name, and ensureVendor reuses it", async () => {
    const vendor = await admin.create(imperio);
    const clash = await admin.call("/api/vendors", "POST", {
      ...imperio,
      name: "imperio",
    });
    expect(clash.status).toBe(409);
    expect(clash.json.error.code).toBe("DUPLICATE_VENDOR");
    const ids = await db.transaction(async (tx) => [
      await ensureVendor(tx, admin.actor, {
        name: "IMPERIO",
        type: "beverage_distributor",
      }),
      await ensureVendor(tx, admin.actor, {
        name: "Southern Glazer's",
        type: "beverage_distributor",
      }),
      await ensureVendor(tx, admin.actor, {
        name: "southern glazer's",
        type: "beverage_distributor",
      }),
    ]);
    expect(ids[0]).toBe(vendor.id);
    expect(ids[2]).toBe(ids[1]);
    const names = (await admin.get<Vendor[]>("/api/vendors")).map((v) => v.name);
    expect(names).toEqual(["Imperio", "Southern Glazer's"]);
  });

  it("AC2: lists the items a vendor supplies and links each back to it", async () => {
    const vendor = await admin.create(imperio);
    const titos = await admin.createItem({
      kind: "consumable",
      subtype: "bar",
      name: "Tito's Vodka",
      category: "Liquor",
      consumable: {
        purchaseUnit: "case",
        packCount: 12,
        preferredVendor: "typed by hand",
        preferredVendorId: vendor.id,
      },
    });
    expect(titos.consumable).toMatchObject({
      preferredVendorId: vendor.id,
      preferredVendor: "Imperio",
    });
    const rentals = await admin.create(partyRentals);
    const tent = await admin.createItem({
      kind: "rental",
      subtype: "equipment",
      name: "20x40 Frame Tent",
      code: "TENT-2040",
      rental: {
        priceCents: 90000,
        vendorId: rentals.id,
        vendorCostCents: 60000,
        leadTimeDays: 7,
      },
    });
    await admin.createItem({
      kind: "rental",
      subtype: "furniture",
      name: "Owned Chair",
      rental: {},
    });
    expect((await admin.get<VendorDetail>(`/api/vendors/${vendor.id}`)).items)
      .toEqual([
        {
          id: titos.id,
          name: "Tito's Vodka",
          code: "",
          kind: "consumable",
          subtype: "bar",
          relation: "supplies",
        },
      ]);
    expect(
      (await admin.get<VendorDetail>(`/api/vendors/${rentals.id}`)).items,
    ).toEqual([
      expect.objectContaining({
        id: tent.id,
        code: "TENT-2040",
        relation: "sub_rental",
      }),
    ]);
    // Renaming the vendor renames the item's preferred vendor.
    await admin.call(`/api/vendors/${vendor.id}`, "PUT", {
      ...imperio,
      name: "Imperio Wine & Spirits",
    });
    const item = await admin.get<InventoryItem>(
      `/api/inventory/items/${titos.id}`,
    );
    expect(item.consumable?.preferredVendor).toBe("Imperio Wine & Spirits");
  });

  it("AC4: global search finds a vendor by name for everyone, and by contact only for FT+", async () => {
    await admin.create(imperio);
    for (const who of [admin, partTimeStaff]) {
      const [first] = (await who.search("Imperoi")).filter(
        (result) => result.type === "vendor",
      );
      expect(first).toMatchObject({
        title: "Imperio",
        subtitle: "Beverage distributor",
      });
      expect(first.path).toMatch(/^\/vendors\/[0-9a-f-]{36}$/);
    }
    for (const query of ["dana@imperio", "555-0177", "Dana Reyes"]) {
      expect(
        (await fullTimeStaff.search(query)).map((result) => result.title),
      ).toContain("Imperio");
      expect(
        (await partTimeStaff.search(query)).map((result) => result.title),
      ).not.toContain("Imperio");
    }
  });
});

describe("vendor (sub-rental) items (FLOW-75)", () => {
  it("links a rental to a vendor with its cost, price and lead time", async () => {
    const vendor = await admin.create(partyRentals);
    const tent = await admin.createItem({
      kind: "rental",
      subtype: "equipment",
      name: "20x40 Frame Tent",
      rental: {
        priceCents: 90000,
        vendorId: vendor.id,
        vendorCostCents: 60000,
        leadTimeDays: 7,
      },
    });
    expect(tent.rental).toMatchObject({
      priceCents: 90000,
      vendorId: vendor.id,
      vendorName: "Capital Party Rentals",
      vendorCostCents: 60000,
      leadTimeDays: 7,
    });
    // The vendor cost is hidden like other rental costs.
    const seen = await fullTimeStaff.get<InventoryItem>(
      `/api/inventory/items/${tent.id}`,
    );
    expect(seen.rental).toMatchObject({
      vendorName: "Capital Party Rentals",
      vendorCostCents: null,
      leadTimeDays: 7,
    });
  });

  it("refuses a lead time without a vendor, and an archived vendor", async () => {
    const result = await admin.call("/api/inventory/items", "POST", {
      kind: "rental",
      subtype: "equipment",
      name: "Tent",
      rental: { leadTimeDays: 7 },
    });
    expect(result.status).toBe(400);
    expect(result.json.error.message).toBe(
      "Pick the vendor this item is rented from.",
    );
    const vendor = await admin.create(partyRentals);
    await admin.call(`/api/vendors/${vendor.id}/archive`, "POST", {});
    const archived = await admin.call("/api/inventory/items", "POST", {
      kind: "rental",
      subtype: "equipment",
      name: "Tent",
      rental: { vendorId: vendor.id },
    });
    expect(archived.status).toBe(409);
    expect(archived.json.error.code).toBe("VENDOR_ARCHIVED");
  });
});
