// @vitest-environment node
import { it, expect } from "vitest";
import { app } from "../../worker/app";
import { clients } from "../../src/data/mock/fixtures";

it("serves health and fixture records", async () => {
  expect(await (await app.request("/api/health")).json()).toMatchObject({
    ok: true,
    version: "0.1.0",
    database: "not_configured",
  });
  expect(await (await app.request("/api/demo/clients")).json()).toEqual(
    clients,
  );
});
it("validates writes and ID matches, including malformed JSON", async () => {
  for (const body of ["{", JSON.stringify({ ...clients[0], id: "mismatch" })]) {
    const response = await app.request("/api/demo/clients/cli-1", {
      method: "PUT",
      body,
    });
    expect(response.status).toBe(400);
  }
  const response = await app.request(`/api/demo/clients/${clients[0].id}`, {
    method: "PUT",
    body: JSON.stringify(clients[0]),
  });
  expect(await response.json()).toEqual(clients[0]);
});
it("does not return the SPA for an unknown API route", async () => {
  expect((await app.request("/api/missing")).status).toBe(404);
});
it("delegates SPA requests to the static asset binding", async () => {
  const response = await app.request(
    "/",
    {},
    {
      ASSETS: {
        fetch: async () =>
          new Response("<html>Flowbase</html>", {
            headers: { "Content-Type": "text/html" },
          }),
      },
    },
  );
  expect(await response.text()).toContain("Flowbase");
});
