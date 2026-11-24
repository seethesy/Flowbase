import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, dirname, extname } from "node:path";

const files = ["README.md", "docs/development.md",
  ...(await readdir("docs/features")).filter((name) => name.endsWith(".md"))
    .map((name) => `docs/features/${name}`)];
const errors = [];
const slug = (heading) => heading.toLowerCase().replace(/[^\w -]/g, "").replace(/ /g, "-");

for (const file of files) {
  const body = await readFile(file, "utf8");
  for (const [, target] of body.matchAll(/\]\(([^)]+)\)/g)) {
    if (/^(?:https?:|mailto:|\/)/.test(target)) continue;
    const [path, anchor] = target.split("#", 2);
    const destination = path ? resolve(dirname(file), decodeURI(path)) : resolve(file);
    try {
      if (!(await stat(destination)).isFile()) throw new Error("not a file");
      if (anchor && extname(destination) === ".md") {
        const text = await readFile(destination, "utf8");
        const headings = [...text.matchAll(/^#{1,6} (.+)$/gm)].map((match) => slug(match[1]));
        if (!headings.includes(anchor)) throw new Error(`missing #${anchor}`);
      }
    } catch (error) {
      errors.push(`${file}: ${target} (${error.message})`);
    }
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else console.log(`Checked relative links in ${files.length} documentation files`);
