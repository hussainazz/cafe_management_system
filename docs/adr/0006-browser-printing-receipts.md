# ADR 0006: Use Browser Printing For Receipts

## Status

Accepted

## Context

Staff must be able to print receipts in v1, but direct printer control, silent ESC/POS printing, and printer integrations would add hardware-specific complexity before the core POS workflows are complete.

## Decision

Use print-friendly browser receipt pages for v1 receipts.

Receipts must include item snapshots, Toman totals, payment summary, receipt number, and `Asia/Tehran` display time.

## Consequences

- Receipt printing can be delivered without native printer drivers or direct ESC/POS integration.
- The implementation must be validated on the actual cafe printer, browser, paper size, and POS device before pilot.
- Silent printing and printer routing remain separate post-v1 integrations unless a future ADR changes this boundary.
