import { readdirSync, statSync } from "node:fs";
// Vite's warning threshold is 500 kB (uncompressed). Keep it a CI gate.
const oversized = readdirSync("dist/assets").filter(
  (name) => name.endsWith(".js") && statSync(`dist/assets/${name}`).size > 500_000,
);
if (oversized.length) throw new Error(`SPA chunks exceed 500 kB: ${oversized.join(", ")}`);
