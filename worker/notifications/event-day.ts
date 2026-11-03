import { utcToBusinessTime } from "../../shared/time";

export function changedOnEventDay(
  eventStart: Date,
  changedAt: Date,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  if (utcToBusinessTime(eventStart).date !== utcToBusinessTime(changedAt).date) return false;
  const original = { ...before };
  const current = { ...after };
  delete original.updatedAt;
  delete current.updatedAt;
  return JSON.stringify(original) !== JSON.stringify(current);
}
