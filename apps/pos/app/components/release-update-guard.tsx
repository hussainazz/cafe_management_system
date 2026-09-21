"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type PosActivity = {
  isBusy: boolean;
  hasUnsavedChanges: boolean;
};

const pollIntervalMs = 45_000;
const idleCountdownSeconds = 10;
const bundledReleaseId = process.env.NEXT_PUBLIC_POS_RELEASE_ID || "development";

async function readReleaseId(): Promise<string | null> {
  try {
    const response = await fetch("/pos/api/release", { cache: "no-store" });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    return typeof (payload as { releaseId?: unknown }).releaseId === "string"
      ? (payload as { releaseId: string }).releaseId
      : null;
  } catch {
    return null;
  }
}

export function ReleaseUpdateGuard({ activity }: { activity: PosActivity }) {
  const [loadedReleaseId] = useState(bundledReleaseId);
  const [updateReady, setUpdateReady] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const activityRef = useRef(activity);
  activityRef.current = activity;

  const checkRelease = useCallback(async () => {
    const current = await readReleaseId();
    if (!current) return;
    if (loadedReleaseId !== current) setUpdateReady(true);
  }, [loadedReleaseId]);

  useEffect(() => {
    void checkRelease();
    const timer = window.setInterval(() => void checkRelease(), pollIntervalMs);
    return () => window.clearInterval(timer);
  }, [checkRelease]);

  useEffect(() => {
    if (!updateReady || activity.isBusy || activity.hasUnsavedChanges) {
      setCountdown(null);
      return;
    }
    setCountdown(idleCountdownSeconds);
  }, [activity.hasUnsavedChanges, activity.isBusy, updateReady]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      window.location.reload();
      return;
    }
    const timer = window.setTimeout(() => setCountdown((current) => current === null ? null : current - 1), 1_000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  if (!updateReady) return null;
  const waitingForWork = activity.isBusy || activity.hasUnsavedChanges;
  const refresh = () => {
    if (activityRef.current.hasUnsavedChanges && !window.confirm("تغییرات ثبت‌نشده دارید. آیا نسخه جدید بارگذاری شود؟")) return;
    window.location.reload();
  };

  return (
    <section className="release-update-banner" role="status" aria-live="polite">
      <div>
        <strong>نسخه جدید سامانه فروش آماده است.</strong>
        <span>
          {waitingForWork
            ? "پس از پایان عملیات فعلی، صندوق به‌روزرسانی می‌شود."
            : `صندوق در ${countdown ?? idleCountdownSeconds} ثانیه به‌روزرسانی می‌شود.`}
        </span>
      </div>
      <button className="button button--primary" type="button" onClick={refresh}>
        بارگذاری نسخه جدید
      </button>
    </section>
  );
}
