// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../../worker/app";
import type { Db } from "../../worker/db/client";
import type { RunWithDb } from "../../worker/hono";
import type { Actor } from "../../shared/access";
import type { StaffMember } from "../../shared/staff";
import {
  businessDefaultsSchema,
  companyProfileSchema,
  defaultBusinessDefaults,
  fallbackSettings,
} from "../../shared/settings";
import {
  addListValue,
  getSettings,
  orderListValues,
  renameListValue,
  setListValueArchived,
  settingsHistory,
  updateSetting,
} from "../../worker/records/settings";
import {
  getStaffMember,
  listStaff,
  updateStaffMember,
} from "../../worker/records/staff";

vi.mock("../../worker/records/settings", async (original) => ({
  ...(await original<typeof import("../../worker/records/settings")>()),
  getSettings: vi.fn(),
  updateSetting: vi.fn(),
  addListValue: vi.fn(),
  renameListValue: vi.fn(),
  orderListValues: vi.fn(),
  setListValueArchived: vi.fn(),
  settingsHistory: vi.fn(),
}));
vi.mock("../../worker/records/staff", async (original) => ({
  ...(await original<typeof import("../../worker/records/staff")>()),
  listStaff: vi.fn(),
  getStaffMember: vi.fn(),
  updateStaffMember: vi.fn(),
}));

