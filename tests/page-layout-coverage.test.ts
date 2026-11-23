// @vitest-environment node
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
// @ts-expect-error Build-time source scanner.
import { layoutCoverage } from "../scripts/page-layout-coverage.mjs";

it("FLOW-283: every routed page renders a grid", () => {
  const result = layoutCoverage(process.cwd());
  expect(result.routes.length).toBeGreaterThan(40);
  expect(result.missing).toEqual([]);
});
it("FLOW-283: a new unwrapped route fails even when a sibling component has a grid", () => {
  const file = resolve("src/app/router.tsx");
  const source = readFileSync(file, "utf8");
  const text = source.replace('children: [', 'children: [{ path: "/unguarded", element: <Unguarded /> },') + '\nfunction Unguarded() { return <p>Unwrapped</p>; }';
  expect(layoutCoverage(process.cwd(), { [file]: text }).missing).toContain("/unguarded: Unguarded needs a PageGrid");
});
