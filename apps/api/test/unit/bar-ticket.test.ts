import { describe, expect, it } from "vitest";
import { preparationItems, type PreparationItem } from "../../src/modules/orders/bar-ticket.js";
const item: PreparationItem = { id: "a", productName: "Coffee", quantity: 2, pricingModeSnapshot: "FIXED", weightGrams: null, options: [], note: null };
describe("preparation snapshot delta", () => {
  it("prints full first and unchanged tickets", () => {
    expect(preparationItems([item], null)).toEqual([item]);
    expect(preparationItems([item], [item])).toEqual([item]);
  });
  it("prints only additions and positive quantity differences", () => {
    expect(preparationItems([{ ...item, quantity: 3 }, { ...item, id: "b" }], [item])).toEqual([{ ...item, quantity: 1 }, { ...item, id: "b" }]);
    expect(preparationItems([{ ...item, quantity: 1 }], [item])).toEqual([]);
    expect(preparationItems([], [item])).toEqual([]);
  });
  it("notes, options and weight changes require full preparation quantity", () => {
    for (const changed of [{ ...item, note: "hot" }, { ...item, weightGrams: 100 }, { ...item, options: [{ name: "Milk", quantity: 1 }] }]) {
      expect(preparationItems([changed], [item])).toEqual([changed]);
    }
  });
  it("ignores option ordering", () => {
    const options = [{ name: "Milk", quantity: 1 }, { name: "Sugar", quantity: 2 }];
    expect(preparationItems([{ ...item, options }], [{ ...item, options: [...options].reverse() }])).toEqual([{ ...item, options }]);
  });
});
