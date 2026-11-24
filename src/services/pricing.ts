import { priceItemSchema, type PriceInput } from "../../shared/pricing";
import { at, request } from "./core";

// Sales › Pricing's price list (FLOW-329).
export const pricingApi = {
  list: () => request(priceItemSchema.array(), "/api/pricing"),
  create: (input: PriceInput) => request(priceItemSchema, "/api/pricing", "POST", input),
  update: (id: string, input: PriceInput) => request(priceItemSchema, at("pricing", id), "PUT", input),
  setArchived: (id: string, archived: boolean) =>
    request(priceItemSchema, at("pricing", id, archived ? "archive" : "restore"), "POST", {}),
};
