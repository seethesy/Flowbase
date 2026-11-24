export type AreaMap = {
  smoke: string[];
  core: string[];
  skip: string[];
  full: string[];
  areas: Record<string, { paths: string[]; specs: string[] }>;
};
export type Selection = { mode: "skip" | "selected" | "full"; specs: string[]; shards: number[] };
export const SMALL_SELECTION: number;
export function globToRegExp(glob: string): RegExp;
export function listSpecs(root?: string): string[];
export function selectSpecs(changed: string[], map: AreaMap, options: { draft: boolean; specs: string[] }): Selection;
export function readMap(root?: string): AreaMap;
