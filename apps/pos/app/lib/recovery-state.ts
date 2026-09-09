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
      title: "ارتباط صندوق برقرار نیست",
      detail: "آخرین اطلاعات نمایش داده می‌شود؛ هیچ تغییری ثبت‌شده فرض نمی‌شود.",
      action: "تلاش برای اتصال و بازخوانی",
    };
  }

  if (error.status === 409 || error.code === "STALE_VERSION") {
    return {
      kind: "conflict",
      title: "این سفارش یا میز هم‌زمان تغییر کرده است",
      detail: "تغییر محلی ثبت نشد. نسخهٔ تازه را بگیرید و سپس تصمیم خود را دوباره اعمال کنید.",
      action: "دریافت نسخهٔ تازه",
    };
  }

  return {
    kind: "failure",
    title: "پاسخ سرویس کامل نشد",
    detail: error.message,
    action: "بازخوانی وضعیت",
  };
}
