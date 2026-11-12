import type { Finding, ReadinessFacts } from "./types";

export function resource(facts: ReadinessFacts): Finding[] {
  return facts.trucks.filter((truck) => truck.conflictMessage).map((truck) => ({
    key: `truck-conflict:${truck.id}`, kind: "resource", question: truck.conflictMessage!,
    signature: `conflict:${truck.id}:${truck.conflictMessage}`,
  }));
}
