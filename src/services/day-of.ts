import {
  dayOfBoardSchema,
  dayOfLogSchema,
  dayOfUpdateSchema,
  type DayOfCheckpointInput,
  type DayOfCheckpointKey,
  type DayOfStaffUpdate,
  type DayOfTruckUpdate,
} from "../../shared/day-of";
import { at, request } from "./core";

// Day-of board and update log (FLOW-155/156). Each update answers with the log
// entry it wrote; the screens refetch the board.
export const dayOfApi = {
  board: (date: string) =>
    request(dayOfBoardSchema, `/api/day-of?date=${encodeURIComponent(date)}`),
  log: (eventId: string) => request(dayOfLogSchema, at("day-of/events", eventId, "log")),
  updateStaff: (slotId: string, input: DayOfStaffUpdate) =>
    request(dayOfUpdateSchema, at("day-of/staff", slotId), "PATCH", input),
  updateTruck: (assignmentId: string, input: DayOfTruckUpdate) =>
    request(dayOfUpdateSchema, at("day-of/trucks", assignmentId), "PATCH", input),
  setCheckpoint: (eventId: string, key: DayOfCheckpointKey, input: DayOfCheckpointInput) =>
    request(dayOfUpdateSchema, at("day-of/events", eventId, `checkpoints/${key}`), "PUT", input),
};
