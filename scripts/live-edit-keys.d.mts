// Types for the live-edit key manifest builder (FLOW-277), so tests can import it.
export type LiveEditManifest = {
  version: 1;
  // Wording key -> its default's {placeholder} names, sorted.
  copy: Record<string, string[]>;
  // Prefixes of keys the code builds at run time (label maps, table columns).
  copyPrefixes: string[];
  // Page key -> its built-in block ids and field-card ids.
  layout: Record<string, { blocks: string[]; fieldCards: string[] }>;
  // Layout-aware table keys (layoutTables).
  tables: string[];
  // Every sidebar heading and tab key (FLOW-284), e.g. "sales" and "sales.venues".
  nav?: string[];
};
export type CopyUsage = { key: string; text: string; where: string };
export type Renames = {
  copy: Record<string, string>;
  blocks: Record<string, string>;
  removed: { copy: string[]; blocks: string[] };
};

export const MANIFEST_PATH: string;
export function placeholderNames(text: string): string[];
export function scanSource(
  file: string,
  text: string,
): { copy: CopyUsage[]; prefixes: string[]; blocks: { pageKey: string; id: string; where: string }[]; problems: string[] };
export function copyUsages(root?: string): CopyUsage[];
export function scanNavigation(text: string): string[];
export function buildManifest(root?: string): { manifest: LiveEditManifest; problems: string[] };
export function manifestText(manifest: LiveEditManifest): string;
export function lostKeys(base: LiveEditManifest, head: LiveEditManifest, renames: Renames): string[];
