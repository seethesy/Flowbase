import { describe, expect, it } from "vitest";
import { emptyLayout, layoutDocSchema, layoutProblems, MAX_BLOCKS, styleContrastOk, styleSchema } from "../../shared/layout";
import { keyboardStep, widthPresets, withWidth } from "../../src/app/live-edit/layout-sizes";
import { cleanStyle, styleClass, stylePresets, styleVars } from "../../src/app/live-edit/layout-style";
import { blockClass } from "../../src/app/live-edit/page-grid";

// FLOW-278: size controls besides drag (card boxes; page blocks use the page
// grid since FLOW-321), more appearance options, and hide on phone. Fit content
// is dropped on the page grid (FLOW-319 A4).

// A card's box: its top and height are pixels (FLOW-357).
const item = { id: "list", x: 2, y: 40, w: 6, h: 64 };

describe("keyboard move and resize (AC2)", () => {
  it("moves one column or 8px with the arrow keys and stays on the grid", () => {
    expect(keyboardStep(item, "ArrowRight", false)).toEqual({ ...item, x: 3 });
    expect(keyboardStep(item, "ArrowUp", false)).toEqual({ ...item, y: 32 });
    expect(keyboardStep({ ...item, y: 0 }, "ArrowUp", false)).toBeNull();
    expect(keyboardStep({ ...item, x: 6 }, "ArrowRight", false)).toBeNull();
    expect(keyboardStep({ ...item, x: 0 }, "ArrowLeft", false)).toBeNull();
    expect(keyboardStep(item, "Enter", false)).toBeNull();
  });

  it("resizes with Shift and the arrow keys", () => {
    expect(keyboardStep(item, "ArrowRight", true)).toEqual({ ...item, w: 7 });
    expect(keyboardStep(item, "ArrowDown", true)).toEqual({ ...item, h: 72 });
    // No box under 16px tall.
    expect(keyboardStep({ ...item, h: 16 }, "ArrowUp", true)).toBeNull();
    expect(keyboardStep({ ...item, w: 1 }, "ArrowLeft", true)).toBeNull();
    expect(keyboardStep({ ...item, x: 6, w: 6 }, "ArrowRight", true)).toBeNull();
  });
});

describe("width presets (AC2)", () => {
  it("offers quarter to full width", () => {
    expect(widthPresets.map((preset) => preset.w)).toEqual([3, 4, 6, 8, 12]);
  });
  it("keeps the column when the new width fits, else moves left", () => {
    expect(withWidth(item, 4)).toEqual({ ...item, w: 4 });
    expect(withWidth(item, 12)).toEqual({ ...item, x: 0, w: 12 });
    expect(withWidth({ ...item, x: 9 }, 6)).toEqual({ ...item, x: 6, w: 6 });
  });
});

describe("fit content and hide on phone (AC2, AC5; FLOW-319 A4)", () => {
  const block = { kind: "builtin" as const, id: "list", x: 0, y: 3, w: 6, h: 10 };
  it("hides a block on phones and no longer lets it fit its content", () => {
    expect(blockClass({ ...block, hidePhone: true })).toBe("layout-hide-phone");
    expect(blockClass({ ...block, fit: true })).toBe("");
    expect(blockClass(block)).toBe("");
  });
  it("keeps Hide on phone on every block kind and drops Fit content when a saved layout converts", () => {
    const doc = layoutDocSchema.parse({
      version: 1,
      blocks: [
        { ...block, fit: true, hidePhone: true },
        { kind: "text", id: "text-1", x: 0, y: 0, w: 12, h: 2, variant: "note", text: "Hi", hidePhone: true },
      ],
    });
    expect(doc.blocks[0]).toMatchObject({ hidePhone: true });
    expect(doc.blocks[0]).not.toHaveProperty("fit");
    expect(doc.blocks[1]).toMatchObject({ hidePhone: true });
  });
  it("holds 40 blocks for pages with many sections", () => {
    expect(MAX_BLOCKS).toBe(40);
  });
});

describe("appearance options (AC3)", () => {
  it("saves border, corners, padding, title and accent", () => {
    const style = styleSchema.parse({
      border: "#AA0000",
      radius: "large",
      padding: "roomy",
      titleHidden: true,
      titleSize: "small",
      accent: "#327459",
    });
    expect(style.border).toBe("#aa0000");
    expect(styleSchema.parse({ border: "none" }).border).toBe("none");
    expect(styleSchema.safeParse({ radius: "huge" }).success).toBe(false);
    expect(styleSchema.safeParse({ border: "red" }).success).toBe(false);
    expect(styleSchema.safeParse({ shadow: true }).success).toBe(false);
    expect(styleClass(style).split(" ")).toEqual(
      expect.arrayContaining([
        "layout-styled-border",
        "layout-radius-large",
        "layout-padding-roomy",
        "layout-title-hidden",
        "layout-title-small",
        "layout-styled-accent",
      ]),
    );
    expect(styleVars(style)).toEqual({ "--layout-border": "#aa0000", "--layout-accent": "#327459" });
    expect(styleClass({ border: "none" })).toContain("layout-border-none");
  });

  it("ships presets that pass the contrast guard and the schema", () => {
    expect(stylePresets.map((preset) => preset.name)).toEqual(["Plain", "Card", "Highlight", "Warning"]);
    for (const preset of stylePresets) {
      expect(styleSchema.safeParse(preset.style).success, preset.name).toBe(true);
      expect(styleContrastOk(preset.style), preset.name).toBe(true);
    }
  });

  it("clears to the default look when nothing is set", () => {
    expect(cleanStyle({ titleHidden: false, radius: undefined })).toBeUndefined();
    expect(cleanStyle({ radius: "small", titleHidden: false })).toEqual({ radius: "small" });
  });

  it("refuses low-contrast colors on the server", () => {
    const doc = layoutDocSchema.parse({
      ...emptyLayout(),
      blocks: [{ kind: "builtin", id: "list", x: 0, y: 0, w: 1, h: 1, style: { text: "#eeeeee", background: "#ffffff", radius: "large" } }],
    });
    expect(layoutProblems("recipes.list", doc).map((problem) => problem.path)).toContain("blocks.0.style");
  });
});
