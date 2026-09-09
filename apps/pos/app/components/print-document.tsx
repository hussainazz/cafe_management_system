"use client";

import { useEffect, useRef, useState } from "react";
import {
  readBarTicket,
  readOrderReceipt,
  readSettlementReceipt,
  type BarTicket,
  type OrderReceipt,
  type SettlementReceipt,
} from "../lib/api-client";
import { englishNumber, formatToman } from "../lib/pos-utils";

type PrintKind = "bar-ticket" | "receipt" | "settlement";
type Receipt = OrderReceipt | SettlementReceipt;

const paymentLabel = {
  CASH: "نقدی",
  CARD_TERMINAL: "کارت‌خوان",
  CARD_TRANSFER: "کارت‌به‌کارت",
} as const;

function ReceiptItems({ receipt }: { receipt: Receipt }) {
  return (
    <div className="thermal-items">
      {receipt.items.map((item, index) => (
        <article className="thermal-item" key={`${item.productName}-${index}`}>
          <div className="thermal-item__main">
            <b>{item.productName}</b>
            <span>×{englishNumber.format(item.quantity)}</span>
          </div>
          {item.options.length > 0 && (
            <small>{item.options.map((option) => `${option.name} ×${englishNumber.format(option.quantity)}`).join("، ")}</small>
          )}
          <strong>{formatToman(item.lineTotalAmount)}</strong>
        </article>
      ))}
    </div>
  );
}

function BarTicket({ ticket }: { ticket: BarTicket }) {
  return (
    <main className="thermal-print thermal-print--ticket">
      <p className="thermal-context">{ticket.context}</p>
      <div className="thermal-items">
        {ticket.items.map((item, index) => (
          <article className="thermal-item" key={`${item.productName}-${index}`}>
            <div className="thermal-item__main">
              <b>{item.productName}</b>
              <span>×{englishNumber.format(item.quantity)}</span>
            </div>
            {item.options.length > 0 && (
              <small>{item.options.map((option) => `${option.name} ×${englishNumber.format(option.quantity)}`).join("، ")}</small>
            )}
            {item.note && <p className="thermal-note">{item.note}</p>}
          </article>
        ))}
      </div>
    </main>
  );
}

function ReceiptDocument({ receipt }: { receipt: Receipt }) {
  const wholeOrder = "subtotalAmount" in receipt;
  return (
    <main className="thermal-print thermal-print--receipt">
      <p className="thermal-time">{receipt.displayTime}</p>
      <ReceiptItems receipt={receipt} />
      {wholeOrder && (
        <section className="thermal-summary">
          <p><span>جمع اقلام</span><strong>{formatToman(receipt.subtotalAmount)}</strong></p>
          {receipt.discountAmount > 0 && <p><span>تخفیف</span><strong>−{formatToman(receipt.discountAmount)}</strong></p>}
        </section>
      )}
      <section className="thermal-summary thermal-summary--total">
        <p><span>{wholeOrder ? "مبلغ نهایی" : "مبلغ پرداخت"}</span><strong>{formatToman(receipt.totalAmount)}</strong></p>
      </section>
      <section className="thermal-payments" aria-label="روش‌های پرداخت">
        {receipt.payments.map((payment, index) => (
          <p key={`${payment.method}-${index}`}><span>{paymentLabel[payment.method]}</span><strong>{formatToman(payment.amount)}</strong></p>
        ))}
      </section>
      {wholeOrder && (
        <section className="thermal-summary thermal-summary--balance">
          <p><span>پرداخت‌شده</span><strong>{formatToman(receipt.paidAmount)}</strong></p>
          {receipt.balanceAmount > 0 && <p><span>مانده</span><strong>{formatToman(receipt.balanceAmount)}</strong></p>}
        </section>
      )}
    </main>
  );
}

export function PrintDocument({ kind, orderId, settlementId }: { kind: PrintKind; orderId: string; settlementId?: string }) {
  const [data, setData] = useState<BarTicket | OrderReceipt | SettlementReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const printed = useRef(false);

  useEffect(() => {
    const load = async () => {
      const result = kind === "bar-ticket"
        ? await readBarTicket(orderId)
        : kind === "receipt"
          ? await readOrderReceipt(orderId)
          : await readSettlementReceipt(orderId, settlementId!);
      if (result.ok) setData(result.data);
      else setError(result.error.message);
    };
    void load();
  }, [kind, orderId, settlementId]);

  useEffect(() => {
    if (!data || printed.current) return;
    printed.current = true;
    const timer = window.setTimeout(() => window.print(), 120);
    return () => window.clearTimeout(timer);
  }, [data]);

  if (error) return <main className="thermal-error" role="alert">{error}</main>;
  if (!data) return <main className="thermal-loading">در حال آماده‌سازی چاپ…</main>;
  if (kind === "bar-ticket") return <BarTicket ticket={data as BarTicket} />;
  return <ReceiptDocument receipt={data as Receipt} />;
}
