import { describe, expect, it } from "vitest";
import { ProductCostingConfigurationInputSchema } from "./index.js";

const recipeId = "11111111-1111-4111-8111-111111111111";
const stockItemId = "22222222-2222-4222-8222-222222222222";
const base = {
  mode: "RECIPE" as const,
  recipeId,
  recipeQuantity: "1",
  optionRules: [],
  combinations: [],
};

describe("product served-alongside costing", () => {
  it("accepts optional stock and reusable-recipe rows and an explicit empty list", () => {
    expect(ProductCostingConfigurationInputSchema.safeParse({
      ...base,
      servedAlongside: [
        { sourceKind: "STOCK_ITEM", stockItemId, quantity: "1" },
        { sourceKind: "RECIPE", recipeId, quantity: "0.5" },
      ],
    }).success).toBe(true);
    expect(ProductCostingConfigurationInputSchema.safeParse({ ...base, servedAlongside: [] }).success).toBe(true);
    expect(ProductCostingConfigurationInputSchema.safeParse({
      mode: "PURCHASED_ITEM",
      purchasedStockItemId: stockItemId,
      optionRules: [],
      combinations: [],
      servedAlongside: [{ sourceKind: "STOCK_ITEM", stockItemId, quantity: "2" }],
    }).success).toBe(true);
  });

  it("rejects missing or mixed references and nonpositive quantities", () => {
    for (const entry of [
      { sourceKind: "STOCK_ITEM", quantity: "1" },
      { sourceKind: "RECIPE", recipeId, stockItemId, quantity: "1" },
      { sourceKind: "STOCK_ITEM", stockItemId, quantity: "0" },
    ]) {
      expect(ProductCostingConfigurationInputSchema.safeParse({ ...base, servedAlongside: [entry] }).success).toBe(false);
    }
  });
});
