# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Run Cafe Staff and Managers working during active cafe service. They use the
same operational application on desktop POS terminals and mobile devices,
often while interrupted and with occasional unstable connectivity. Their
immediate job is to understand the state of physical tables and take the next
correct action without hunting through screens. Landscape-specific tablet
layouts are future work, not a current Stage 7 target.

## Product Purpose

The shared Run Cafe POS is the staff-operated source for table service, order
entry, settlements, receipts, and waiter-call handling. Success in Stage 7 is
fast, safe operational work: a Staff member can read the table dashboard and
continue a service task with server-authoritative state, prices, and payment
rules.

## Positioning

One shared operational workspace serves both Staff and Managers, with one
physical-table dashboard and server-enforced role capability. It deliberately
does not split shared work into separate applications or duplicate business
logic in the interface.

## Operating Context

- The main workspace is the cafe's 16 physical tables, in this fixed order:
  `1`, `2`, `3`, `4`, `کانتر وسط`, `5`, `6`, `جگوار`, `7`, `8`, `سوشال`,
  `سوشال سوشال`, `9`, `10`, `11`, `12`.
- Staff begin table or takeaway orders, add catalog products/options,
  quantities, and notes, then use server-calculated totals.
- An `OPEN` order can be edited within settlement immutability rules: new items
  and unsettled quantities may change; settled quantities, posted tenders, and
  allocations do not.
- Staff and Managers record selected-item settlements with cash, card terminal,
  or card-to-card transfer tenders, including mixed tenders; they print concise
  bar tickets and detailed whole-order or settlement receipts.
- Table state includes availability, occupancy, active-order/payment state,
  expected release timing, non-blocking eligible-table QR scan reminders, and
  pending waiter calls. Opening a highlighted table acknowledges and resolves
  its pending waiter call.

## Capabilities and Constraints

- Persian RTL is the default operational language. Numbers, Toman money,
  dates, and status indicators must remain easy to parse.
- The interface must cover signed-in, connection/loading/retry/API-error,
  idempotent-retry, reconnect/refetch, stale-version-conflict, print
  success/failure, role-restricted, no-active-order, unavailable-product, QR
  occupancy-reminder, and pending-waiter-call states where relevant.
- The server remains authoritative for permissions, totals, idempotency, and
  conflicts; UI visibility never replaces authorization.
- Stage 7 includes no customer ordering, cart checkout, online payment,
  customer order tracking, customer identity, or QR credential management.
- Stage 7 includes no Manager-only payment history, reports, catalog/product
  management, Staff management, settings, audit search, or product sale
  discount configuration.
- Staff and Managers may apply reasoned item-level or order-level discounts
  only when server settlement rules permit them.
- An order may be logically deleted/cleared with confirmation appropriate to
  its operational consequence; the interface must not imply physical erasure.

## Brand Commitments

Run Cafe POS is calm, fast to scan, and low in cognitive load under pressure.
It uses large reliable touch targets and practical keyboard interaction. Its
light, warm Run Cafe identity uses cream surfaces, dark readable text, and a
restrained amber accent; contrast, hierarchy, and operational status clarity
take priority. Avoid marketing heroes, decorative dashboards, glassmorphism,
excessive rounding, tiny type, and distracting animation.

## Evidence on Hand

- POS application foundation: `app/layout.tsx`, `app/page.tsx`, and
  `app/globals.css`.
- Local operational setup and same-origin API policy: `SETUP.md` and
  `next.config.ts`.
- Authoritative product rules and Stage 7 boundaries:
  `../../docs/planning/scope.md`, `../../docs/planning/roadmap.md`, and
  `../../docs/current-left.md`.
- The API/backend has already established order, settlement, receipt,
  authorization, concurrency, table-occupancy, and waiter-call behavior; the
  shared POS UI is the remaining Stage 7 interface work.

## Product Principles

- Put the next operational action within immediate reach of the table state.
- Preserve server truth visibly, especially for money, settlement boundaries,
  conflicts, and permissions.
- Keep Staff and Manager shared work in one coherent operational surface.
- Make interruption, retry, and recovery states understandable without hiding
  consequential information.
- Prefer calm, legible operational clarity over decoration.

## Accessibility & Inclusion

Support deliberate Persian RTL operation; legible type; high-contrast state and
status communication; large touch targets; keyboard-practical workflows; and
non-color-only indicators for critical table, payment, and connection states.
