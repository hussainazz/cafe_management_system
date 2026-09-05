"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { AuthenticatedUser } from "@cafe/contracts";
import { currentSession, endSession, refreshSession, signIn, type ApiFailure } from "../lib/api-client";
import { CoffeeMark, ExitIcon, RefreshIcon, SignalIcon } from "./icons";
import { Button, ConfirmDialog, EmptyState, InlineAlert, Panel, Skeleton, StatusBadge } from "./ui";
import { NewOrderWorkspace } from "./new-order-workspace";

type SessionState =
  | { kind: "loading" }
  | { kind: "ready"; user: AuthenticatedUser; reconnecting: boolean }
  | { kind: "signed-out" }
  | { kind: "authentication-required" }
  | { kind: "forbidden" }
  | { kind: "failure"; error: ApiFailure };

function stateFromFailure(error: ApiFailure): SessionState {
  if (error.status === 403 || error.code === "FORBIDDEN") return { kind: "forbidden" };
  if (error.status === 401 || error.code === "AUTHENTICATION_REQUIRED" || error.code === "SESSION_EXPIRED") return { kind: "authentication-required" };
  return { kind: "failure", error };
}

function roleLabel(role: AuthenticatedUser["role"]) { return role === "MANAGER" ? "مدیر" : "پرسنل"; }

export function PosSessionBoundary() {
  const [state, setState] = useState<SessionState>({ kind: "loading" });
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  const loadSession = useCallback(async (allowRefresh: boolean) => {
    setState((previous) => previous.kind === "ready" ? { ...previous, reconnecting: true } : { kind: "loading" });
    const initial = await currentSession();
    if (initial.ok) { setState({ kind: "ready", user: initial.data, reconnecting: false }); return; }
    if (allowRefresh && (initial.error.status === 401 || initial.error.code === "SESSION_EXPIRED")) {
      const refreshed = await refreshSession();
      if (refreshed.ok) { setState({ kind: "ready", user: refreshed.data, reconnecting: false }); return; }
      setState(stateFromFailure(refreshed.error));
      return;
    }
    setState(stateFromFailure(initial.error));
  }, []);

  useEffect(() => { void loadSession(true); }, [loadSession]);

  const signOut = useCallback(async () => {
    setConfirmingSignOut(false);
    const result = await endSession();
    setState(result.ok ? { kind: "signed-out" } : stateFromFailure(result.error));
  }, []);

  const handleSignIn = useCallback(async (input: { username: string; password: string }) => {
    const result = await signIn(input);
    setState(result.ok ? { kind: "ready", user: result.data, reconnecting: false } : stateFromFailure(result.error));
    return result;
  }, []);

  if (state.kind === "loading") return <LoadingFrame />;
  if (state.kind === "ready") {
    return <><SignedInShell user={state.user} reconnecting={state.reconnecting} onRefetch={() => void loadSession(true)} onSignOut={() => setConfirmingSignOut(true)}><NewOrderWorkspace /></SignedInShell><ConfirmDialog open={confirmingSignOut} title="خروج از سامانه" description="نشست این دستگاه پایان می‌یابد. برای ادامه باید دوباره وارد شوید." confirmLabel="خروج" onConfirm={() => void signOut()} onClose={() => setConfirmingSignOut(false)} /></>;
  }
  return <SessionFallback state={state} onRetry={() => void loadSession(true)} onSignIn={handleSignIn} />;
}

function SignedInShell({ user, reconnecting, onRefetch, onSignOut, children }: { user: AuthenticatedUser; reconnecting: boolean; onRefetch: () => void; onSignOut: () => void; children: ReactNode }) {
  return <div className="page-frame"><header className="app-toolbar"><div className="app-toolbar__identity" aria-label="سامانه فروش کافه ران"><span className="brand-mark"><CoffeeMark /></span><span><strong>Run Cafe</strong><small>سامانه فروش</small></span></div><div className="app-toolbar__actions"><StatusBadge tone={reconnecting ? "warning" : "success"}><SignalIcon />{reconnecting ? "در حال بازخوانی" : "متصل"}</StatusBadge><Button tone="secondary" onClick={onRefetch} disabled={reconnecting} aria-label="بازخوانی وضعیت نشست"><RefreshIcon /><span>بازخوانی</span></Button><span className="user-chip"><b>{user.username}</b><small>{roleLabel(user.role)}</small></span><Button tone="quiet" onClick={onSignOut} aria-label="خروج از سامانه"><ExitIcon /><span>خروج</span></Button></div></header><main className="page-frame__main">{children}</main></div>;
}

