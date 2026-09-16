"use client";

import { useEffect, useState } from "react";
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

function ReceiptItems({ receipt, className = "" }: { receipt: Receipt; className?: string }) {
  return (
    <div className={`thermal-items ${className}`}>
      {receipt.items.map((item, index) => (
        <article className={`thermal-item${item.isPaid ? " thermal-item--paid" : ""}`} key={`${item.productName}-${index}`}>
          <div className="thermal-item__main">
            <b>{item.productName}</b>
            <span>×{englishNumber.format(item.quantity)}</span>
          </div>
          {item.options.length > 0 && (
            <small>
              {item.options
                .map((option) => `${option.name} ×${englishNumber.format(option.quantity)}`)
                .join("، ")}
            </small>
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
      <header className="thermal-ticket-header">
        <p className="thermal-context">{ticket.context}</p>
        <strong className="thermal-ticket-number">
          #{englishNumber.format(ticket.dailyOrderNumber)}
        </strong>
      </header>
      <div className="thermal-divider thermal-divider--dashed" aria-hidden="true" />
      <div className="thermal-items thermal-items--ticket">
        {ticket.items.map((item, index) => (
          <article className="thermal-item" key={`${item.productName}-${index}`}>
            <div className="thermal-item__main">
              <b>{item.productName}</b>
              <span>×{englishNumber.format(item.quantity)}</span>
            </div>
            {item.options.length > 0 && (
              <small>
                {item.options
                  .map((option) => `${option.name} ×${englishNumber.format(option.quantity)}`)
                  .join("، ")}
              </small>
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
      <header className="thermal-receipt-header">کافه ران</header>
      <div className="thermal-contact" aria-label="اطلاعات تماس کافه">
        <span className="thermal-contact__item thermal-contact__item--instagram">
          <b>@Runcafe_</b>
        </span>
        <span className="thermal-contact__item thermal-contact__item--phone">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7.2 4.2 9.8 3l2.1 4.8-2.2 1.8a14.6 14.6 0 0 0 4.7 4.7l1.8-2.2 4.8 2.1-1.2 2.6c-.5 1.1-1.6 1.7-2.8 1.5C10.5 17.1 6.9 13.5 5.7 7c-.2-1.2.4-2.3 1.5-2.8Z" />
          </svg>
          <b>026-34201967</b>
        </span>
      </div>
      <div className="thermal-divider" aria-hidden="true" />
      <ReceiptItems receipt={receipt} className="thermal-items--receipt" />
      <div className="thermal-divider" aria-hidden="true" />
      <p className="thermal-time thermal-time--footer">{receipt.displayTime}</p>
      <p className="thermal-thanks">تشکر از انتخابتون :) </p>
    </main>
  );
}

export function PrintDocument({
  kind,
  orderId,
  settlementId,
}: {
  kind: PrintKind;
  orderId: string;
  settlementId?: string;
}) {
  const [data, setData] = useState<BarTicket | OrderReceipt | SettlementReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const result =
        kind === "bar-ticket"
          ? await readBarTicket(orderId)
          : kind === "receipt"
            ? await readOrderReceipt(orderId)
            : await readSettlementReceipt(orderId, settlementId!);
      if (result.ok) setData(result.data);
      else setError(result.error.message);
    };
    void load();
  }, [kind, orderId, settlementId]);

  if (error)
    return (
      <main className="thermal-error" role="alert">
        {error}
      </main>
    );
  if (!data) return <main className="thermal-loading">در حال آماده‌سازی چاپ…</main>;
  if (kind === "bar-ticket") return <BarTicket ticket={data as BarTicket} />;
  return <ReceiptDocument receipt={data as Receipt} />;
}
