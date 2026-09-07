"use client";

import { useCallback, useEffect, useState, type SyntheticEvent } from "react";
import type { AuthenticatedUser } from "@cafe/contracts";
import {
  currentSession,
  endSession,
  refreshSession,
  signIn,
  type ApiFailure,
} from "../lib/api-client";
import { MenuIcon, OrdersIcon } from "./icons";
import { OrdersWorkspace } from "./orders-workspace";

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

export function PosSessionBoundary() {
  const [session, setSession] = useState<SessionState>({ kind: "loading" });
  const [drawerOpen, setDrawerOpen] = useState(false);

  const loadSession = useCallback(async (allowRefresh: boolean) => {
    setSession((current) =>
      current.kind === "ready" ? { ...current, refreshing: true } : { kind: "loading" },
    );
    const current = await currentSession();
    if (current.ok) {
      setSession({ kind: "ready", user: current.data, refreshing: false });
      return;
    }
    if (
      allowRefresh &&
      (current.error.status === 401 || current.error.code === "SESSION_EXPIRED")
    ) {
      const refreshed = await refreshSession();
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
          setSession({ kind: "ready", user, refreshing: false });
        }}
      />
    );

  const role = session.user.role === "MANAGER" ? "مدیر" : "پرسنل";
  return (
    <div className="pos-shell">
      <header className="topbar">
        <button
          className="menu-button"
          type="button"
          aria-label="باز کردن منو"
          aria-expanded={drawerOpen}
          onClick={() => {
            setDrawerOpen(true);
          }}
        >
          <MenuIcon />
        </button>
      </header>

      <button
        className={`drawer-scrim ${drawerOpen ? "is-open" : ""}`}
        type="button"
        aria-label="بستن منو"
        tabIndex={drawerOpen ? 0 : -1}
        onClick={() => {
          setDrawerOpen(false);
        }}
      />
      <aside
        className={`side-drawer ${drawerOpen ? "is-open" : ""}`}
        aria-label="منوی اصلی"
        aria-hidden={!drawerOpen}
      >
        <div className="side-drawer__heading">
          <div className="brand" aria-label="سامانه فروش کافه ران">
            <span className="brand__mark" aria-hidden="true">
              R
            </span>
            <span>
              <strong>Run Cafe</strong>
              <small>سامانه فروش</small>
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setDrawerOpen(false);
            }}
            aria-label="بستن منو"
          >
            ×
          </button>
        </div>
        <div className="drawer-operator">
          <span className="operator">
            <strong>{session.user.username}</strong>
            <small>{role}</small>
          </span>
          <button
            className="text-button"
            type="button"
            onClick={() => {
              void endSession().then(() => {
                setSession({ kind: "authentication-required" });
              });
            }}
          >
            خروج
          </button>
        </div>
        <nav>
          <button
            className="nav-item is-active"
            type="button"
            onClick={() => {
              setDrawerOpen(false);
            }}
          >
            <OrdersIcon />
            <span>سفارش</span>
          </button>
        </nav>
      </aside>

      <main className="pos-main">
        <OrdersWorkspace refreshing={session.refreshing} />
      </main>
    </div>
  );
}

function SessionLoading() {
  return (
    <div className="session-screen" aria-busy="true">
      <div className="session-card">
        <span className="loading-dot" />
        <h1>در حال آماده‌سازی صندوق</h1>
        <p>نشست کاربر در حال بررسی است.</p>
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
          <p>این سامانه برای حساب پرسنل و مدیر کافه در دسترس است.</p>
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
        <p>با حساب پرسنل یا مدیر وارد شوید.</p>
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
