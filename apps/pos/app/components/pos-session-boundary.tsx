"use client";

import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";
import type { AuthenticatedUser } from "@cafe/contracts";
import {
  currentSession,
  endSession,
  refreshSession,
  signIn,
  type ApiFailure,
} from "../lib/api-client";
import { unlockWaiterCallSound } from "../lib/waiter-call-sound";
import { AccountingIcon, CatalogIcon, CloseIcon, ExitIcon, InventoryIcon, OrdersIcon, SettingsIcon, SunIcon } from "./icons";
import { OrdersWorkspace } from "./orders-workspace";
import { ManagerWorkspace, type ManagerSection } from "./manager-workspace";
import { ReleaseUpdateGuard, type PosActivity } from "./release-update-guard";

import { setRecoveryUser, readRecovery, writeRecovery } from "../lib/automatic-recovery";

type Workspace = "orders" | ManagerSection;

function restoredWorkspace(role: AuthenticatedUser["role"]): Workspace {
  const saved = readRecovery<Workspace | "manager">("workspace");
  if (role !== "MANAGER") return saved === "catalog" || saved === "payments" ? saved : "orders";
  return saved === "manager" ? "settings" : saved ?? "orders";
}

type SessionState =
  | { kind: "loading" }
  | { kind: "ready"; user: AuthenticatedUser; refreshing: boolean }
  | { kind: "authentication-required" }
  | { kind: "forbidden" }
  | { kind: "failure"; error: ApiFailure };

function failureState(error: ApiFailure): SessionState {
  if (error.status === 403 || error.code === "FORBIDDEN") return { kind: "forbidden" };
  if (
    error.status === 401 ||
    error.code === "AUTHENTICATION_REQUIRED" ||
    error.code === "SESSION_EXPIRED"
  ) {
    return { kind: "authentication-required" };
  }
  return { kind: "failure", error };
}

function usePosTheme() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const applyTheme = useCallback((next: "light" | "dark") => {
    document.documentElement.setAttribute("data-theme", next);
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      "content",
      next === "dark" ? "#19130f" : "#f0e2d5",
    );
  }, []);
  useEffect(() => {
    const saved = localStorage.getItem("pos-theme") as "light" | "dark" | null;
    const initial = saved ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setTheme(initial);
    applyTheme(initial);
  }, [applyTheme]);
  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      applyTheme(next);
      localStorage.setItem("pos-theme", next);
      return next;
    });
  }, [applyTheme]);
  return { theme, toggle };
}

