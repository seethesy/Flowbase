import type { Finding, ReadinessFacts } from "./types";

export function schedule(facts: ReadinessFacts): Finding[] {
  return facts.pull && !facts.pull.scheduledAt ? [{ key: `pull:${facts.pull.id}`, kind: "schedule",
    question: "What day and time are items being pulled from inventory?", signature: `unscheduled:${facts.pull.id}:${facts.pull.updatedAt ?? ""}` }] : [];
}
