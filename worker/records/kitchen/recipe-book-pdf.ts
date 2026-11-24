import { and, desc, eq, isNull } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Actor } from "../../../shared/access";
import type { ClientRecipe, ClientRecipeBookInput } from "../../../shared/recipes";
import type { Bindings } from "../../bindings";
import type { Db } from "../../db/client";
import { attachments } from "../../db/schema";
import { ApiError, forbidden } from "../../hono";
import { can } from "../../policy";
import { getDocument } from "../documents/documents";
import { listClientRecipes } from "./recipes";

// The client recipe book as a stored PDF (FLOW-301): the same dishes and fields
// as the print view (/print/recipes/client), saved as a Document of type Menu in
// the "recipe_book" group so the Kitchen › Menus tab lists it under Recipe books,
// with Open PDF and In Documents. Generating the same book again (all dishes, one
// category, or a selection) adds a version to that book's document.
export const RECIPE_BOOK_GROUP = "recipe_book";

export async function renderClientRecipeBookPdf(title: string, dishes: ClientRecipe[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const width = 612;
  const height = 792;
  const margin = 54;
  let page = pdf.addPage([width, height]);
  let y = height - margin;
  // The standard fonts only encode Latin-1; accents are folded, anything else dropped.
  const printable = (value: unknown) => String(value ?? "").normalize("NFKD")
    .replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "-");
  const line = (value: unknown, size = 10, heading = false) => {
    const font = heading ? bold : regular;
    const text = printable(value);
    if (!text.trim()) return;
    let current = "";
    const emit = (part: string) => {
      if (y < margin + size + 4) { page = pdf.addPage([width, height]); y = height - margin; }
      page.drawText(part, { x: margin, y, size, font, color: rgb(0.14, 0.19, 0.15) });
      y -= size + 5;
    };
    for (const word of text.split(/\s+/)) {
      const next = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width - margin * 2 && current) {
        emit(current);
        current = word;
      } else current = next;
    }
    if (current) emit(current);
  };
  line(title, 20, true);
  y -= 8;
  if (!dishes.length) line("No dishes selected.");
  for (const dish of dishes) {
    y -= 10;
    line(dish.name, 14, true);
    line(dish.description);
    line(`Ingredients: ${dish.ingredients.join(", ") || "-"}`);
    line(`Allergens: ${dish.allergens.join(", ") || "None listed"}`);
    line(`Dietary tags: ${dish.dietaryTags.join(", ") || "None listed"}`);
  }
  return pdf.save();
}

// The book's name: one document per book, so regenerating it adds a version.
export function recipeBookName(input: ClientRecipeBookInput) {
  if (input.ids?.length) return "Client recipe book - selected dishes";
  return input.category ? `Client recipe book - ${input.category}` : "Client recipe book";
}

export async function saveClientRecipeBook(db: Db, actor: Actor, env: Partial<Bindings>, input: ClientRecipeBookInput) {
  if (!can(actor, "attachments.write")) throw forbidden();
  if (!env.FILES?.put) throw new ApiError(503, "STORAGE_NOT_CONFIGURED", "File storage is not configured.");
  const all = await listClientRecipes(db, actor, env, { archived: false, category: input.category });
  const ids = input.ids?.length ? new Set(input.ids) : null;
  const dishes = all.filter((dish) => !ids || ids.has(dish.id));
  if (!dishes.length) throw new ApiError(400, "INVALID_REQUEST", "Choose at least one dish for the recipe book.");
  const name = recipeBookName(input);
  const bytes = await renderClientRecipeBookPdf(name, dishes);
  const [existing] = await db.select({ documentId: attachments.documentId, versionNumber: attachments.versionNumber })
    .from(attachments)
    .where(and(eq(attachments.recordType, "document"), eq(attachments.group, RECIPE_BOOK_GROUP),
      eq(attachments.displayName, name), eq(attachments.status, "ready"), isNull(attachments.archivedAt)))
    .orderBy(desc(attachments.versionNumber)).limit(1);
  const documentId = existing?.documentId ?? crypto.randomUUID();
  const id = crypto.randomUUID();
  const key = `documents/${documentId}/${id}/original.pdf`;
  await env.FILES.put(key, Uint8Array.from(bytes).buffer, { httpMetadata: { contentType: "application/pdf" } });
  await db.insert(attachments).values({
    id, documentId, recordType: "document", recordId: documentId, group: RECIPE_BOOK_GROUP,
    fileName: `${name.replace(/[^A-Za-z0-9 -]/g, "").replace(/\s+/g, "-")}.pdf`, displayName: name,
    docType: "menu", versionNumber: (existing?.versionNumber ?? 0) + 1, status: "ready",
    variants: [{ name: "original", key, contentType: "application/pdf", size: bytes.length }],
    createdBy: actor.userId, updatedBy: actor.userId,
  });
  return getDocument(db, actor, env, documentId);
}
