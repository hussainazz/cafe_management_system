import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicMenuResult } from "../src/lib/server/public-menu.js";

const getPublicMenu = vi.hoisted(() => vi.fn());

vi.mock("../src/lib/server/public-menu.js", () => ({ getPublicMenu }));

import { load } from "../src/routes/menu/+page.server.js";

describe("menu page server loader", () => {
  beforeEach(() => {
    getPublicMenu.mockReset();
  });

  it("returns validated API menu data for server rendering", async () => {
    const result: PublicMenuResult = {
      ok: true,
      categories: [],
      requestId: "request-test",
    };
    getPublicMenu.mockResolvedValue(result);

    await expect(load({} as Parameters<typeof load>[0])).resolves.toEqual({ result });
    expect(getPublicMenu).toHaveBeenCalledOnce();
  });

  it("returns the controlled failure result for the page error state", async () => {
    const result: PublicMenuResult = { ok: false, reason: "unavailable" };
    getPublicMenu.mockResolvedValue(result);

    await expect(load({} as Parameters<typeof load>[0])).resolves.toEqual({ result });
  });
});
