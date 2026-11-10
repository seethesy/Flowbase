import { closeoutSchema, type CloseoutInput } from "../../shared/closeout";
import { at, request } from "./core";

// Post-event closeout and returns (FLOW-157).
export const closeoutApi = {
  get: (eventId: string) => request(closeoutSchema, at("events", eventId, "closeout")),
  submit: (eventId: string, input: CloseoutInput) =>
    request(closeoutSchema, at("events", eventId, "closeout"), "POST", input),
};