function LoadingFrame() {
  return <div className="page-frame page-frame--loading" aria-busy="true" aria-label="در حال بررسی نشست"><header className="app-toolbar"><div className="app-toolbar__identity"><Skeleton className="skeleton--mark" /><Skeleton className="skeleton--identity" /></div><Skeleton className="skeleton--toolbar" /></header><main className="page-frame__main"><Panel className="workspace-placeholder"><Skeleton className="skeleton--title" /><Skeleton className="skeleton--copy" /></Panel></main></div>;
}

function SessionFallback({ state, onRetry, onSignIn }: { state: Exclude<SessionState, { kind: "loading" } | { kind: "ready" }>; onRetry: () => void; onSignIn: (input: { username: string; password: string }) => ReturnType<typeof signIn> }) {
  const content = (() => {
    switch (state.kind) {
      case "signed-out": return { title: "از سامانه خارج شدید", body: "برای ادامه کار، با حساب پرسنل یا مدیر وارد شوید.", action: "بررسی دوباره" };
      case "authentication-required": return { title: "ورود لازم است", body: "نشست شما معتبر نیست یا پایان یافته است. دوباره وارد سامانه شوید.", action: "بازخوانی نشست" };
      case "forbidden": return { title: "این بخش برای حساب شما مجاز نیست", body: "دسترسی‌ها از سمت سرویس کنترل می‌شوند. با مدیر کافه هماهنگ کنید.", action: "بررسی دوباره" };
      case "failure": return { title: "ارتباط با سامانه برقرار نشد", body: state.error.requestId ? `شناسه پیگیری: ${state.error.requestId}` : "اتصال شبکه و سرویس را بررسی کنید، سپس دوباره تلاش کنید.", action: "تلاش دوباره" };
    }
  })();
  const canSignIn = state.kind === "signed-out" || state.kind === "authentication-required";
  return <div className="session-fallback"><div className="session-fallback__brand"><CoffeeMark /><span>Run Cafe <small>سامانه فروش</small></span></div><Panel className="session-fallback__panel">{state.kind === "failure" ? <InlineAlert title="وضعیت سرویس نامشخص" tone="danger">{content.body}</InlineAlert> : null}{canSignIn ? <SignInForm onSignIn={onSignIn} /> : <EmptyState title={content.title} action={<Button onClick={onRetry}><RefreshIcon />{content.action}</Button>}>{content.body}</EmptyState>}</Panel></div>;
}

function SignInForm({ onSignIn }: { onSignIn: (input: { username: string; password: string }) => ReturnType<typeof signIn> }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await onSignIn({ username, password });
    if (!result.ok) setError(result.error.message);
    setSubmitting(false);
  };

  return <form className="sign-in-form" onSubmit={(event) => void submit(event)}><div className="sign-in-form__heading"><span className="empty-state__mark" aria-hidden="true" /><h1>ورود به سامانه</h1><p>نام کاربری و رمز عبور حساب پرسنل یا مدیر را وارد کنید.</p></div><label>نام کاربری<input autoComplete="username" dir="ltr" value={username} onChange={(event) => setUsername(event.target.value)} required /></label><label>رمز عبور<input autoComplete="current-password" dir="ltr" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error ? <InlineAlert title="ورود انجام نشد" tone="danger">{error}</InlineAlert> : null}<Button type="submit" disabled={submitting}>{submitting ? "در حال ورود" : "ورود"}</Button></form>;
}
