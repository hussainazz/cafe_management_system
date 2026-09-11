import { describe, expect, it } from "vitest";
import { printRoute } from "./print-routes";

describe("printRoute", () => {
  it("builds dedicated bar-ticket, whole-order, and settlement print routes", () => {
    expect(printRoute("order/id", "bar-ticket")).toBe("/pos/print/order%2Fid/bar-ticket");
    expect(printRoute("order", "receipt")).toBe("/pos/print/order/receipt");
    expect(printRoute("order", "settlement", "settlement/id")).toBe("/pos/print/order/settlements/settlement%2Fid/receipt");
  });

  it("rejects a settlement route without a settlement ID", () => {
    expect(() => printRoute("order", "settlement")).toThrow("settlement ID");
  });
});
