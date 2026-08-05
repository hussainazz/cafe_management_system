# ADR 0006: Use Browser Printing For Receipts

## Status

Accepted

## Context

Staff must be able to print receipts in v1, but direct printer control, silent ESC/POS printing, and printer integrations would add hardware-specific complexity before the core POS workflows are complete.

## Decision

Use print-friendly browser pages for two v1 print variants: a concise bar ticket and a detailed customer receipt.

A bar ticket contains only the order number, `Asia/Tehran` display time, table/takeaway context, item quantities, selected options, and notes needed for preparation. It excludes prices, discounts, totals, payments, and settlement data.

Customer receipts remain detailed financial documents. Whole-order and payer-settlement variants include item snapshots, Toman totals, tender summary where applicable, order number, and `Asia/Tehran` display time.

## Consequences

- Bar tickets and customer receipts can be delivered without native printer drivers or direct ESC/POS integration.
- The implementation must be validated on the actual cafe printer, browser, paper size, and POS device before pilot.
- Silent printing and printer routing remain separate post-v1 integrations unless a future ADR changes this boundary.
