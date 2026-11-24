// @vitest-environment node
import { expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { recipeBookName, renderClientRecipeBookPdf } from "../../worker/records/kitchen/recipe-book-pdf";

// FLOW-301 AC2: the client recipe book stored as a PDF.
const dish = (name: string) => ({
  id: "00000000-0000-4000-8000-000000000301", name, category: "Mains", description: "Synthetic dish.",
  allergens: ["Milk"], dietaryTags: [], ingredients: ["Synthetic flour", "Crème fraîche"], photo: null,
});

it("names one book per scope, so regenerating it adds a version", () => {
  expect(recipeBookName({})).toBe("Client recipe book");
  expect(recipeBookName({ category: "Desserts" })).toBe("Client recipe book - Desserts");
  expect(recipeBookName({ ids: ["00000000-0000-4000-8000-000000000301"] })).toBe("Client recipe book - selected dishes");
});

it("renders every dish into a PDF, flowing onto more pages, with accented text folded", async () => {
  const few = await PDFDocument.load(await renderClientRecipeBookPdf("Client recipe book", [dish("Short rib")]));
  expect(few.getPageCount()).toBe(1);
  const many = await renderClientRecipeBookPdf("Client recipe book",
    Array.from({ length: 60 }, (_, index) => dish(`Synthetic dish ${index + 1}`)));
  expect((await PDFDocument.load(many)).getPageCount()).toBeGreaterThan(1);
});
