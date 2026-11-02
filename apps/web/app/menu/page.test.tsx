import { expect, it, vi } from "vitest";
vi.mock("next/headers", () => ({ headers: async () => new Headers({ cookie: "table=qr" }) }));
vi.mock("../../lib/public-menu-api", () => ({ getPublicMenu: vi.fn() }));
vi.mock("../../lib/public-table-context", () => ({ getPublicTableContext: vi.fn() }));
import MenuPage from "./page";
import { getPublicMenu } from "../../lib/public-menu-api";
import { getPublicTableContext } from "../../lib/public-table-context";
it("returns the QR phone form without waiting for the catalog request", async () => {
  vi.mocked(getPublicTableContext).mockResolvedValue({ active: true, tableName: "1", occupancyState: "AVAILABLE",
    waiterCallStatus: null, canCallWaiter: false, authenticationRequired: true });
  vi.mocked(getPublicMenu).mockImplementation(() => new Promise(() => {}));
  const page = await MenuPage({ searchParams: Promise.resolve({}) });
  expect(getPublicMenu).not.toHaveBeenCalled();
  expect(page.props.initialMenu).toBeNull();
  expect(page.props.initialRequestFailed).toBe(false);
  expect(page.props.initialTableContext.authenticationRequired).toBe(true);
});
