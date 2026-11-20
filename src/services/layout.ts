import { z } from "zod";
import { fieldRegistry, type SourceKey } from "../../shared/fields";
import { savedLayoutSchema, type CardConfig, type LayoutDoc } from "../../shared/layout";
import { request } from "./core";

// Saved page layouts (FLOW-253) and custom card data (FLOW-256).
const path = (pageKey: string) => `/api/layout/${encodeURIComponent(pageKey)}`;
export const layoutApi = {
  get: (pageKey: string) => request(savedLayoutSchema, path(pageKey)),
  save: (pageKey: string, layout: LayoutDoc) => request(savedLayoutSchema, path(pageKey), "PUT", layout),
  reset: (pageKey: string) => request(z.null(), path(pageKey), "DELETE"),
};

const rowSchema = z.record(z.string(), z.unknown());
export type CardRow = z.infer<typeof rowSchema>;

// The fields a card reads: its columns or field boxes.
export function cardFields(card: CardConfig): string[] {
  const keys =
    card.display.type === "table"
      ? card.display.columns.map((column) => column.key)
      : card.display.boxes.flatMap((box) => (box.kind === "field" && box.field ? [box.field] : []));
  return [...new Set(keys)];
}

// One request per card, through the source's own list or detail endpoint with
// fields= (and where/orderBy/take for lists): rows and fields the viewer may see.
export function cardRequestPath(card: CardConfig, source: SourceKey, recordId: string | null, relationPath: string | null) {
  const params = new URLSearchParams({ fields: cardFields(card).join(",") });
  if (card.source.type === "record") {
    if (!recordId) return null;
    return `${fieldRegistry[source].detailPath(recordId)}?${params}`;
  }
  if (card.filters.length) params.set("where", JSON.stringify(card.filters));
  if (card.sort) params.set("orderBy", `${card.sort.field}:${card.sort.dir}`);
  params.set("take", String(card.limit));
  const base = relationPath ?? fieldRegistry[source].listPath;
  return `${base}${base.includes("?") ? "&" : "?"}${params}`;
}

export const cardsApi = {
  rows: (path: string, single: boolean) =>
    single
      ? request(rowSchema, path).then((row) => [row])
      : request(rowSchema.array(), path),
};
