import { z } from "zod";

// Global search (FLOW-46): one search box over every record type the caller may
// see. Recipes and vendors join this list when their tables exist.
export const searchResultTypes = [
  "client",
  "lead",
  "event",
  "venue",
  "item",
] as const;
export type SearchResultType = (typeof searchResultTypes)[number];
export const searchResultTypeLabels: Record<SearchResultType, string> = {
  client: "Client",
  lead: "Lead",
  event: "Event",
  venue: "Venue",
  item: "Inventory item",
};

// Shorter queries match too much to be useful.
export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 100;

export const searchResultSchema = z.object({
  type: z.enum(searchResultTypes),
  id: z.string().uuid(),
  title: z.string(),
  subtitle: z.string(),
  // The app route that opens the record.
  path: z.string(),
  score: z.number(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchResultPath = (type: SearchResultType, id: string) =>
  `/${{ client: "clients", lead: "leads", event: "events", venue: "venues", item: "inventory" }[type]}/${id}`;
