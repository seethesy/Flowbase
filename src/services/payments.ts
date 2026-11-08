import {
  eventPaymentsSchema,
  type PaymentInput,
  type ScheduleItemInput,
} from "../../shared/payments";
import { at, request } from "./core";

// Payment schedule and log (FLOW-131). Every call answers with the whole page.
const base = (eventId: string) => at("events", eventId, "payments");
const item = (eventId: string, itemId: string, action = "") =>
  `${base(eventId)}/schedule/${encodeURIComponent(itemId)}${action && `/${action}`}`;
export const paymentsApi = {
  get: (eventId: string) => request(eventPaymentsSchema, base(eventId)),
  addItem: (eventId: string, input: ScheduleItemInput) =>
    request(eventPaymentsSchema, `${base(eventId)}/schedule`, "POST", input),
  updateItem: (eventId: string, itemId: string, input: ScheduleItemInput) =>
    request(eventPaymentsSchema, item(eventId, itemId), "PUT", input),
  archiveItem: (eventId: string, itemId: string) =>
    request(eventPaymentsSchema, item(eventId, itemId, "archive"), "POST", {}),
  record: (eventId: string, input: PaymentInput) =>
    request(eventPaymentsSchema, base(eventId), "POST", input),
  archivePayment: (eventId: string, paymentId: string) =>
    request(
      eventPaymentsSchema,
      `${base(eventId)}/${encodeURIComponent(paymentId)}/archive`,
      "POST",
      {},
    ),
};
