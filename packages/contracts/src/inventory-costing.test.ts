import { describe, expect, it } from "vitest";
import { CreateStockItemRequestSchema, ProductCostingConfigurationInputSchema, UpdateStockItemRequestSchema } from "./index.js";

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
        { sourceKind: "STOCK_ITEM", stockItemId, quantity: "1", previousEstimatedCost: { name: "کوکی آماده", estimatedCostAmount: 250 } },
        { sourceKind: "RECIPE", recipeId, quantity: "0.5" },
        { sourceKind: "ESTIMATED_COST", name: "کوکی ویژه", estimatedCostAmount: 0, previousSource: { sourceKind: "RECIPE", recipeId, quantity: "1" } },
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

  it("accepts an explicit zero estimate without a recipe and rejects an unset estimate", () => {
    expect(ProductCostingConfigurationInputSchema.safeParse({
      mode: "RECIPE",
      useEstimatedCost: true,
      estimatedCostAmount: 0,
      optionRules: [],
      combinations: [],
    }).success).toBe(true);
    expect(ProductCostingConfigurationInputSchema.safeParse({
      mode: "RECIPE",
      useEstimatedCost: true,
      optionRules: [],
      combinations: [],
    }).success).toBe(false);
    expect(ProductCostingConfigurationInputSchema.safeParse({ ...base, useEstimatedCost: false }).success).toBe(true);
    expect(ProductCostingConfigurationInputSchema.safeParse({
      mode: "RECIPE", useEstimatedCost: true, estimatedCostAmount: 1_000,
      recipeQuantity: "1", optionRules: [], combinations: [],
    }).success).toBe(false);
    expect(ProductCostingConfigurationInputSchema.safeParse({
      mode: "PURCHASED_ITEM", useEstimatedCost: true, estimatedCostAmount: 1_000,
      purchasedQuantity: "1", optionRules: [], combinations: [],
    }).success).toBe(false);
  });

  it("rejects an estimated add-on with no name or a non-integer Toman amount", () => {
    for (const entry of [
      { sourceKind: "ESTIMATED_COST", name: " ", estimatedCostAmount: 0 },
      { sourceKind: "ESTIMATED_COST", name: "Cookie", estimatedCostAmount: 1.5 },
    ]) {
      expect(ProductCostingConfigurationInputSchema.safeParse({ ...base, servedAlongside: [entry] }).success).toBe(false);
    }
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

describe("stock-item reference purchase and opening input", () => {
  it("preserves legacy single-field opening defaults while rejecting mixed opening methods", () => {
    const baseStock = { name: "Beans", category: "Ingredients", baseUnit: "GRAM", conversions: [] };
    expect(CreateStockItemRequestSchema.safeParse({ ...baseStock, openingQuantity: "5" }).success).toBe(true);
    expect(CreateStockItemRequestSchema.safeParse({ ...baseStock, openingValueAmount: 500 }).success).toBe(true);
    expect(CreateStockItemRequestSchema.safeParse({
      ...baseStock, openingStock: { method: "TOTAL_QUANTITY", totalQuantity: "0" }, openingValueAmount: 0,
    }).success).toBe(false);
  });

  it("keeps omitted packaging classification absent on reference-only stock-item patches", () => {
    const parsed = UpdateStockItemRequestSchema.safeParse({
      expectedVersion: 1,
      referencePurchase: { conversionLabel: "GRAM", packageQuantity: "1", priceAmount: 100 },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.isPackagingMaterial).toBeUndefined();
  });

  it("rejects opening fields that belong to the other discriminated method", () => {
    expect(CreateStockItemRequestSchema.safeParse({
      name: "Beans", category: "Ingredients", baseUnit: "GRAM", conversions: [],
      openingStock: { method: "TOTAL_QUANTITY", totalQuantity: "0", packageCount: 0 },
    }).success).toBe(false);
  });
});
