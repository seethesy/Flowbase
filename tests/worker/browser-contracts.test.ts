import { expect, it } from "vitest";
import { responseSchema } from "../e2e/response-contracts";
import { juniper } from "../e2e/fixtures";

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
