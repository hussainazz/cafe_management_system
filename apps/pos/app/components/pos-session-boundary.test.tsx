// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PosSessionBoundary } from "./pos-session-boundary";
import { setRecoveryUser, writeRecovery } from "../lib/automatic-recovery";
const api = vi.hoisted(() => ({ currentSession: vi.fn(), endSession: vi.fn(), signIn: vi.fn(), refreshSession: vi.fn() }));
const manager = vi.hoisted(() => vi.fn());
vi.mock("../lib/api-client", () => api);
vi.mock("../lib/waiter-call-sound", () => ({ unlockWaiterCallSound: vi.fn() }));
vi.mock("./release-update-guard", () => ({ ReleaseUpdateGuard: () => null }));
vi.mock("./orders-workspace", () => ({ OrdersWorkspace: ({ onOpenMenu }: { onOpenMenu: () => void }) => <div>orders workspace<button onClick={onOpenMenu}>open menu</button></div> }));
vi.mock("./manager-workspace", () => ({ ManagerWorkspace: ({ onOpenMenu, section, role }: { onOpenMenu: () => void; section: string; role: string }) => { manager({ section, role }); return <div>manager workspace<button onClick={onOpenMenu}>open menu</button></div>; } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it.each(["catalog", "payments", "settings", "finance", "inventory", "manager"])("restores only Staff-authorized workspace %s and keeps Manager navigation hidden", async (saved) => {
  const id = `staff-restore-${saved}`;
  sessionStorage.clear(); localStorage.setItem("pos-theme", "light"); setRecoveryUser(id); writeRecovery("workspace", saved);
  api.currentSession.mockResolvedValue({ ok: true, data: { id, username: "staff", role: "STAFF" } });
  render(<PosSessionBoundary />);
  if (saved === "catalog" || saved === "payments") {
    await screen.findByText("manager workspace");
    expect(manager).toHaveBeenLastCalledWith({ section: saved, role: "STAFF" });
  } else {
    await screen.findByText("orders workspace");
    expect(manager).not.toHaveBeenCalled();
  }
  fireEvent.click(screen.getByRole("button", { name: "open menu" }));
  expect(screen.getByRole("button", { name: "منو و کالاها" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "تاریخچه‌ی پرداخت" })).toBeTruthy();
  for (const name of ["تنظیمات", "حسابداری", "انبار"]) expect(screen.queryByRole("button", { name })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "تاریخچه‌ی پرداخت" }));
  await waitFor(() => expect(manager).toHaveBeenLastCalledWith({ section: "payments", role: "STAFF" }));
});
it("never mounts Manager workspace after Manager logout and Staff login, even with stored Manager preference", async () => {
  sessionStorage.clear(); localStorage.setItem("pos-theme", "light");
  setRecoveryUser("staff-role-transition"); writeRecovery("workspace", "manager");
  api.currentSession.mockResolvedValue({ ok: true, data: { id: "manager-role-transition", username: "manager", role: "MANAGER" } });
  api.endSession.mockResolvedValue({ ok: true });
  api.signIn.mockResolvedValue({ ok: true, data: { id: "staff-role-transition", username: "staff", role: "STAFF" } });
  render(<PosSessionBoundary />);
  await screen.findByText("orders workspace");
  fireEvent.click(screen.getByRole("button", { name: "open menu" }));
  fireEvent.click(screen.getByRole("button", { name: "تنظیمات" }));
  await screen.findByText("manager workspace");
  fireEvent.click(screen.getByRole("button", { name: "open menu" }));
  fireEvent.click(screen.getByRole("button", { name: "خروج از حساب" }));
  await screen.findByText("ورود به سامانه فروش");
  manager.mockClear();
  fireEvent.change(screen.getByLabelText("نام کاربری"), { target: { value: "staff" } });
  fireEvent.change(screen.getByLabelText("رمز عبور"), { target: { value: "test-password" } });
  fireEvent.click(screen.getByRole("button", { name: "ورود" }));
  await screen.findByText("orders workspace");
  await waitFor(() => expect(screen.getByText("پرسنل")).toBeTruthy());
  expect(manager).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "تنظیمات" })).toBeNull();
});
