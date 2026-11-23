// @vitest-environment node
import { expect, it } from "vitest";
import { copyUsages } from "../scripts/live-edit-keys.mjs";
import { copyKeySchema } from "../shared/copy";

// Live text editing (FLOW-240): one key per distinct string, so a key must have
// the same default everywhere it is used, and every key follows the convention
// in docs/live-text-editing.md. Scans every <T id="…">, <Plural id="…"> and
// useCopy("…", "…") with literal arguments under src/, and each nav copyId.

// The scan is shared with the key manifest (FLOW-277, scripts/live-edit-keys.mjs).
const usages = () => copyUsages(".");

it("finds the wrapped wording", () => {
  expect(usages().length).toBeGreaterThan(1000);
});

it("gives each key one default everywhere it is used", () => {
  const defaults = new Map<string, { text: string; where: string }>();
  const conflicts: string[] = [];
  for (const usage of usages()) {
    const seen = defaults.get(usage.key);
    if (!seen) defaults.set(usage.key, usage);
    else if (seen.text !== usage.text)
      conflicts.push(`${usage.key}: "${seen.text}" (${seen.where}) vs "${usage.text}" (${usage.where})`);
  }
  expect(conflicts).toEqual([]);
});

it("names every key area.screen.element", () => {
  const bad = usages().filter((usage) => !copyKeySchema.safeParse(usage.key).success);
  expect(bad.map((usage) => `${usage.key} (${usage.where})`)).toEqual([]);
});
