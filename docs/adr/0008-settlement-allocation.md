# ADR 0008: Separate Order Lifecycle From Payment Settlement

## Status

Accepted

## Context

One table order can serve multiple people. Each person may pay selected items,
and a single person may split their settlement across cash, card terminal, and
card-to-card transfer. The original `PENDING`/`PAID` order-state model could
not represent partial settlement or bind tenders to the items a payer covered.

Customer accounts and payer identity remain outside v1. The system still needs
reconcilable item allocation, retry safety, clear payment status, and a
settlement-specific receipt.

## Decision

Keep order lifecycle and payment status separate:

- An order is `OPEN` or logically `DELETED`.
- An `OPEN` order has payment status `UNPAID`, `PARTIALLY_PAID`, or `PAID`.
- A `PaymentSettlement` represents one payer checkout and allocates selected
  order-item quantities.
- Each settlement contains one or more `Payment` tenders using `CASH`,
  `CARD_TERMINAL`, or `CARD_TRANSFER`. Card-terminal entry is manual on the
  physical terminal and is not synchronized with the application, so
  card-terminal tenders store no reconciliation reference. Card-to-card
  transfer references are optional.
- The API records a settlement atomically and idempotently. The server
  calculates allocations and settlement totals from order snapshots.
- Once a settlement exists, order contents, discounts, and table assignment
  are immutable. A Manager corrects a mistake by reversing the entire
  settlement with a required reason, then recording a replacement settlement.

## Consequences

- Separate guests and mixed tenders are represented without customer accounts
  or manual reconciliation outside the system.
- Detailed customer receipts can be printed for the full order or an individual settlement. The concise bar ticket is an order-preparation printout and never includes settlement or payment information.
- Database constraints and transaction tests must enforce allocation quantity,
  tender-total, idempotency, reversal, and payment-status invariants.
- Partial post-settlement order edits are allowed for real-life table
  continuation: Staff may add new items, increase quantities, or adjust
  unsettled quantities while the order remains `OPEN`.
- Settled item quantities, posted allocations, tenders, and payer receipt
  history are immutable. Order-level discounts are not changed after the first
  settlement because they affect allocation math.