export function PosSessionBoundary() {
  const [session, setSession] = useState<SessionState>({ kind: "loading" });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace>("orders");
  const [ordersActivity, setOrdersActivity] = useState<PosActivity>({ isBusy: true, hasUnsavedChanges: false });
  const opener = useRef<HTMLButtonElement | null>(null);
  const { theme, toggle } = usePosTheme();

  useEffect(() => {
    const unlock = () => { void unlockWaiterCallSound(); };
    document.addEventListener("pointerdown", unlock, { capture: true });
    document.addEventListener("keydown", unlock, { capture: true });
    return () => {
      document.removeEventListener("pointerdown", unlock, true);
      document.removeEventListener("keydown", unlock, true);
    };
  }, []);

  const loadSession = useCallback(async (allowRefresh: boolean) => {
    setSession((current) =>
      current.kind === "ready" ? { ...current, refreshing: true } : { kind: "loading" },
    );
    const current = await currentSession();
    if (current.ok) {
      setRecoveryUser(current.data.id);
      setWorkspace(restoredWorkspace(current.data.role));
      setSession({ kind: "ready", user: current.data, refreshing: false });
      return;
    }
    if (
      allowRefresh &&
      (current.error.status === 401 || current.error.code === "SESSION_EXPIRED")
    ) {
      const refreshed = await refreshSession();
      if (refreshed.ok) { setRecoveryUser(refreshed.data.id); setWorkspace(restoredWorkspace(refreshed.data.role)); }
      setSession(
        refreshed.ok
          ? { kind: "ready", user: refreshed.data, refreshing: false }
          : failureState(refreshed.error),
      );
      return;
    }
    setSession(failureState(current.error));
  }, []);

  useEffect(() => {
    void loadSession(true);
  }, [loadSession]);

  if (session.kind === "loading") return <SessionLoading />;
  if (session.kind !== "ready")
    return (
      <SessionEntry
        state={session}
        onRetry={() => void loadSession(true)}
        onReady={(user) => {
          setRecoveryUser(user.id);
          setWorkspace(restoredWorkspace(user.role));
          setDrawerOpen(false);
          setSession({ kind: "ready", user, refreshing: false });
        }}
      />
    );

  const role = session.user.role === "MANAGER" ? "مدیر" : "پرسنل";
  const selectWorkspace = (next: Workspace) => {
    setWorkspace(next);
    writeRecovery("workspace", next);
    setDrawerOpen(false);
    opener.current?.focus();
  };
  return (
    <div className="pos-shell">
      <button
        className={`drawer-scrim ${drawerOpen ? "is-open" : ""}`}
        type="button"
        aria-label="بستن منو"
        tabIndex={drawerOpen ? 0 : -1}
        onClick={() => { setDrawerOpen(false); opener.current?.focus(); }}
      />
      <aside
        className={`side-drawer ${drawerOpen ? "is-open" : ""}`}
        aria-label="منوی اصلی"
        aria-hidden={!drawerOpen}
      >
        <header className="drawer-brandbar">
          <div className="drawer-brand" aria-label="سامانه فروش کافه ران">
            <img className="drawer-brand__mark" src="/pos/run-cafe-logo.webp" alt="" />
            <span className="drawer-brand__copy">
              <strong>Run Cafe</strong>
              <small>صندوق فروش</small>
            </span>
          </div>
          <button
            className="drawer-close"
            type="button"
            onClick={() => { setDrawerOpen(false); opener.current?.focus(); }}
            aria-label="بستن منو"
          >
            <CloseIcon />
          </button>
        </header>
        <div className="drawer-operator">
          <span className="drawer-operator__identity">
            <strong>{session.user.username}</strong>
            <small>حساب کاربری</small>
          </span>
          <span className="drawer-operator__role">{role}</span>
        </div>
        <nav>
          <h2>عملیات روزانه</h2>
          <button
            className={`nav-item ${workspace === "orders" ? "is-active" : ""}`}
            type="button"
            onClick={() => selectWorkspace("orders")}
          >
            <OrdersIcon />
            <span>سفارش‌گیری</span>
          </button>
          {session.user.role === "STAFF" && <>
            <h2>مدیریت روزانه</h2>
            <button className={`nav-item ${workspace === "catalog" ? "is-active" : ""}`} type="button" onClick={() => selectWorkspace("catalog")}><CatalogIcon /><span>منو و کالاها</span></button>
            <button className={`nav-item ${workspace === "payments" ? "is-active" : ""}`} type="button" onClick={() => selectWorkspace("payments")}><AccountingIcon /><span>تاریخچه‌ی پرداخت</span></button>
          </>}
          {session.user.role === "MANAGER" && <>
            <h2>مدیریت</h2>
            <button className={`nav-item ${workspace === "settings" ? "is-active" : ""}`} type="button" onClick={() => selectWorkspace("settings")}><SettingsIcon /><span>تنظیمات</span></button>
            <button className={`nav-item ${workspace === "finance" ? "is-active" : ""}`} type="button" onClick={() => selectWorkspace("finance")}><AccountingIcon /><span>حسابداری</span></button>
            <button className={`nav-item ${workspace === "catalog" ? "is-active" : ""}`} type="button" onClick={() => selectWorkspace("catalog")}><CatalogIcon /><span>منو و کالاها</span></button>
            <button className={`nav-item ${workspace === "inventory" ? "is-active" : ""}`} type="button" onClick={() => selectWorkspace("inventory")}><InventoryIcon /><span>انبار</span></button>
          </>}
        </nav>
        <footer className="side-drawer__footer">
          <button className="theme-toggle" type="button" onClick={toggle} aria-label={theme === "dark" ? "تغییر به حالت روشن" : "تغییر به حالت تاریک"}>
            <span className="theme-toggle__label"><SunIcon />{theme === "dark" ? "حالت تاریک" : "حالت روشن"}</span>
            <span className={`theme-toggle__switch ${theme === "dark" ? "is-dark" : ""}`} aria-hidden="true"><i /></span>
          </button>
          <button
            className="drawer-logout"
            type="button"
            onClick={() => {
              void endSession().then(() => {
                setWorkspace("orders");
                setDrawerOpen(false);
                setSession({ kind: "authentication-required" });
              });
            }}
          >
            <span>خروج از حساب</span><ExitIcon />
          </button>
        </footer>
      </aside>

      <main className="pos-main">
        {workspace === "orders" ? <OrdersWorkspace refreshing={session.refreshing} onActivityChange={setOrdersActivity} onOpenMenu={() => { opener.current = document.activeElement as HTMLButtonElement; setDrawerOpen(true); }} menuOpen={drawerOpen} /> : <ManagerWorkspace section={workspace} role={session.user.role} onOpenMenu={() => { opener.current = document.activeElement as HTMLButtonElement; setDrawerOpen(true); }} menuOpen={drawerOpen} />}
      </main>
      <ReleaseUpdateGuard activity={workspace === "orders" ? ordersActivity : { isBusy: true, hasUnsavedChanges: false }} />
    </div>
  );
}

function SessionLoading() {
  return (
    <div className="session-screen" aria-busy="true">
      <div className="session-card">
        <span className="loading-dot" />
        <h1>در حال آماده‌سازی صندوق</h1>
        <p>در حال بررسی نشست کاربری…</p>
      </div>
    </div>
  );
}

function SessionEntry({
  state,
  onRetry,
  onReady,
}: {
  state: Exclude<SessionState, { kind: "loading" } | { kind: "ready" }>;
  onRetry: () => void;
  onReady: (user: AuthenticatedUser) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(
    state.kind === "failure" ? state.error.message : null,
  );

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    const result = await signIn({ username, password });
    if (result.ok) onReady(result.data);
    else setMessage(result.error.message);
    setSubmitting(false);
  }

  if (state.kind === "forbidden") {
    return (
      <div className="session-screen">
        <div className="session-card">
          <h1>دسترسی مجاز نیست</h1>
          <p>ورود به صندوق فقط با حساب پرسنل یا مدیر کافه امکان‌پذیر است.</p>
          <button className="primary-button" type="button" onClick={onRetry}>
            بررسی دوباره
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="session-screen">
      <form className="session-card sign-in" onSubmit={(event) => void submit(event)}>
        <span className="brand__mark brand__mark--large" aria-hidden="true">
          R
        </span>
        <h1>ورود به سامانه فروش</h1>
        <p>برای ادامه، با حساب پرسنل یا مدیر کافه وارد شوید.</p>
        <label>
          نام کاربری
          <input
            dir="ltr"
            autoComplete="username"
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
            }}
            required
          />
        </label>
        <label>
          رمز عبور
          <input
            dir="ltr"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
            required
          />
        </label>
        {message ? (
          <div className="inline-error" role="alert">
            {message}
          </div>
        ) : null}
        <button className="primary-button" type="submit" disabled={submitting}>
          {submitting ? "در حال ورود…" : "ورود"}
        </button>
      </form>
    </div>
  );
}
