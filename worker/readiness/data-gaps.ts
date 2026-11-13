import type { Finding, ReadinessFacts } from "./types";

export function dataGaps(facts: ReadinessFacts): Finding[] {
  return [
    ...(facts.pull?.lines.filter((line) => line.quantity === null).map((line) => ({ key: `tbd:${line.id}`,
      kind: "data_gap" as const, question: `How many ${line.name} should be pulled?`, signature: `tbd:${line.id}` })) ?? []),
    ...facts.slots.filter((slot) => !slot.assigneeId).map((slot) => ({ key: `slot:${slot.id}`,
      kind: "data_gap" as const, question: `Who fills the ${slot.position} slot?`, signature: `slot:${slot.id}` })),
    ...facts.dishes.filter((dish) => dish.yieldServings === null).map((dish) => ({ key: `yield:${dish.id}`,
      kind: "data_gap" as const, question: `What is the yield for ${dish.name}?`, signature: `yield:${dish.id}` })),
    ...facts.proposalLines.filter((line) => ["menu", "rental", "decor", "service"].includes(line.kind) && !line.catalogId && !line.notTracked)
      .map((line) => ({ key: `proposal:${line.id}`, kind: "data_gap" as const,
        question: `What catalog item matches ${line.name}?`, signature: `proposal:${line.id}:${line.name}` })),
  ];
}
