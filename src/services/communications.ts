import {
  communicationSchema,
  type CommunicationInput,
} from "../../shared/communications";
import { query, request, requestPage } from "./core";

// Client for the communication log API (FLOW-120).
export type CommunicationTarget =
  | { leadId: string }
  | { clientId: string }
  | { eventId: string };

export const communicationsApi = {
  list: (target: CommunicationTarget, cursor?: string) =>
    requestPage(communicationSchema, `/api/communications${query({ ...target, cursor })}`),
  log: (input: CommunicationInput) =>
    request(communicationSchema, "/api/communications", "POST", input),
};
