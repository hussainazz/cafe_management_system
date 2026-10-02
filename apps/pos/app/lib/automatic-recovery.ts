"use client";
import { useState, type Dispatch, type SetStateAction } from "react";

let scope: string | null = null;
let active = 0;
let storageFailed = false;
const cache = new Map<string, unknown>();
export const recoveryNoticeEvent = "run-cafe:recovery-notice";
function notice(message: string) { window.dispatchEvent(new CustomEvent(recoveryNoticeEvent, { detail: message })); }
export function setRecoveryUser(userId: string) {
  if (scope !== userId) { scope = userId; cache.clear(); storageFailed = false; }
}
const record = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const weight = (value: unknown) => value === null || (Number.isInteger(value) && Number(value) > 0);
function validSnapshot(name: string, value: unknown): boolean {
  if (name === "episode") return typeof value === "boolean";
  if (name === "channel") return value === "TABLE" || value === "TAKEAWAY";
  if (name === "workspace") return value === "orders" || value === "manager";
  if (name === "manager-panel") return typeof value === "string" && ["finance", "catalog", "tables", "settings"].includes(value);
  if (name.endsWith(":draft")) return Array.isArray(value) && value.every(item => record(item) && typeof item.key === "string" && record(item.product) && typeof item.product.name === "string" && Array.isArray(item.product.optionGroups) && typeof item.product.id === "string" && Number.isFinite(item.product.priceAmount) && ["FIXED", "WEIGHTED_PER_KG"].includes(item.product.pricingMode) && Number.isInteger(item.quantity) && item.quantity > 0 && typeof item.note === "string" && weight(item.weightGrams) && Array.isArray(item.options) && item.options.every((option: any) => option && typeof option.id === "string" && Number.isFinite(option.priceAmount)));
  if (name.endsWith(":saved")) return Array.isArray(value) && value.every(item => record(item) && typeof item.id === "string" && typeof item.productId === "string" && typeof item.name === "string" && Number.isInteger(item.quantity) && item.quantity >= 0 && Number.isInteger(item.originalQuantity) && Number.isFinite(item.lineTotalAmount) && ["FIXED", "WEIGHTED_PER_KG"].includes(item.pricingModeSnapshot) && weight(item.weightGrams) && typeof item.note === "string" && (item.originalNote === null || typeof item.originalNote === "string") && Array.isArray(item.options) && item.options.every((option: any) => record(option) && typeof option.optionId === "string" && Number.isInteger(option.quantity) && option.quantity > 0));
  if (name.endsWith(":tenders")) return Array.isArray(value) && value.length > 0 && value.every(item => item && typeof item.id === "string" && ["CASH", "CARD_TERMINAL", "CARD_TRANSFER"].includes(item.method) && typeof item.amount === "string" && typeof item.reference === "string");
  if (name.endsWith(":quantities")) return Boolean(value) && typeof value === "object" && Object.values(value as object).every(quantity => Number.isInteger(quantity) && Number(quantity) >= 0);
  if (name === "order-context") return record(value) && (value.tableId === null || typeof value.tableId === "string") && (value.orderId === null || typeof value.orderId === "string") && (value.version === null || (Number.isInteger(value.version) && value.version >= 0)) && typeof value.editing === "boolean" && typeof value.checkout === "boolean";
  if (name === "payment-draft-filters") return record(value) && typeof value.currentDay === "boolean" && ["fromDate", "toDate", "fromTime", "toTime"].every(field => typeof value[field] === "string");
  if (name === "payment-applied-filters") return record(value) && ["fromDate", "toDate"].every(field => typeof value[field] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value[field])) && ["fromTime", "toTime"].every(field => value[field] === undefined || typeof value[field] === "string");
  if (name === "audit-filters") return record(value) && ["operation", "entityType", "actorId", "entityId", "sortBy", "sortDirection"].every(field => typeof value[field] === "string");
  if (name.endsWith(":version")) return Number.isInteger(value) && Number(value) >= 0;
  if (name.endsWith(":checkout")) return typeof value === "boolean";
  if (name.endsWith("key") || name.endsWith(":reason")) return typeof value === "string";
  return true;
}
function key(name: string) { return `run-cafe:recovery:v1:${scope}:${name}`; }
export function readRecovery<T>(name: string): T | undefined {
  if (!scope || typeof window === "undefined") return undefined;
  if (cache.has(name)) return cache.get(name) as T;
  try {
    const raw = sessionStorage.getItem(key(name));
    if (!raw) return undefined;
    let data: any;
    try { data = JSON.parse(raw); } catch { notice("وضعیت ذخیره‌شده قابل خواندن نیست؛ اطلاعات تازه نمایش داده می‌شود."); return undefined; }
    if (!data || data.version !== 1 || !("value" in data) || !validSnapshot(name, data.value)) { notice("وضعیت ذخیره‌شده معتبر نیست؛ اطلاعات تازه نمایش داده می‌شود."); return undefined; }
    cache.set(name, data.value);
    return data.value as T;
  } catch { storageFailed = true; return undefined; }
}
export function writeRecovery(name: string, value: unknown) {
  if (!scope || typeof window === "undefined") return;
  cache.set(name, value);
  if (value === undefined) { try { sessionStorage.removeItem(key(name)); } catch { storageFailed = true; } return; }
  try { sessionStorage.setItem(key(name), JSON.stringify({ version: 1, value })); }
  catch { storageFailed = true; notice("ذخیره کار فعلی ممکن نیست؛ بازخوانی خودکار متوقف شد. کار فعلی را نگه دارید."); }
}
export function useRecoveryState<T>(name: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    const fallback = typeof initial === "function" ? (initial as () => T)() : initial;
    const stored = readRecovery<T>(name);
    const valid = stored !== undefined && typeof stored === typeof fallback && Array.isArray(stored) === Array.isArray(fallback) && (fallback === null ? stored === null : stored !== null);
    const resolved = valid ? stored : fallback;
    writeRecovery(name, resolved);
    return resolved;
  });
  const update: Dispatch<SetStateAction<T>> = (next) => setValue(current => {
    const resolved = typeof next === "function" ? (next as (current: T) => T)(current) : next;
    writeRecovery(name, resolved);
    return resolved;
  });
  return [value, update];
}
export function beginRecoveryActivity() { active += 1; let ended = false; return () => { if (!ended) { ended = true; active -= 1; } }; }
export function recoveryActivityCount() { return active; }
export function finishRecoveryEpisode() { writeRecovery("episode", false); }
export function requestAutomaticRecovery(reload = () => window.location.reload()): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout>;
  const attempt = () => {
    if (cancelled) return;
    if (!navigator.onLine || active) { timer = setTimeout(attempt, 250); return; }
    if (storageFailed) { notice("ذخیره وضعیت بازیابی ممکن نیست؛ کار فعلی حفظ شد. اتصال و فضای مرورگر را بررسی کنید."); return; }
    if (readRecovery<boolean>("episode")) { notice("بازخوانی خودکار قبلاً انجام شد؛ کار شما حفظ شده است. اتصال را بررسی کنید و وضعیت را دوباره دریافت کنید."); return; }
    writeRecovery("episode", true);
    if (!storageFailed) reload();
  };
  timer = setTimeout(attempt, 50);
  return () => { cancelled = true; clearTimeout(timer); };
}
