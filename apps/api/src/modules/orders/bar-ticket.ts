// Preparation identity excludes prices, payments and order versions.
export type PreparationItem = {
  id: string; productName: string; quantity: number;
  pricingModeSnapshot: "FIXED" | "WEIGHTED_PER_KG"; weightGrams: number | null;
  options: Array<{ optionId?: string; name: string; quantity: number }>; note: string | null;
};
function optionKey(option: PreparationItem["options"][number]): string { return option.optionId ?? option.name; }
function content(item: PreparationItem): string {
  return JSON.stringify({ id: item.id, productName: item.productName, pricingModeSnapshot: item.pricingModeSnapshot,
    weightGrams: item.weightGrams, options: [...item.options].sort((a, b) => optionKey(a).localeCompare(optionKey(b))).map((option) => ({
      id: optionKey(option), name: option.name, quantity: item.pricingModeSnapshot === "FIXED" ? option.quantity / item.quantity : option.quantity,
    })), note: item.note });
}
export function preparationItems(current: PreparationItem[], baseline: PreparationItem[] | null): PreparationItem[] {
  if (!baseline) return current;
  const before = new Map(baseline.map((item) => [content(item), item]));
  const unchanged = current.length === baseline.length && current.every((item) => before.get(content(item))?.quantity === item.quantity);
  if (unchanged) return current;
  return current.flatMap((item) => {
    const previous = before.get(content(item));
    const quantity = item.quantity - (previous?.quantity ?? 0);
    if (quantity <= 0) return [];
    const options = previous && item.pricingModeSnapshot === "FIXED" ? item.options.map((option) => ({ ...option,
      quantity: option.quantity - (previous.options.find((old) => optionKey(old) === optionKey(option))?.quantity ?? 0),
    })).filter((option) => option.quantity > 0) : item.options;
    return [{ ...item, quantity, options }];
  });
}
