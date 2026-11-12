import type { Finding, ReadinessFacts } from "./types";

export function responsibility(facts: ReadinessFacts): Finding[] {
  return [
    ...facts.tasks.filter((task) => !task.assigneeIds.length).map((task) => ({
      key: `task:${task.id}`, kind: "responsibility" as const,
      question: `Who is ${task.title.replace(/^build\s+(?:the\s+)?/i, "building the ").replace(/^load\s+/i, "loading ")}?`,
      signature: `unassigned:${task.id}:${task.title}`,
    })),
    ...facts.trucks.filter((truck) => !truck.loaderIds.length).map((truck) => ({
      key: `loader:${truck.id}`, kind: "responsibility" as const,
      question: "Who is loading the truck going to the event?",
      signature: `loader:${truck.id}`,
    })),
  ];
}
