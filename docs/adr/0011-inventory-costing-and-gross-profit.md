# ADR 0011: Track Inventory Costing And Gross Profit From Opening Count

## Status

Accepted on 12 October 2026.

## Context

The café needs ingredient and purchased-item costs, stock reconciliation, and
gross-profit reporting. Current scope has no inventory ledger. Historical
orders cannot be reconstructed reliably from current recipes, and partial
settlements must not consume stock before a sale is complete. A small operator
needs explicit missing-cost and count-coverage states rather than guessed
values.

## Decision

- Start stock tracking only after a Manager posts a valued opening physical
  count. Do not import historical sales or create deductions for past orders.
- Use one base unit per stock item: grams, milliliters, or pieces. Convert
  purchase packs only through explicit item-specific conversions; never infer
  weight-to-volume equivalence.
- Store money as integer Toman and calculate fractional unit costs from exact
  quantities and total values. Round only when posting monetary totals.
- Keep an append-only inventory movement ledger with linked compensating
  entries. Maintain current moving-average quantity/value transactionally.
- Snapshot resolved recipe quantities when order items are saved. Resolve
  recipe edits and product-option rules in the API, then persist the snapshot
  so catalog changes cannot rewrite historical order costing.
- Recognize theoretical item costs and attempt stock deduction only when an
  entire order first becomes fully paid. Deduct the entire order atomically or
  leave it pending without partial reservation. Staff checkout remains
  available when stock is short.
- Keep theoretical COGS at the full-payment moving-average snapshot. Actual
  movement values use the average at the time stock is posted. Receipts retry
  whole pending orders in full-payment order.
- Require explicit count reconciliation for pending orders already absorbed
  by an observed count. A later reversal or deletion restores stock exactly
  once at its recorded carrying value, including reconciled consumption.
- Provide Manager-only stock and costing workflows. Staff settlement flows
  trigger recognition without exposing costs. Receipts and public-menu
  responses never contain costs or margins.
- Report gross profit only. Bound arbitrary Tehran-date ranges, show cost
  completeness and pending status, and label inventory-based COGS as an
  estimate unless compatible physical-count boundaries support it. Operating
  expenses, supplier accounts, purchase orders, dedicated waste/staff-use
  entry, historical imports, and automatic portion conversion remain excluded.

## Consequences

The phase adds stock, conversion, purchase, recipe, product-costing,
movement, count, pending-consumption, and order-costing records. Posting
commands require idempotency, versioned edits reject stale writes, and
settlement/count/correction work must use transactions and concurrency
protection. Unknown costs stay incomplete for historical reports. The detailed
acceptance rules and delivery stages are in
`../planning/inventory-costing.md`.
