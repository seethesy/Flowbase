import { expect, it } from "vitest";
import { responseSchema } from "../e2e/response-contracts";
import { juniper } from "../e2e/fixtures";
import { productionListSchema, productionOverviewSchema } from "../../shared/production";
import { readinessCheckSchema } from "../../shared/readiness";

it("rejects an API response that drifts from the shared browser contract", () => {
  const contract = responseSchema("/api/clients", "GET", 200);
  expect(contract.parse([juniper()])).toHaveLength(1);
  expect(() =>
    contract.parse([{ ...juniper(), contacts: "renamed-or-wrong-type" }]),
  ).toThrow();
  expect(() =>
    responseSchema("/api/new-unmapped-resource", "GET", 200),
  ).toThrow("Missing shared response contract");
});

it("maps production responses to their shared contracts", () => {
  const eventId = "e0000000-0000-4000-8000-000000000001";
  expect(responseSchema("/api/production/overview", "GET", 200)).toBe(productionOverviewSchema);
  expect(responseSchema(`/api/production/events/${eventId}`, "GET", 200)).toBe(productionListSchema);
  expect(responseSchema(`/api/production/events/${eventId}/readiness`, "GET", 200))
    .toEqual(readinessCheckSchema.array());
  expect(responseSchema(`/api/production/events/${eventId}/readiness/check-key`, "POST", 200))
    .toEqual(readinessCheckSchema.array());
});
