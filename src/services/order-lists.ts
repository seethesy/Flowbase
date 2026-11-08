import { orderListSchema, type OrderLine, type ReceiveInput, type RecordOrderInput } from "../../shared/order-lists";
import { request } from "./core";

export const orderListsApi = {
  list: () => request(orderListSchema.array(), "/api/order-lists"),
  get: (id: string) => request(orderListSchema, `/api/order-lists/${id}`),
  create: (from: string, to: string) => request(orderListSchema, "/api/order-lists", "POST", { from, to }),
  update: (id: string, lines: OrderLine[]) => request(orderListSchema, `/api/order-lists/${id}`, "PUT", { lines }),
  submit: (id: string) => request(orderListSchema, `/api/order-lists/${id}/submit`, "POST", {}),
  // Ordering record (FLOW-87) and receiving (FLOW-88).
  recordOrder: (id: string, input: RecordOrderInput) =>
    request(orderListSchema, `/api/order-lists/${id}/orders`, "POST", input),
  cancel: (id: string) => request(orderListSchema, `/api/order-lists/${id}/cancel`, "POST", {}),
  cancelOrder: (id: string, orderId: string) =>
    request(orderListSchema, `/api/order-lists/${id}/orders/${orderId}/cancel`, "POST", {}),
  receive: (id: string, orderId: string, input: ReceiveInput) =>
    request(orderListSchema, `/api/order-lists/${id}/orders/${orderId}/receive`, "POST", input),
};
