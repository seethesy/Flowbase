// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import type { Actor } from "../../shared/access";
import {
  diffSnapshots,
  hideFields,
  maskField,
  redactAll,
} from "../../worker/audit/log";

const env = { ASSETS: { fetch } };
const id = "8d6f2a4e-5b1c-4e8a-9f3d-2c7b1a0e6d54";
const admin: Actor = { userId: id, role: "admin", employmentType: "full_time" };

it("diffs only the fields that changed", () => {
  expect(
    diffSnapshots(
      { id, name: "Juniper", tags: ["vip"], notes: "", updatedAt: "a" },
      { id, name: "Juniper & Co.", tags: ["vip"], notes: "", updatedAt: "b" },
    ),
  ).toEqual({ name: { before: "Juniper", after: "Juniper & Co." } });
});
it("compares nested values by content and treats missing as null", () => {
  expect(
    diffSnapshots(
      { contacts: [{ name: "Olivia", email: "o@x.example" }], venue: null },
      { contacts: [{ name: "Olivia", email: "o@x.example" }] },
    ),
  ).toEqual({});
  expect(
    diffSnapshots({ areas: ["Lawn"] }, { areas: ["Lawn", "Terrace"] }),
  ).toEqual({ areas: { before: ["Lawn"], after: ["Lawn", "Terrace"] } });
});
it("records every set field on create", () => {
  expect(diffSnapshots(null, { id, title: "Gala", venue: null })).toEqual({
    title: { before: null, after: "Gala" },
  });
});
it("hides and masks fields, dropping a field whose visible part didn't change", () => {
  const changes = {
    name: { before: "A", after: "B" },
    possibleDuplicateOf: { before: null, after: { id, name: "X" } },
    contacts: {
      before: [{ name: "O", email: "old@x.example" }],
      after: [{ name: "O", email: "new@x.example" }],
    },
  };
  const hideEmail = (value: unknown) =>
    (value as { name: string }[]).map((c) => ({ ...c, email: null }));
  expect(
    redactAll(hideFields("possibleDuplicateOf"), maskField("contacts", hideEmail))(
      changes,
    ),
  ).toEqual({ name: { before: "A", after: "B" } });
  const renamed = {
    contacts: { before: [{ name: "O", email: "a" }], after: [{ name: "P", email: "b" }] },
  };
  expect(maskField("contacts", hideEmail)(renamed)).toEqual({
    contacts: {
      before: [{ name: "O", email: null }],
      after: [{ name: "P", email: null }],
    },
  });
});
it("answers 401 for history without a signed-in user", async () => {
  const withDb = vi.fn<RunWithDb>();
  for (const resource of ["clients", "venues", "events"]) {
    const response = await createApp({
      withDb: withDb as unknown as RunWithDb,
    }).request(`/api/${resource}/${id}/history`, {}, env);
    expect(response.status).toBe(401);
  }
  expect(withDb).not.toHaveBeenCalled();
});
it("offers no way to change or remove audit rows", async () => {
  const withDb = vi.fn<RunWithDb>();
  const app = createApp({
    withDb: withDb as unknown as RunWithDb,
    resolveActor: async () => admin,
  });
  for (const resource of ["clients", "venues", "events"])
    for (const method of ["PUT", "PATCH", "DELETE", "POST"]) {
      const response = await app.request(
        `/api/${resource}/${id}/history`,
        { method, body: "{}" },
        env,
      );
      expect(response.status).toBe(404);
    }
  expect(withDb).not.toHaveBeenCalled();
});
