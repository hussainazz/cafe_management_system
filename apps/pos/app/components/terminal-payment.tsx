"use client";
import { useEffect, useRef, useState } from "react";
import type { RecordSettlementRequest, TerminalAttempt, TerminalReconcile } from "@cafe/contracts";
import { readOrder, terminalActive, terminalConfig, terminalPrepare, terminalRead, terminalReconcile, type PosOrderDetail } from "../lib/api-client";
import { sendTerminalPurchase } from "../lib/sep-payment";
import { formatToman } from "../lib/pos-utils";

export function useTerminalPayment(orderId: string, onSuccess: (order: PosOrderDetail) => void, historical: boolean) {
  const [enabled, setEnabled] = useState(false);
  const [attempt, setAttempt] = useState<TerminalAttempt | null>(null);
  const [loading, setLoading] = useState(!historical);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actionGate = useRef(false);
  const success = useRef(onSuccess); success.current = onSuccess;
  useEffect(() => {
    if (historical) return;
    let alive = true;
    void (async () => {
      try {
        const [config, active] = await Promise.all([terminalConfig(), terminalActive(orderId)]);
        if (!alive) return;
        if (config.ok) setEnabled(config.data.enabled);
        if (active.ok) setAttempt(active.data);
        else setError("وضعیت پرداخت قبلی مشخص نشد. پیش از پرداخت دوباره، وضعیت سفارش را بررسی کنید.");
      } catch { /* Backend reservation still prevents a conflicting manual settlement. */ }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [orderId, historical]);
  useEffect(() => {
    if (!attempt || attempt.status === "SUCCEEDED" || attempt.status === "FAILED") return;
    let alive = true; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const result = await terminalRead(attempt.id);
      if (!alive) return;
      if (result.ok) { setAttempt(result.data); setError(null); }
      else setError("ارتباط با سرور قطع شده است. وضعیت پرداخت مشخص نیست؛ دوباره پرداخت نکنید.");
      timer = setTimeout(() => void poll(), 3000);
    };
    timer = setTimeout(() => void poll(), 3000);
    return () => { alive = false; clearTimeout(timer); };
  }, [attempt?.id, attempt?.status]);
  const start = async (checkout: RecordSettlementRequest, key: string) => {
    if (actionGate.current || attempt) return;
    actionGate.current = true; setBusy(true); setError(null);
    try {
      const prepared = await terminalPrepare(orderId, checkout, key);
      if (!prepared.ok) { setError("درخواست پرداخت تأیید نشد. وضعیت سفارش را دوباره بررسی کنید."); return; }
      setAttempt(prepared.data);
      // No dispatch when recovery returns an existing claimed/expired/final attempt.
      if (prepared.data.authorization && !prepared.replayed) {
        const accepted = await sendTerminalPurchase(prepared.data.authorization);
        if (!accepted) setError("پاسخ برنامه کارت‌خوان دریافت نشد. نتیجه نامشخص است؛ پرداخت را تکرار نکنید و رسید یا حساب بانکی را بررسی کنید.");
      }
    } finally { actionGate.current = false; setBusy(false); }
  };
  const reconcile = async (input: TerminalReconcile) => {
    if (!attempt || actionGate.current) return;
    actionGate.current = true; setBusy(true); setError(null);
    try {
      const result = await terminalReconcile(attempt.id, input);
      if (result.ok) setAttempt(result.data);
      else setError("ثبت نتیجه انجام نشد. وضعیت پرداخت را دوباره بررسی کنید؛ پرداخت تازه‌ای نفرستید.");
    } finally { actionGate.current = false; setBusy(false); }
  };
  const finish = async () => {
    if (actionGate.current) return;
    actionGate.current = true; setBusy(true);
    try {
      const result = await readOrder(orderId);
      if (result.ok) success.current(result.data);
      else setError("اطلاعات سفارش دریافت نشد. پرداخت را تکرار نکنید.");
    } finally { actionGate.current = false; setBusy(false); }
  };
  return { enabled, attempt, loading, busy, error, start, reconcile, finish };
}
export function TerminalPaymentStatus({ payment }: { payment: ReturnType<typeof useTerminalPayment> }) {
  const [basis, setBasis] = useState<"TERMINAL_RECEIPT" | "BANK_RECORD">("TERMINAL_RECEIPT");
  const [receiptChecked, setReceiptChecked] = useState(false);
  const [noChargeChecked, setNoChargeChecked] = useState(false);
  const [idleChecked, setIdleChecked] = useState(false);
  const attempt = payment.attempt;
  if (!attempt) return payment.error ? <p role="alert">{payment.error}</p> : null;
  const resolved = attempt.status === "SUCCEEDED" || attempt.status === "FAILED";
  return <section className="settlement-selection" aria-label="وضعیت پرداخت کارت‌خوان" aria-live="polite">
    <p>{attempt.status === "SUCCEEDED" ? "پرداخت پس از بررسی ثبت شد." : attempt.status === "FAILED" ? "عدم برداشت تأیید شد. پرداختی برای این درخواست ثبت نشد." : attempt.status === "PENDING" && attempt.dispatchedAt ? "در انتظار نتیجه کارت‌خوان…" : "این پرداخت نیاز به بررسی دارد. تا مشخص شدن نتیجه، دوباره پرداخت نکنید."}</p>
    <p>مبلغ کارت‌خوان: <strong>{formatToman(attempt.cardAmount)} تومان</strong></p>
    <p>جمع این پرداخت: {formatToman(attempt.settlementAmount)} تومان</p>
    {attempt.payments.map((payment, index) => <p key={index}>{payment.method === "CASH" ? "نقدی" : payment.method === "CARD_TRANSFER" ? "کارت‌به‌کارت" : "کارت‌خوان"}: {formatToman(payment.amount)} تومان</p>)}
    {attempt.responseCode && <p>کد پاسخ: <bdi>{attempt.responseCode}</bdi>؛ {attempt.responseCode === "00" ? "پاسخ تأیید دریافت شده؛ مبلغ رسید هنوز باید بررسی شود." : "کد پاسخ به‌تنهایی برای ثبت یا تکرار پرداخت کافی نیست."}</p>}
    {attempt.rrn && <p>شماره مرجع: <bdi>{attempt.rrn}</bdi></p>}
    {attempt.trace && <p>شماره پیگیری: <bdi>{attempt.trace}</bdi></p>}
    {!resolved && <>
      <p>بستن این پنجره، پرداخت کارت‌خوان را لغو نمی‌کند. برای بررسی نتیجه، ثبت پرداخت همین سفارش را دوباره باز کنید.</p>
      <label>مدرک بررسی <select value={basis} disabled={payment.busy} onChange={e => { setBasis(e.target.value as typeof basis); setReceiptChecked(false); setNoChargeChecked(false); }}><option value="TERMINAL_RECEIPT">رسید کارت‌خوان</option><option value="BANK_RECORD">گردش حساب بانکی</option></select></label>
      <label><input type="checkbox" checked={receiptChecked} disabled={payment.busy || !attempt.dispatchedAt} onChange={e => setReceiptChecked(e.target.checked)} />برداشت موفق و مبلغ {formatToman(attempt.cardAmount)} تومان را در مدرک بررسی کردم. سایر روش‌های این پرداخت هم دریافت شده‌اند.</label>
      <button type="button" className="button button--primary" disabled={payment.busy || !receiptChecked || !attempt.dispatchedAt} onClick={() => void payment.reconcile({ expectedVersion: attempt.version, decision: "SUCCEEDED", basis, receiptChecked: true, cardAmount: attempt.cardAmount })}>تأیید برداشت و ثبت پرداخت</button>
      <label><input type="checkbox" checked={noChargeChecked} disabled={payment.busy} onChange={e => setNoChargeChecked(e.target.checked)} />مدرک را بررسی کردم و مبلغی کسر نشده است.</label>
      <label><input type="checkbox" checked={idleChecked} disabled={payment.busy} onChange={e => setIdleChecked(e.target.checked)} />کارت‌خوان آماده است و پردازش این پرداخت در ویندوز متوقف شده است.</label>
      <button type="button" className="button button--quiet" disabled={payment.busy || !noChargeChecked || !idleChecked} onClick={() => void payment.reconcile({ expectedVersion: attempt.version, decision: "FAILED", basis, terminalIdleConfirmed: true, bridgeStoppedConfirmed: true, noChargeConfirmed: true })}>تأیید عدم برداشت</button>
    </>}
    {payment.error && <p role="alert">{payment.error}</p>}
  </section>;
}
