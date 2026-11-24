import { readdir, unlink } from "node:fs/promises";

const directory = new URL("../drizzle/meta/", import.meta.url);
const snapshots = (await readdir(directory))
  .filter((name) => /^\d+_snapshot\.json$/.test(name))
  .sort((a, b) => Number(a.split("_")[0]) - Number(b.split("_")[0]));

if (snapshots.length === 0) throw new Error("No Drizzle snapshots found");
for (const name of snapshots.slice(0, -1)) {
  await unlink(new URL(name, directory));
}
console.log(`Kept ${snapshots.at(-1)}; removed ${snapshots.length - 1} older snapshots`);
