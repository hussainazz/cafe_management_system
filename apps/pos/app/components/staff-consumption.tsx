"use client";

import { roundDiscountedAmount } from "@cafe/contracts";
import { useEffect, useState, type FormEvent } from "react";
import {
  createPersonnelProfile,
  deleteOpenOrder,
  discountStaffConsumption,
  readPersonnelProfiles,
  readStaffConsumption,
  type PosPersonnelProfile,
  type StaffConsumptionEntry,
} from "../lib/api-client";
import { formatOrderNumber, formatToman, positiveIntegerAmount } from "../lib/pos-utils";
import { MenuIcon } from "./icons";

type DiscountKind = "FIXED" | "PERCENTAGE";

export function StaffConsumption({ role, onOpenMenu, onStartOrder, menuOpen = false }: {
  role: "STAFF" | "CASHIER" | "MANAGER" | "DEVELOPER";
  onOpenMenu: () => void;
  onStartOrder: (profile: PosPersonnelProfile) => void;
  menuOpen?: boolean;
}) {
  const [profiles, setProfiles] = useState<PosPersonnelProfile[]>([]);
  const [entries, setEntries] = useState<StaffConsumptionEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [discountEntryId, setDiscountEntryId] = useState<string | null>(null);
  const [removeEntryId, setRemoveEntryId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    setListError(null);
    try {
      const [people, list] = await Promise.all([readPersonnelProfiles(), readStaffConsumption()]);
      if (!people.ok) setError(people.error.message);
      else {
        setProfiles(people.data);
        setSelectedProfileId((current) => people.data.some((profile) => profile.id === current) ? current : "");
      }
      if (!list.ok) { setError(list.error.message); setListError(list.error.message); }
      else { setEntries(list.data.data); setCursor(list.data.meta.nextCursor); }
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const createProfile = async (event: FormEvent) => {
    event.preventDefault();
    const name = profileName.trim();
    if (!name || profileBusy) return;
    setProfileBusy(true);
    setError(null);
    const result = await createPersonnelProfile(name);
    if (!result.ok) setError(result.error.message);
    else {
      setProfiles((current) => [...current, result.data].sort((left, right) => left.name.localeCompare(right.name, "fa")));
      setSelectedProfileId(result.data.id);
      setProfileName("");
    }
    setProfileBusy(false);
  };
  const applyDiscount = async (entry: StaffConsumptionEntry, kind: DiscountKind, value: string) => {
    const amount = positiveIntegerAmount(value);
    if (!amount || (kind === "PERCENTAGE" && amount > 100)) {
      setError(kind === "PERCENTAGE" ? "درصد تخفیف باید بین ۱ تا ۱۰۰ باشد." : "مبلغ تخفیف را وارد کنید.");
      return false;
    }
    setBusy(true);
    setError(null);
    const result = await discountStaffConsumption(entry.id, entry.version, { kind, value: amount });
    if (!result.ok) setError(result.error.message);
    else {
      setDiscountEntryId(null);
      await load();
    }
    setBusy(false);
    return result.ok;
  };
  const remove = async (entry: StaffConsumptionEntry) => {
    setBusy(true);
    setError(null);
    const result = await deleteOpenOrder(entry.id, { expectedVersion: entry.version });
    if (!result.ok) setError(result.error.message);
    else { setRemoveEntryId(null); await load(); }
    setBusy(false);
  };
  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    const result = await readStaffConsumption(cursor);
    if (result.ok) {
      setListError(null);
      setEntries((current) => [...current, ...result.data.data]);
      setCursor(result.data.meta.nextCursor);
    } else { setError(result.error.message); setListError(result.error.message); }
    setLoadingMore(false);
  };
  return <section className="pos-workspace staff-consumption-workspace" dir="rtl">
    <header className="workspace-header staff-consumption-header">
      <h1>حساب پرسنل</h1>
      <button className="menu-button" type="button" aria-label="باز کردن منو" aria-expanded={menuOpen} aria-controls="pos-navigation-drawer" onClick={onOpenMenu}><MenuIcon /></button>
    </header>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="staff-consumption-layout">
    <section className="staff-profile-section manager-card" aria-labelledby="staff-profiles-title">
      <h2 id="staff-profiles-title">پروفایل پرسنل</h2>
      <p>برای هر شخص یک نام ثبت کنید تا سفارش‌ها به همان پروفایل نسبت داده شوند.</p>
      <form className="staff-profile-create" onSubmit={(event) => void createProfile(event)}>
        <label htmlFor="staff-profile-name">نام پرسنل</label>
        <input id="staff-profile-name" name="name" value={profileName} maxLength={120} onChange={(event) => setProfileName(event.target.value)} placeholder="نام پرسنل" autoComplete="off" />
        <button className="button button--quiet" type="submit" disabled={profileBusy || !profileName.trim()}>{profileBusy ? "در حال ثبت…" : "ایجاد پروفایل"}</button>
      </form>
      <label htmlFor="staff-profile-select">ثبت سفارش برای</label>
      <select id="staff-profile-select" value={selectedProfileId} onChange={(event) => setSelectedProfileId(event.target.value)} disabled={loading || profiles.length === 0}>
        {profiles.length === 0 ? <option value="">ابتدا یک پروفایل بسازید</option> : <><option value="">انتخاب پرسنل</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</>}
      </select>
      <button className="button button--primary" type="button" disabled={!selectedProfileId || loading || busy} onClick={() => {
        const profile = profiles.find((candidate) => candidate.id === selectedProfileId);
        if (profile) onStartOrder(profile);
      }}>افزودن سفارش برای پرسنل</button>
      {loading && profiles.length === 0 && <p role="status">در حال دریافت پروفایل‌ها…</p>}
      {!loading && profiles.length === 0 && <p>هنوز پروفایلی ثبت نشده است.</p>}
    </section>
    <section className="staff-consumption-orders" aria-labelledby="staff-orders-title">
    <h2 id="staff-orders-title">سفارش‌های پرسنل</h2>
    {loading && <p role="status">در حال دریافت سفارش‌های پرسنل…</p>}
    {!loading && entries.length === 0 && !listError && <p>سفارشی ثبت نشده است.</p>}
    {entries.map((entry) => <article className="manager-card staff-entry" key={entry.id}>
      <h3>سفارش {formatOrderNumber(entry.dailyOrderNumber)} · {entry.staffName || entry.username}</h3>
      <p>{entry.items.map((item) => `${item.productNameSnapshot} × ${item.quantity}`).join("، ")}</p>
      <p>{new Date(entry.createdAt).toLocaleString("fa-IR")} · {formatToman(entry.totalAmount)} تومان{entry.discountAmount ? ` · تخفیف ${formatToman(entry.discountAmount)} تومان` : ""}</p>
      {discountEntryId === entry.id
        ? <StaffDiscountForm entry={entry} busy={busy} onCancel={() => setDiscountEntryId(null)} onApply={(kind, value) => applyDiscount(entry, kind, value)} />
        : <button className="button button--quiet" type="button" disabled={busy} onClick={() => { setError(null); setDiscountEntryId(entry.id); }}>تخفیف</button>}
      {role !== "STAFF" && (removeEntryId === entry.id
        ? <div className="staff-remove-confirm" role="group" aria-label={`تأیید حذف سفارش ${formatOrderNumber(entry.dailyOrderNumber)}`}>
          <p>این سفارش از فهرست حساب پرسنل خارج می‌شود؛ سابقه‌ی ثبت آن باقی می‌ماند.</p>
          <div className="modal-actions"><button className="button button--quiet" type="button" disabled={busy} onClick={() => setRemoveEntryId(null)}>انصراف</button><button className="button button--danger" type="button" disabled={busy} onClick={() => void remove(entry)}>{busy ? "در حال حذف…" : "تأیید حذف"}</button></div>
        </div>
        : <button className="text-danger" type="button" disabled={busy} onClick={() => { setError(null); setRemoveEntryId(entry.id); }}>حذف</button>)}
    </article>)}
    {listError && !loading && <button className="button button--quiet" type="button" disabled={busy} onClick={() => void load()}>دریافت دوباره</button>}
    {cursor && <button className="button button--quiet" type="button" disabled={busy || loadingMore} onClick={() => void loadMore()}>{loadingMore ? "در حال دریافت…" : "نمایش سفارش‌های بیشتر"}</button>}
    </section>
    </div>
  </section>;
}

function StaffDiscountForm({ entry, busy, onCancel, onApply }: {
  entry: StaffConsumptionEntry;
  busy: boolean;
  onCancel: () => void;
  onApply: (kind: DiscountKind, value: string) => Promise<boolean>;
}) {
  const [kind, setKind] = useState<DiscountKind>("FIXED");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const previewAmount = positiveIntegerAmount(value);
  const subtotal = entry.totalAmount + entry.discountAmount;
  const requestedDiscount = kind === "PERCENTAGE" ? Math.floor(subtotal * Math.min(previewAmount, 100) / 100) : previewAmount;
  const previewFinal = Math.min(subtotal, roundDiscountedAmount(Math.max(0, subtotal - requestedDiscount)));
  const previewDiscount = subtotal - previewFinal;
  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!previewAmount || (kind === "PERCENTAGE" && previewAmount > 100)) {
      setError(kind === "PERCENTAGE" ? "درصد تخفیف باید بین ۱ تا ۱۰۰ باشد." : "مبلغ تخفیف را وارد کنید.");
      return;
    }
    const ok = await onApply(kind, value);
    if (!ok) setError("تخفیف ثبت نشد. پیام خطا را بالای صفحه ببینید و دوباره تلاش کنید.");
  };
  return <form className="staff-discount-form" aria-label={`ثبت تخفیف سفارش ${formatOrderNumber(entry.dailyOrderNumber)}`} onSubmit={(event) => void onSubmit(event)}>
    <fieldset disabled={busy}>
      <legend>نوع تخفیف</legend>
      <label><input type="radio" name={`staff-discount-${entry.id}`} checked={kind === "FIXED"} onChange={() => setKind("FIXED")} /> مبلغ (تومان)</label>
      <label><input type="radio" name={`staff-discount-${entry.id}`} checked={kind === "PERCENTAGE"} onChange={() => setKind("PERCENTAGE")} /> درصد</label>
    </fieldset>
    <label htmlFor={`staff-discount-value-${entry.id}`}>{kind === "PERCENTAGE" ? "درصد تخفیف (۱ تا ۱۰۰)" : "مبلغ تخفیف به تومان"}</label>
    <input id={`staff-discount-value-${entry.id}`} inputMode="numeric" value={value} onChange={(event) => { setValue(event.target.value.replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))).replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))).replace(/\D/g, "")); setError(null); }} />
    <p>جمع پیش از تخفیف {formatToman(subtotal)} تومان · تخفیف جدید {formatToman(previewDiscount)} تومان · جمع پس از تخفیف {formatToman(previewFinal)} تومان. مبلغ نهایی را سرویس ثبت سفارش تأیید می‌کند.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><button className="button button--quiet" type="button" disabled={busy} onClick={onCancel}>انصراف</button><button className="button button--primary" type="submit" disabled={busy || !value}>{busy ? "در حال ثبت…" : "ثبت تخفیف"}</button></div>
  </form>;
}
