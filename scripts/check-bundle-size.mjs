import { readdirSync, statSync } from "node:fs";
// Vite's warning threshold is 500 kB (uncompressed). Keep it a CI gate.
// The Excalidraw chunk is the one exception: it loads only on the layout
// annotation screen (FLOW-147), never with the app shell.
const oversized = readdirSync("dist/assets").filter(
  (name) =>
    name.endsWith(".js") &&
    !name.startsWith("excalidraw") &&
    statSync(`dist/assets/${name}`).size > 500_000,
);
if (oversized.length) throw new Error(`SPA chunks exceed 500 kB: ${oversized.join(", ")}`);
