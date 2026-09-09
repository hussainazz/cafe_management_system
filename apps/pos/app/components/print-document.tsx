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
  return (
    <main className="thermal-print thermal-print--receipt">
      <ReceiptItems receipt={receipt} />
      <section className="thermal-summary thermal-summary--total">
        <strong>{formatToman(receipt.totalAmount)}</strong>
      </section>
      <p className="thermal-time thermal-time--footer">{receipt.displayTime}</p>
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
