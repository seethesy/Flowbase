import { z } from "zod";
import { text, timestamp } from "./schema-primitives";

// Shared notes on a working area's page (FLOW-341 A2): Marketing › Overview,
// Socials, Movies, Other Events and SEO each have one Notes card that everyone
// who sees the tab may type in (marketing.read), not only the Admin in live
// edit. One text per area; the last save wins, and the card says who saved it.

export const areaNoteKeys = [
  "marketing.overview",
  "marketing.socials",
  "marketing.movies",
  "marketing.other-events",
  "marketing.seo",
] as const;
export const areaNoteKeySchema = z.enum(areaNoteKeys);
export type AreaNoteKey = z.infer<typeof areaNoteKeySchema>;

export const areaNoteSchema = z.object({
  key: areaNoteKeySchema,
  body: z.string(),
  // Null until someone saves.
  updatedAt: timestamp.nullable(),
  updatedByName: z.string().nullable(),
});
export type AreaNote = z.infer<typeof areaNoteSchema>;

export const areaNoteInputSchema = z.object({ body: text(20000) }).strict();
export type AreaNoteInput = z.infer<typeof areaNoteInputSchema>;
