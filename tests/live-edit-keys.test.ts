// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildManifest,
  lostKeys,
  manifestText,
  MANIFEST_PATH,
  scanSource,
  type LiveEditManifest,
} from "../scripts/live-edit-keys.mjs";
import { hubSectionSchema } from "../shared/event-hub";
import { liveEditRenames, type LiveEditRenames } from "../shared/live-edit-renames";

// FLOW-277: the Admin's saved wording and layouts are matched to the code by
// key. The committed manifest lists every key; a key or block id that
// disappears needs a rename or a removed entry in shared/live-edit-renames.ts.

const { manifest, problems } = buildManifest(".");
const committed = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as LiveEditManifest;

// The base branch's manifest: the PR's base in CI (fetch-depth 0), else main.
function baseManifest(): LiveEditManifest | null {
  const branch = process.env.GITHUB_BASE_REF || "main";
  for (const ref of [`origin/${branch}`, branch]) {
    try {
      const mergeBase = execFileSync("git", ["merge-base", "HEAD", ref], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      return JSON.parse(
        execFileSync("git", ["show", `${mergeBase}:${MANIFEST_PATH}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
      ) as LiveEditManifest;
    } catch {
      // No such ref, or the base has no manifest yet (the branch that adds it).
    }
  }
  return null;
}

describe("live-edit key manifest", () => {
  it("can place every block on its page", () => {
    expect(problems).toEqual([]);
  });

  it("is up to date: run npm run live-edit:keys and commit shared/generated/live-edit-keys.json", () => {
    expect(manifestText(committed)).toBe(manifestText(manifest));
  });

  it("lists wording, placeholders, blocks, field cards and tables", () => {
    expect(manifest.copy["nav.day-of"]).toEqual([]);
    expect(Object.keys(manifest.copy).length).toBeGreaterThan(1000);
    expect(manifest.layout["leads.detail"].fieldCards).toEqual(["lead-facts"]);
    expect(manifest.layout["dashboard.home"].blocks).toContain("my-leads");
    expect(manifest.tables).toContain("leads.inbox.table");
    // Sidebar heading and tab keys (FLOW-284), with each heading's Overview tab.
    expect(manifest.nav).toContain("sales");
    expect(manifest.nav).toContain("sales.venues");
    expect(manifest.nav).toContain("reports.overview");
    expect(manifest.nav).toContain("events.day-of");
    // Event hub blocks come from blockIds: one per hub section.
    expect(manifest.layout["events.detail"].blocks).toEqual(
      hubSectionSchema.options.map((section) => section.replace(/_/g, "-")).sort(),
    );
  });

  it("keeps every key and block id the base branch had, or lists it in shared/live-edit-renames.ts", () => {
    const base = baseManifest();
    if (!base) return;
    expect(lostKeys(base, manifest, liveEditRenames)).toEqual([]);
  });

  it("names only renames and removals of keys that exist", () => {
    // A rename's target must be a key the code renders now.
    const known = (key: string) =>
      Object.hasOwn(manifest.copy, key) || manifest.copyPrefixes.some((prefix) => key.startsWith(prefix));
    expect(Object.values(liveEditRenames.copy).filter((key) => !known(key))).toEqual([]);
    for (const [entry, id] of Object.entries(liveEditRenames.blocks)) {
      const pageKey = entry.slice(0, entry.indexOf("/"));
      const page = manifest.layout[pageKey];
      expect([...(page?.blocks ?? []), ...(page?.fieldCards ?? [])], entry).toContain(id);
    }
  });
});

describe("the CI guard (AC2)", () => {
  const base: LiveEditManifest = {
    version: 1,
    copy: { "staff.staff-form.save-profile": [], "tasks.list.title": [], "events.event-detail.notes": [] },
    copyPrefixes: ["events.event-detail."],
    layout: { "events.detail": { blocks: ["notes", "files"], fieldCards: ["event-facts"] } },
    tables: [],
  };
  const head: LiveEditManifest = {
    ...base,
    copy: { "staff.staff-form.save": [], "tasks.list.title": [] },
    layout: { "events.detail": { blocks: ["event-notes"], fieldCards: ["event-facts"] } },
  };
  const none: LiveEditRenames = { copy: {}, blocks: {}, removed: { copy: [], blocks: [] } };

  it("fails on a renamed or dropped key and says which file to update", () => {
    const lost = lostKeys(base, head, none);
    expect(lost).toHaveLength(4);
    expect(lost[0]).toContain('"staff.staff-form.save-profile" is gone');
    expect(lost[0]).toContain("shared/live-edit-renames.ts");
    // A literal key under a run-time prefix still counts as lost.
    expect(lost[1]).toContain("events.event-detail.notes");
    expect(lost[2]).toContain('"events.detail/notes"');
    expect(lost[3]).toContain('"events.detail/files"');
  });

  it("passes with a rename or removed entry for each", () => {
    expect(
      lostKeys(base, head, {
        copy: { "staff.staff-form.save-profile": "staff.staff-form.save" },
        blocks: { "events.detail/notes": "event-notes" },
        removed: { copy: ["events.event-detail.notes"], blocks: ["events.detail/files"] },
      }),
    ).toEqual([]);
  });

  it("fails on a rename to a key no screen renders", () => {
    expect(
      lostKeys(base, head, {
        ...none,
        copy: { "staff.staff-form.save-profile": "staff.staff-form.typo" },
        removed: { copy: ["events.event-detail.notes"], blocks: ["events.detail/notes", "events.detail/files"] },
      }),
    ).toEqual(['Wording key "staff.staff-form.save-profile" is renamed to "staff.staff-form.typo", which no screen renders.']);
  });
});

describe("the scanner", () => {
  it("reads blocks, placeholders, prefixes and nav ids", () => {
    const result = scanSource(
      "src/features/example.tsx",
      `export const X = () => (
        <PageGrid pageKey="example.page">
          <Block id="summary" name="Summary"><T id="example.page.hello" values={{ name }}>{"Hello {name}"}</T></Block>
          <LabelT id="labels.example" value={v}>{label}</LabelT>
          <DataTable copyKey="example.table" />
        </PageGrid>
      );`,
    );
    expect(result.blocks.map((block) => `${block.pageKey}/${block.id}`)).toEqual(["example.page/summary"]);
    // Placeholder defaults are string literals, as in the app's own <T>s.
    expect(result.copy.map((usage) => usage.key)).toEqual(["example.page.hello"]);
    expect(result.prefixes).toEqual(["labels.example.", "example.table."]);
    expect(result.problems).toEqual([]);
    const nav = scanSource("src/app/navigation.ts", `const tabs = [{ copyId: "day-of", name: "Day-of", to: "/day-of" }];`);
    expect(nav.copy).toEqual([expect.objectContaining({ key: "nav.day-of", text: "Day-of" })]);
  });

  it("refuses a block it can't name", () => {
    const result = scanSource("src/features/x.tsx", `const X = () => <PageGrid pageKey="x.y">{ids.map((id) => <Block id={id} name="X" />)}</PageGrid>;`);
    expect(result.problems[0]).toContain("literal id");
  });
});
