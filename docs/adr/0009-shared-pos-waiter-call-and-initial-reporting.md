# ADR 0009: Use One Role-Gated POS With Waiter-Call And Bounded Initial Reporting

## Status

Accepted on 1 September 2026.

## Context

Staff and Manager users perform the same core table, order, payment, and receipt
work. Building a separate Manager application or a second table dashboard would
duplicate workflows and risk inconsistent business rules. The first POS release
also needs a small customer-to-table signal without expanding the browse-only
menu into customer ordering.

The first accounting interface should be useful during daily operation without
introducing broad historical aggregation before real usage is measured.

## Decision

- Build one POS application for both Staff and Manager accounts. Both roles use
  the same shell and table dashboard; server authorization exposes additional
  Manager panels and commands.
- Keep the existing public-menu application at `apps/web` and create the shared
  POS as the sibling workspace package `apps/pos`; do not nest two applications
  beneath the existing `apps/web` package.
- Staff and Manager may perform the basic POS workflow and view/print individual
  whole-order or settlement receipts. Only Manager may browse payment history,
  view accounting reports, configure product sale discounts, manage
  catalog/products and availability, manage Staff/settings, reverse settlements,
  or search the full audit history. Staff and Manager may both apply reasoned
  item/order discounts while settlement immutability permits them.
- Add a table-scoped waiter-call capability to the first shared POS stage. A
  hashed, rotatable QR credential grants waiter-call submission only for an
  eligible table that Staff or Manager has marked occupied. It grants no order,
  payment, receipt, tracking, or catalog authority.
- Keep one public menu at `/menu`. Eligible-table printouts use `/t/:token` to
  exchange the printed credential for a signed, HttpOnly 12-hour table-context
  cookie and then redirect to that same menu; they never select different menu
  content. Generic `/menu` visits have no waiter-call authority.
- Provision only tables `1` through `10` and `جگوار` through the operations
  command. PostgreSQL stores only the token hash and table relation; printable
  SVG/HTML and the plaintext URL manifest are generated once outside version
  control. Rotation is explicit and immediately invalidates the old printout.
- The dashboard uses `AVAILABLE` and `OCCUPIED` table states. An eligible-table
  QR scan while available produces a non-blocking occupancy reminder; it never
  marks the table occupied automatically. A customer call creates the table's
  one `PENDING` call and highlights its card. Opening that card acknowledges and
  resolves the call in one common Staff/Manager action; actor identity is not
  recorded for either handling step.
- Limit the first Manager report to one daily accounting summary for either the
  current or immediately previous `Asia/Tehran` calendar day.
- Treat the report window only as a query/UI boundary. Retain all orders, order
  items, settlements, tenders, reversals, and audit records in PostgreSQL; never
  delete history because it is older than the report window.

## Consequences

- The menu remains browse-only for commerce, but table scan/reminder and
  waiter-call are the only approved anonymous writes in the initial scope. Their
  controls are the opaque table credential, eligible-and-occupied-table
  validation for calls, and the one-pending-call rule.
- A copied physical QR is expected to be visible to guests but remains a
  narrowly scoped bearer capability. Hash-only storage, redacted logs,
  rate-limits, occupied-table validation, explicit rotation, 12-hour expiry,
  and invalidation whenever a table is made available limit reuse.
- Stage 5 includes a small backend migration/API increment before its shared POS
  interface can pass the exit gate.
- Product sale-discount configuration remains Manager-only, while reasoned
  item/order discount application remains part of the shared Staff/Manager POS
  workflow.
- Weekly/monthly and arbitrary-range reporting, exports, product/category/hour
  analytics, and forecasting remain deferred. They can be added later without a
  data migration because the complete transactional history is retained.
- A separate Manager frontend or duplicate Manager table dashboard would
  contradict this decision.
