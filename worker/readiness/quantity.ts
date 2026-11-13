import type { Finding, ReadinessFacts } from "./types";

export function quantity(facts: ReadinessFacts): Finding[] {
  if (!facts.pull || !facts.guestCount) return [];
  return facts.pull.lines.filter((line) => line.quantity !== null && line.ratio !== null &&
    line.basis === "per_guest" && line.quantity < Math.ceil(line.ratio * facts.guestCount!)).map((line) => ({
      key: `quantity:${line.id}`, kind: "quantity", signature: `quantity:${line.id}:${line.quantity}:${facts.guestCount}:${line.ratio}`,
      question: `The Pull List says to pull ${line.quantity} ${line.name}, but the guest count for the event is ${facts.guestCount}`,
    }));
}
