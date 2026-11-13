import { randomUUID } from "node:crypto";
import { test, expect } from "./auth-fixture";
import { chairs, consumable, defaultSections, fallGala, juniper } from "./fixtures";
import { seedInventory, seedRecords } from "./database";
import type { InventoryItem } from "../../shared/inventory";

// Decor kits on the event hub (FLOW-212): holding a kit holds its parts, a short
// part is named in the conflict, and the kit's candles become a consumable need.
const rental = (
  name: string,
  subtype: string,
  onHand: number,
  components: { itemId: string; quantity: number }[] = [],
): InventoryItem => ({
  ...chairs(),
  id: randomUUID(),
  code: "",
  name,
  subtype,
  category: "",
  color: "",
  ratio: null,
  rental: { ...chairs().rental!, components },
  stock: onHand
    ? [{ sectionId: defaultSections[0].id, sectionName: "Warehouse", quantity: onHand }]
    : [],
  totalQuantity: onHand,
});

test("holds a decor kit and names the short part in its conflict", async ({ page }) => {
  const hurricane = rental("Glass hurricane", "glassware", 6);
  const candle = consumable("Taper candle", { subtype: "supply", onHand: 50 });
  const kit = rental("Centerpiece Candle Set", "decor", 0, [
    { itemId: hurricane.id, quantity: 1 },
    { itemId: candle.id, quantity: 1 },
  ]);
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  await seedInventory({ items: [hurricane, candle, kit] });
  await page.goto(`/#/events/${fallGala().id}`);
  // The planning sections load when they scroll into view.
  await page.getByRole("heading", { name: "Equipment & stock" }).scrollIntoViewIfNeeded();
  const form = page.getByRole("form", { name: "Hold equipment" });
  await form.scrollIntoViewIfNeeded();
  await form.getByLabel("Item").selectOption({ label: "Centerpiece Candle Set" });
  await form.getByLabel("Quantity").fill("10");
  await form.getByRole("button", { name: "Hold equipment" }).click();

  // 10 sets need 10 hurricanes and only 6 are owned.
  const card = page.getByRole("group", { name: "Glass hurricane conflict" });
  await expect(card).toContainText("Glass hurricane (in Centerpiece Candle Set) is 4 short (6 of 10");
  // A part follows its kit: the risk can be accepted here, the quantity changes on the kit.
  await expect(card.getByLabel("Resolution").locator("option")).toHaveText(["Accepted the risk"]);
  await expect(page.getByText("Conflict: 4 short", { exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole("heading", { name: "Equipment & stock" }).scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("listitem").filter({ hasText: "Taper candle" }).filter({ hasText: "kit" }),
  ).toBeVisible();
});
