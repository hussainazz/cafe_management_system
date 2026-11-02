// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { MenuExperience } from "./menu-experience";
import type { PublicMenu } from "../lib/menu-types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("keeps the phone form usable while menu data and category images download in the background", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let finishMenu!: (value: unknown) => void;
  let finishImage!: (value: unknown) => void;
  const fetcher = vi.fn((url: string) => {
    if (url === "/api/public-menu") return new Promise(resolve => { finishMenu = resolve; });
    if (url.includes("product-images")) return new Promise(resolve => { finishImage = resolve; });
    return new Promise(() => {});
  });
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:photo"), revokeObjectURL: vi.fn() }));
  const menu: PublicMenu = { categories: [{ id: "a", name: "Coffee", nameEn: null, products: [{
    id: "a1", name: "Coffee", nameEn: null, menuNote: null, basePriceAmount: 1, finalPriceAmount: 1,
    saleDiscount: null, isAvailable: true, optionGroups: [],
    image: { storageKey: "123e4567-e89b-12d3-a456-426614174000.webp", altText: "Coffee" },
  }] }] };
  try {
    await act(async () => root.render(createElement(MenuExperience, {
      initialMenu: null, initialRequestFailed: false, invalidTableContext: false,
      initialTableContext: { active: true, tableName: "1", occupancyState: "AVAILABLE",
        waiterCallStatus: null, canCallWaiter: false, authenticationRequired: true },
    })));
    expect(container.querySelector('input[type="tel"]')).not.toBeNull();
    expect(container.querySelector(".loading-shell")).toBeNull();
    expect(fetcher.mock.calls.some(([url]) => url.includes("product-images"))).toBe(false);
    await act(async () => finishMenu({ ok: true, json: async () => ({ data: menu }) }));
    expect(fetcher.mock.calls.some(([url]) => url.includes("product-images"))).toBe(true);
    expect(container.querySelector('input[type="tel"]')?.hasAttribute("disabled")).toBe(false);
    await act(async () => finishImage({ ok: true, blob: async () => new Blob(["image"]) }));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(container.querySelector('input[type="tel"]')).not.toBeNull();
    expect(container.querySelector(".auth-submit")).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