const valueId = "40000000-0000-4000-8000-000000000001";
const userId = "40000000-0000-4000-8000-000000000002";
const admin: Actor = { userId, role: "admin", employmentType: "full_time" };
const staff: Actor = { userId, role: "staff", employmentType: "part_time" };
let actor: Actor = admin;
const withDb: RunWithDb = (_env, run) => run({} as Db);
const app = createApp({ withDb, resolveActor: async () => actor });
const env = { ASSETS: { fetch } };
const send = (path: string, method = "GET", body?: unknown) =>
  app.request(
    path,
    {
      method,
      ...(body !== undefined && {
        headers: { "Content-Type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    },
    env,
  );
const value = {
  id: valueId,
  listKey: "event_type",
  label: "Gala",
  sortOrder: 2,
  archived: false,
} as const;
const company = { name: "Acme Catering", website: "", salesContact: "", logo: null };

beforeEach(() => {
  vi.clearAllMocks();
  actor = admin;
  vi.mocked(getSettings).mockResolvedValue(fallbackSettings);
  vi.mocked(updateSetting).mockImplementation(async (_db, _actor, _key, input) => input);
  vi.mocked(addListValue).mockResolvedValue(value);
  vi.mocked(renameListValue).mockResolvedValue(value);
  vi.mocked(orderListValues).mockResolvedValue([value]);
  vi.mocked(setListValueArchived).mockResolvedValue({ ...value, archived: true });
  vi.mocked(settingsHistory).mockResolvedValue([]);
});

it("lets every signed-in role read the settings, but only Admin change them", async () => {
  actor = staff;
  expect((await send("/api/settings")).status).toBe(200);
  for (const [path, method, body] of [
    ["/api/settings/company", "PUT", company],
    ["/api/settings/defaults", "PUT", {}],
    ["/api/settings/lists/event_type", "POST", { label: "Gala" }],
    ["/api/settings/lists/event_type/order", "PUT", { ids: [valueId] }],
    [`/api/settings/values/${valueId}`, "PATCH", { label: "Gala" }],
    [`/api/settings/values/${valueId}/archive`, "POST", {}],
    [`/api/settings/values/${valueId}/restore`, "POST", {}],
    ["/api/settings/history", "GET", undefined],
  ] as const)
    expect((await send(path, method, body)).status, `${method} ${path}`).toBe(403);
  expect(updateSetting).not.toHaveBeenCalled();
  expect(addListValue).not.toHaveBeenCalled();
});

it("saves the company profile and defaults after validating them", async () => {
  const saved = await send("/api/settings/company", "PUT", company);
  expect(saved.status).toBe(200);
  expect(updateSetting).toHaveBeenCalledWith(
    expect.anything(),
    admin,
    "company",
    companyProfileSchema.parse(company),
  );
  expect((await send("/api/settings/defaults", "PUT", { idleCutoffMinutes: 3 })).status).toBe(200);
  expect(updateSetting).toHaveBeenLastCalledWith(
    expect.anything(),
    admin,
    "defaults",
    { ...defaultBusinessDefaults, idleCutoffMinutes: 3 },
  );
  for (const body of [
    "{",
    { ...company, name: " " },
    { ...company, logo: "data:image/svg+xml;base64,PHN2Zz4=" },
    { ...company, logo: "https://example.com/logo.png" },
  ])
    expect((await send("/api/settings/company", "PUT", body)).status).toBe(400);
  for (const body of [
    { rentalBufferDaysBefore: -1 },
    { monthlySmsCap: 1.5 },
    { idleCutoffMinutes: 0 },
    {
      ratioDefaults: [
        { category: "Linen", quantity: 1, basis: "per_table" },
        { category: "linen", quantity: 2, basis: "per_guest" },
      ],
    },
  ])
    expect((await send("/api/settings/defaults", "PUT", body)).status).toBe(400);
  expect(updateSetting).toHaveBeenCalledTimes(2);
  expect(businessDefaultsSchema.parse({}).rentalBufferDaysBefore).toBe(1);
});

it("adds, renames, orders, archives and restores list values", async () => {
  const added = await send("/api/settings/lists/event_type", "POST", { label: " Gala " });
  expect(added.status).toBe(201);
  expect(addListValue).toHaveBeenCalledWith(expect.anything(), admin, "event_type", "Gala");
  expect((await send(`/api/settings/values/${valueId}`, "PATCH", { label: "Gala dinner" })).status).toBe(200);
  expect(renameListValue).toHaveBeenCalledWith(expect.anything(), admin, valueId, "Gala dinner");
  expect((await send("/api/settings/lists/event_type/order", "PUT", { ids: [valueId] })).status).toBe(200);
  expect(orderListValues).toHaveBeenCalledWith(expect.anything(), admin, "event_type", [valueId]);
  expect((await send(`/api/settings/values/${valueId}/archive`, "POST", {})).status).toBe(200);
  expect(setListValueArchived).toHaveBeenLastCalledWith(expect.anything(), admin, valueId, true);
  expect((await send(`/api/settings/values/${valueId}/restore`, "POST", {})).status).toBe(200);
  expect(setListValueArchived).toHaveBeenLastCalledWith(expect.anything(), admin, valueId, false);
});

it("rejects unknown lists, bad ids and empty labels before writing", async () => {
  expect((await send("/api/settings/lists/tax_rate", "POST", { label: "6%" })).status).toBe(404);
  expect((await send("/api/settings/values/not-a-uuid", "PATCH", { label: "x" })).status).toBe(404);
  expect((await send("/api/settings/lists/event_type", "POST", { label: "  " })).status).toBe(400);
  expect((await send("/api/settings/lists/event_type", "POST", { label: "x".repeat(101) })).status).toBe(400);
  expect((await send("/api/settings/lists/event_type/order", "PUT", { ids: ["nope"] })).status).toBe(400);
  expect(addListValue).not.toHaveBeenCalled();
  expect(orderListValues).not.toHaveBeenCalled();
});

const member: StaffMember = {
  id: userId,
  name: "Sam Server",
  email: "sam@gmail.com",
  mobile: "2025550123",
  role: "staff",
  employmentType: "part_time",
  status: "active",
  active: true,
  positions: ["Server"],
  notes: null,
  smsConsent: false,
  smsConsentAt: null,
};

it("serves the staff directory to every role and passes profile edits to the record module", async () => {
  vi.mocked(listStaff).mockResolvedValue([member]);
  vi.mocked(getStaffMember).mockResolvedValue(member);
  vi.mocked(updateStaffMember).mockResolvedValue(member);
  actor = staff;
  expect((await send("/api/staff")).status).toBe(200);
  expect(listStaff).toHaveBeenCalledWith(expect.anything(), staff);
  expect((await send(`/api/staff/${userId}`)).status).toBe(200);
  expect((await send("/api/staff/nope")).status).toBe(404);
  const updated = await send(`/api/staff/${userId}`, "PATCH", {
    mobile: "2025550199",
    smsConsent: true,
  });
  expect(updated.status).toBe(200);
  expect(updateStaffMember).toHaveBeenCalledWith(expect.anything(), staff, userId, {
    mobile: "2025550199",
    smsConsent: true,
  });
  for (const body of [
    { mobile: "" },
    { email: "new@gmail.com" },
    { positions: ["Server", "Server"] },
    { role: "owner" },
  ])
    expect((await send(`/api/staff/${userId}`, "PATCH", body)).status).toBe(400);
  expect(updateStaffMember).toHaveBeenCalledTimes(1);
});
