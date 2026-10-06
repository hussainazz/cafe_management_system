import type { ApiFailure } from "./api-client";

export type RecoveryState = {
  kind: "offline" | "conflict" | "failure";
  title: string;
  detail: string;
  action: string;
};

export function recoveryStateFor(error: ApiFailure): RecoveryState {
  if (error.kind === "network") {
    return {
      kind: "offline",
      title: "اتصال صندوق قطع است",
      detail: "آخرین اطلاعات دریافت‌شده را می‌بینید. تا زمان تأیید سرویس، هیچ تغییری ثبت‌شده محسوب نمی‌شود.",
      action: "اتصال و بازخوانی دوباره",
    };
  }

  if (error.code === "IDEMPOTENCY_CONFLICT") {
    return {
      kind: "failure",
      title: "درخواست با اطلاعات متفاوتی تکرار شد",
      detail: "فهرست سفارش‌های فعال را تازه کنید و پیش از ثبت دوباره، بررسی کنید که سفارش قبلاً ایجاد نشده باشد.",
      action: "بازخوانی وضعیت",
    };
  }

  if (error.code === "STALE_VERSION") {
    return {
      kind: "conflict",
      title: "این سفارش یا میز هم‌زمان تغییر کرده است",
      detail: "تغییر شما ثبت نشد. اطلاعات تازه را بگیرید و سپس تغییر را دوباره اعمال کنید.",
      action: "دریافت اطلاعات تازه",
    };
  }

  return {
    kind: "failure",
    title: "پاسخ سرویس کامل دریافت نشد",
    detail: error.message,
    action: "بازخوانی وضعیت",
  };
}
