import { orderListSchema, type OrderLine } from "../../shared/order-lists";
import { request } from "./core";

export const orderListsApi = {
  list: () => request(orderListSchema.array(), "/api/order-lists"),
  get: (id: string) => request(orderListSchema, `/api/order-lists/${id}`),
  create: (from: string, to: string) => request(orderListSchema, "/api/order-lists", "POST", { from, to }),
  update: (id: string, lines: OrderLine[]) => request(orderListSchema, `/api/order-lists/${id}`, "PUT", { lines }),
  submit: (id: string) => request(orderListSchema, `/api/order-lists/${id}/submit`, "POST", {}),
};
