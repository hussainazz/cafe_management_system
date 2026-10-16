// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PosCatalogProduct } from "@cafe/contracts";
import { ProductPicker } from "./product-picker";

type Group = PosCatalogProduct["optionGroups"][number];
function group(id: string, count: number, minSelections = 1, maxSelections = 1): Group {
  return { id, name: id, minSelections, maxSelections, options: Array.from({ length: count }, (_, index) => ({ id: `${id}-${index}`, name: `${id} ${index}`, priceAmount: 1000 * index, isAvailable: true })) };
}
function product(id: string, groups: Group[] = []): PosCatalogProduct {
  return { id, name: id, priceAmount: 50000, pricingMode: "FIXED", saleDiscountKind: null, saleDiscountValue: null, preparationDeadlineMinutes: 10, isAvailable: true, image: null, optionGroups: groups };
}
function setup(products: PosCatalogProduct[], onAdd = vi.fn()) {
  function Harness() {
    const [expanded, setExpanded] = useState(false);
    return <div className="product-grid"><ProductPicker card={{ key: "card", name: "قهوه", products }} expanded={expanded} onOpen={() => setExpanded(true)} onClose={() => setExpanded(false)} onSelectOptions={onAdd} /></div>;
  }
  render(<Harness />);
  return onAdd;
}
beforeEach(() => vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("POS product cards", () => {
  it("defaults each coffee variant to 50/50 and double while preserving the cashier's changes", () => {
    const coffeeLine = group("لاین قهوه", 3);
    coffeeLine.options[0]!.name = "۸۰/۲۰ روبوستا";
    coffeeLine.options[1]!.name = "۵۰/۵۰";
    coffeeLine.options[2]!.name = "۱۰۰٪ عربیکا";
    const single = { ...product("single", [coffeeLine]), name: "اسپرسو سینگل" };
    const double = { ...product("double", [coffeeLine]), name: "اسپرسو دبل" };
    const add = setup([single, double]);
    expect((screen.getByRole("radio", { name: "دبل" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: "۵۰/۵۰" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("button", { name: "افزودن قهوه به سفارش" }) as HTMLButtonElement).disabled).toBe(false);
    expect(add).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "۸۰/۲۰" }));
    fireEvent.click(screen.getByRole("radio", { name: "سینگل" }));
    expect((screen.getByRole("radio", { name: "۵۰/۵۰" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "دبل" }));
    expect((screen.getByRole("radio", { name: "۸۰/۲۰" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "افزودن قهوه به سفارش" }));
    expect(add).toHaveBeenCalledWith(double, [coffeeLine.options[0]], undefined);
  });

  it("adds an optionless product directly with an icon action and no empty groups", () => {
    const item = product("ترک");
    const add = setup([item]);
    const button = screen.getByRole("button", { name: "افزودن قهوه به سفارش" });
    expect(button.textContent).toBe("+");
    expect(screen.queryByRole("group")).toBeNull();
    fireEvent.click(button);
    expect(add).toHaveBeenCalledWith(item, [], undefined);
  });
  it("keeps inline choices visible, requires selections, and retains distinct repeated configurations", () => {
    const item = product("قهوه", [group("لاین", 3), group("شیر", 2, 0)]);
    const add = setup([item]);
    const button = screen.getByRole("button", { name: "افزودن قهوه به سفارش" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getAllByRole("radio")).toHaveLength(6);
    fireEvent.click(screen.getByRole("radio", { name: "لاین 1" }));
    fireEvent.click(button); fireEvent.click(button);
    expect(add).toHaveBeenNthCalledWith(1, item, [item.optionGroups[0]!.options[1]], undefined);
    expect(add).toHaveBeenNthCalledWith(2, item, [item.optionGroups[0]!.options[1]], undefined);
    fireEvent.click(screen.getByRole("radio", { name: "لاین 2" }));
    fireEvent.click(screen.getByRole("radio", { name: "شیر 0" }));
    fireEvent.click(button);
    expect(add).toHaveBeenLastCalledWith(item, [item.optionGroups[0]!.options[2], item.optionGroups[1]!.options[0]], undefined);
    expect((screen.getByRole("radio", { name: "لاین 2" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("preserves per-variant selections without adding when a variant changes", () => {
    const first = { ...product("single", [group("لاین", 2)]), name: "قهوه سینگل" };
    const second = { ...product("double", [group("لاین", 2)]), name: "قهوه دبل" };
    const add = setup([first, second]);
    fireEvent.click(screen.getByRole("radio", { name: "لاین 1" }));
    fireEvent.click(screen.getByRole("radio", { name: "سینگل" }));
    expect(add).not.toHaveBeenCalled();
    expect((screen.getByRole("radio", { name: "لاین 1" }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole("radio", { name: "دبل" }));
    expect((screen.getByRole("radio", { name: "لاین 1" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "افزودن قهوه به سفارش" }));
    expect(add).toHaveBeenCalledWith(second, [second.optionGroups[0]!.options[1]], undefined);
  });
  it("portals complex groups, searches without losing selections, and enforces multi-choice limits", () => {
    const item = product("لاته", [group("لاین", 3), group("شربت", 10, 1, 2), group("مقدار شربت", 2)]);
    const add = setup([item]);
    fireEvent.click(screen.getByRole("radio", { name: "لاین 0" }));
    fireEvent.click(screen.getByRole("radio", { name: "مقدار شربت 1" }));
    fireEvent.click(screen.getByRole("button", { name: "انتخاب گزینه‌های قهوه" }));
    const dialog = screen.getByRole("dialog");
    expect(document.querySelector(".product-grid")?.contains(dialog)).toBe(false);
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "شربت 1" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "شربت 2" }));
    expect((within(dialog).getByRole("checkbox", { name: "شربت 3" }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole("searchbox"), { target: { value: "شربت 9" } });
    fireEvent.change(within(dialog).getByRole("searchbox"), { target: { value: "" } });
    expect((within(dialog).getByRole("checkbox", { name: "شربت 1" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "افزودن قهوه به سفارش" }));
    expect(add).toHaveBeenCalledWith(item, [item.optionGroups[0]!.options[0], item.optionGroups[1]!.options[1], item.optionGroups[1]!.options[2], item.optionGroups[2]!.options[1]], undefined);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "انتخاب گزینه‌های قهوه" }));
    expect((screen.getByRole("checkbox", { name: "شربت 1" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "انتخاب گزینه‌های قهوه" }));
    fireEvent.click(screen.getByRole("button", { name: "بستن گزینه‌ها" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("accepts Persian weight digits and prevents adding a zero weight", () => {
    const item = { ...product("وزنی"), pricingMode: "WEIGHTED_PER_KG" as const };
    const add = setup([item]);
    fireEvent.click(screen.getByRole("button", { name: "انتخاب گزینه‌های قهوه" }));
    const action = within(screen.getByRole("dialog")).getByRole("button", { name: "افزودن قهوه به سفارش" }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("وزن"), { target: { value: "۲۵۰" } });
    fireEvent.click(action);
    expect(add).toHaveBeenCalledWith(item, [], 250);
  });
  it("prevents addition when required options are unavailable", () => {
    const unavailable = group("ناموجود", 1);
    unavailable.options[0]!.isAvailable = false;
    const add = setup([product("قهوه", [unavailable])]);
    expect((screen.getByRole("button", { name: "افزودن قهوه به سفارش" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "انتخاب گزینه‌های قهوه" }));
    expect(screen.getByText("گزینه‌ای در دسترس نیست")).toBeTruthy();
    expect(add).not.toHaveBeenCalled();
  });

});
