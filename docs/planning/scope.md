# Café Management System Scope

## Document Control

**Status:** implementation baseline  
**Primary stack:** TypeScript, Node.js, Fastify, PostgreSQL, Prisma, Next.js  
**Initial operating model:** one café, one branch, one source of truth  
**Baseline date:** 28 July 2026  
**Decision status:** baseline decisions are fixed unless replaced by an Architecture Decision Record (ADR).

This document owns product scope, business rules, architecture boundaries, and fixed v1 decisions. Delivery sequence lives in `roadmap.md`; backend tasks live in `backend-backlog.md`; production readiness lives in `production-gates.md`.

## Executive Summary

The project is an integrated café operations platform with two applications: a public digital menu and one shared POS application. Staff and Manager users sign in to the same POS, use the same table dashboard, and receive additional panels and actions according to their server-enforced role. Both applications share one backend, one PostgreSQL database, and one set of business rules.

The v1 system is intentionally simple: staff create every order; customers can browse the QR menu but cannot send an order. This lets the first production release concentrate on reliable POS operation, correct prices and payments, and a clean audit trail before customer self-ordering is introduced.

Product goals:

- Keep the menu, POS, and administration data synchronized.
- Make routine staff order entry fast and resistant to mistakes.
- Make prices, discounts, payments, and state changes authoritative on the server.
- Provide useful daily sales and operational reporting without manual reconciliation.
- Remain maintainable by one developer while leaving clear extension points for later features.

v1 success criteria:

- A Staff user can create a table or takeaway order, print a concise bar ticket for preparation, settle selected items with cash, card-terminal, or card-to-card transfer tenders, print a detailed customer receipt, and logically delete an order when required.
- A customer can scan a table-specific QR code, browse the current menu on a phone, and send a waiter-call for that table. They cannot create, submit, pay for, or track an order in v1.
- A product-price change never changes the price on a historical order or receipt.
- A retry cannot create duplicate orders, settlements, or tender records.
- Two simultaneous POS edits do not silently overwrite each other.
- The database can be restored from a tested backup and the application can be rolled back or forward-fixed after a failed release.

## Product Boundaries

| Area           | Baseline decision                                                                                                                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Business scope | One café and one branch. Multi-tenant SaaS behavior is outside v1.                                                                                                                                                                     |
| Roles          | Only Manager and Staff exist. Both use one POS application and one table dashboard; Manager-only capabilities are revealed by authorization rather than a separate application.                                                      |
| Customers      | Customers are anonymous menu viewers in v1. A table-scoped QR credential may authorize only a waiter-call for an eligible, occupied table; there are no customer accounts, guest-order sessions, or self-ordering endpoints. |
| Currency       | Every amount is an integer count of **Toman**. Floating-point values and Rial conversion are forbidden.                                                                                                                                |
| Time           | Store timestamps in UTC. Display timestamps and calculate calendar-day reports in `Asia/Tehran`.                                                                                                                                       |
| Ordering       | Every v1 order is created by a logged-in Staff user through POS.                                                                                                                                                                       |
| Payments       | Staff record one or more cash, card-terminal, or card-to-card transfer tenders per settlement. A settlement can cover selected order-item quantities, and split tender is allowed. There is no online payment or terminal integration. |
| Prices         | Each catalog price is already the finished price. There are no taxes or service charges.                                                                                                                                               |
| Receipts       | v1 uses print-friendly browser bar tickets and customer receipts. Silent ESC/POS printing and printer control are separate integrations.                                                                                               |
| Deployment     | One Iranian VPS hosts one authoritative application/database stack. There is no dual writable cloud/local setup.                                                                                                                       |

User-facing surfaces:

| Surface      | Primary user     | v1 purpose                                                                                                                                                                                                                                                  |
| ------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Digital Menu | Customer         | Browse the menu, categories, item details, priced item options, current availability, and final Toman prices; from a table-scoped QR context, send a waiter-call. Preparation timing remains internal to POS. No cart submission, payment, or order tracking. |
| Shared POS   | Staff, Manager   | Use one table dashboard for orders, payments, waiter-calls, deletion, and receipts. Manager authorization additionally exposes accounting, payment-history, discount, catalog, Staff-account, settings, and audit capabilities.                             |

Explicit non-goals for v1:

- Customer self-ordering, customer carts submitted to the café, table-order authority, guest order tracking, customer accounts, loyalty, wallets, coupons, and marketing automation. The table-scoped waiter-call credential is not order or payment authority.
- Inventory, recipes, ingredient deduction, waste, suppliers, and purchase orders.
- Reservations, multi-branch management, multi-tenancy, franchise reporting, and third-party delivery synchronization.
- Online payments, direct card-terminal control, automatic refunds, and accounting integrations.
- Tax, VAT, service-charge, or item-level tax calculation.
- Full offline synchronization, a café-local authoritative server, or conflict resolution between two writable databases.
- Native mobile apps, advanced forecasting, automatic printer routing, and a CDN requirement.

Scope rule: a future feature may influence a clean module boundary, but it must not add tables, abstractions, services, or infrastructure to v1 unless a current v1 use case needs it.

## Actors, Permissions, And Workflows

There are no application roles beyond Manager and Staff in v1. Both roles use the same POS application and table dashboard. A Manager receives additional server-authorized capabilities; this is not a separate Manager application or a second implementation of POS business rules.

| Capability                                                                  | Staff | Manager |
| --------------------------------------------------------------------------- | :---: | :-----: |
| Sign in and use POS                                                         |  Yes  |   Yes   |
| Create and edit `OPEN` orders before they are deleted                       |  Yes  |   Yes   |
| Assign or move a table on an open order                                     |  Yes  |   Yes   |
| Record a cash, card-terminal, or card-to-card transfer settlement           |  Yes  |   Yes   |
| Delete an order, including an already-paid order, without a required reason |  Yes  |   Yes   |
| Print/reprint receipts                                                      |  Yes  |   Yes   |
| View and handle active waiter-calls in the shared table dashboard           |  Yes  |   Yes   |
| Browse accounting payment history                                           |  No   |   Yes   |
| View the initial daily report for today or yesterday                         |  No   |   Yes   |
| Apply a reasoned item-level or order-level discount while permitted          |  Yes  |   Yes   |
| Configure or remove a catalog product sale discount                          |  No   |   Yes   |
| Manage categories, products, options, images, prices, and availability      |  No   |   Yes   |
| Manage Staff accounts and role assignment                                   |  No   |   Yes   |
| Change café settings                                                        |  No   |   Yes   |
| View full audit history                                                      |  No   |   Yes   |

Authorization is enforced by permissions in routes and service methods, not only by hiding buttons. Since v1 has only two roles, the initial permission set can be simple and explicit rather than over-designed.

v1 staff-created order flow:

1. A Staff user selects the order type: table or takeaway.
2. They add products, options, quantities, and notes in POS.
3. The server validates availability and calculates all totals from current catalog data.
4. The server creates the order with state `OPEN`, payment status `UNPAID`, and snapshots the item names and finished Toman prices.
5. For each payer checkout, Staff selects one or more order-item quantities and records one or more cash, card-terminal, or card-to-card transfer tenders as one settlement. The server calculates the settlement amount from the selected items.
6. The payment status is `PARTIALLY_PAID` until active settlements cover every item quantity, then becomes `PAID`. The order remains `OPEN` until it is cleared from the active table/POS list.
7. While the order remains `OPEN`, Staff may add new items, increase item quantities, or adjust only unsettled item quantities. Settled item quantities and their posted settlement allocations remain immutable. Adding items to a `PAID` order changes it back to `PARTIALLY_PAID` until the new balance is settled.
8. If the order must be removed from the active table/POS list, Staff chooses `DELETED`. This is a logical deletion; historical financial and audit records remain preserved. No deletion reason is required.

v1 order states:

| State     | Meaning                                                                                                              | Allowed next action                                                                                                                                                                                                                                                                                         |
| --------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPEN`    | Staff has registered the order. Its payment status may be `UNPAID`, `PARTIALLY_PAID`, or `PAID`.                     | Update the same order in place by adding items, increasing quantities, adjusting only unsettled quantities, transferring table, or settling selected unallocated item quantities. As a separate action, Staff may mark the order `DELETED`. Settled quantities and posted settlement records are immutable. |
| `DELETED` | The order was removed from active work, with or without settlement. It is never physically erased from the database. | No normal transition. A settlement reversal is an audited Manager action, not a silent rewrite.                                                                                                                                                                                                             |

v1 payment statuses:

| Payment status   | Meaning                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| `UNPAID`         | No active settlement has allocated any order-item quantity.                                                 |
| `PARTIALLY_PAID` | One or more item quantities are allocated to active settlements, but one or more remain unsettled.          |
| `PAID`           | Active settlements allocate every order-item quantity and their total equals the final order total exactly. |

`DELETED` does not mean database deletion. A paid order must remain reportable and reconcilable; every deleted order must retain an audit record showing who deleted it and when. A deletion reason is optional and is not required for a paid order.

Future customer table ordering is post-v1 only. When this phase begins, write an ADR and state table before implementation. Customer submission requires dedicated rate limiting, idempotency, table validation, and safe public tokens.

Corrections and exceptional flows:

- The server recalculates totals; the POS never supplies an authoritative total.
- A same-key retry returns the original order/payment result rather than creating another record.
- Each delete action is audited with its actor and timestamp. A deletion reason is optional; Staff and Manager have the same authority to delete an order at any payment status. A Manager must reverse an entire posted settlement with a reason; posted tenders and allocations are never edited.
- A stale POS update receives a clear conflict response rather than silently overwriting a newer edit.

## MVP V1 Definition

| Capability             | Required v1 behavior                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundation             | Environment validation, database migrations, seed/bootstrap flow, structured errors, request IDs, logging, health/readiness endpoints.                                                                                                                                                                                                                                                                                          |
| Authentication         | Staff login, secure sessions, logout, account deactivation, and Manager/Staff authorization.                                                                                                                                                                                                                                                                                                                                    |
| Catalog                | Categories, products, options, images, display order, Manager-controlled product sale discounts, final Toman price, active state, temporary availability, and product preparation-deadline minutes.                                                                                                                                                                                                                             |
| POS order entry        | Table/takeaway orders; quantities, options, notes, server totals, controlled edits while `OPEN`, logical deletion, and order history.                                                                                                                                                                                                                                                                                           |
| Table operations       | Assign, transfer, view active orders with estimated table release time, mark tables occupied or available, receive QR-scan occupancy reminders, and acknowledge/resolve eligible-table waiter-calls by opening the highlighted table in the shared dashboard. No order or table split/merge. |
| Customer menu          | Mobile-first QR menu for browse/search/category filtering, priced item options, current availability, final Toman price, and a table-scoped waiter-call action. Preparation deadlines are not displayed to customers. No checkout or order submission.                                                                                                                                                                                                                              |
| Payments               | Per-payer settlements for selected item quantities, each with one or more manual cash, card-terminal, or card-to-card transfer tenders; split tender, item allocation, total-paid calculation, optional card-to-card transfer references, and audit trail. No online payments.                                                                                                                                                  |
| Discounts              | Only a Manager may configure or remove a fixed or percentage sale discount on a catalog product. Staff and Manager may apply a fixed or percentage discount with a required reason to an order item or whole order while settlement immutability permits it. There are no taxes or service charges.                                                                                                                         |
| Receipts               | Print-friendly HTML has two variants: a concise bar ticket with the order number, local time, table/takeaway context, item quantities, selected options, and notes; and a detailed customer receipt (whole-order or payer-settlement) with item snapshots, Toman totals, tender summary where applicable, order number, and `Asia/Tehran` display time. The bar ticket excludes prices, discounts, totals, and payment details. |
| Reports                | One Manager-only daily accounting report for either the current `Asia/Tehran` calendar day or the immediately previous day. The report window does not limit storage retention.                                                                                                                                                                                                                                                  |
| Manager capabilities   | Role-gated panels inside the shared POS for payment history, discounts, catalog, product preparation deadlines, table seating limits, availability, Staff accounts, settings, the daily report, and audit log.                                                                                                                                                                                                                   |
| Quality and operations | Critical tests, OpenAPI documentation, Docker deployment, HTTPS, backups, restore test, monitoring, and release rollback/forward-fix.                                                                                                                                                                                                                                                                                           |

Pilot acceptance scenarios:

- Create a normal takeaway order, print its concise bar ticket, settle it with cash, and print its customer receipt.
- Create and transfer a table order, then settle selected items for one payer with both cash and card-terminal tenders.
- Create a table order for multiple customers; print the bar ticket, settle each customer’s selected item quantities separately, including a card-to-card transfer, and print each customer settlement receipt.
- Delete an `UNPAID` order and a `PAID` order; verify that neither is physically removed and both have an actor and timestamp in audit history. Verify that Staff can delete the paid order without providing a reason.
- Change a product price and confirm that an earlier bar ticket and customer receipt remain unchanged.
- Retry an order or settlement request and confirm that only one result exists.
- Use two POS terminals to edit the same `OPEN` order and confirm that stale data receives a conflict response. Confirm that after a partial settlement, new items can be added while settled item quantities and posted settlement records cannot be rewritten.
- Restart the application during a busy workflow and confirm clients recover state from the API.
- Scan an eligible table QR before the table is marked occupied and confirm the shared dashboard shows an occupancy reminder. Mark it occupied, send a waiter-call, confirm the table is highlighted in the dashboard, then open that table to acknowledge and resolve the call without granting the customer order or payment authority.
- Confirm a Manager can open today’s and yesterday’s daily reports while Staff cannot; confirm older orders and payments remain stored and available to authorized history/receipt workflows.
- Restore a backup into a clean environment and run the critical smoke tests.

## Domain Model And Business Rules

| Module     | Owns                                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Identity   | Users, credentials, sessions, Manager/Staff role, permissions, authentication events.                                         |
| Catalog    | Categories, products, images, option groups/options, availability, preparation deadlines, and display order.                  |
| Ordering   | Orders, order items, price/preparation snapshots, notes, channel, lifecycle state, payment status, and idempotency.           |
| Tables     | Physical-table order and labels, seating limits, waiter-call eligibility, current occupancy state, QR-scan occupancy reminders, active table estimates, assignment/clearing of active orders, table QR credentials, and waiter-call lifecycle. |
| Payments   | Settlements, tender entries, item-quantity allocations, settlement reversal policy, order numbering, and balance calculation. |
| Reporting  | Manager-only payment history and the bounded today/yesterday daily accounting query over retained committed data.             |
| Operations | Café settings, audit logs, system health, and operational metadata.                                                           |

Money, pricing, and tax rules:

- The database stores money as signed-safe integer Toman values. It never stores Rial or floating-point money.
- Product and option prices are final customer prices before any active Manager-configured product sale discount. No tax, VAT, service charge, or tax calculation exists in v1.
- A product sale discount is configured only by a Manager and applies to new order-item snapshots only; changing or removing it never changes historical orders. Staff and Manager may apply order-item or order-level discounts while the order is open, with a non-empty reason and subject to settlement immutability.
- The backend is the only authority for unit price, option price, discount, line total, grand total, settlement total, paid total, and balance.
- Each order item stores a snapshot of product name, base price, product preparation-deadline minutes, selected options and their prices, quantity, discount allocation, and final line total.
- Each product has a Manager-configurable preparation deadline in minutes. Order items snapshot this value so old bar tickets and table estimates do not change after catalog edits.
- Historical orders never recalculate from the current catalog. Referenced products are archived, not hard-deleted.
- Rounding and discount allocation rules are tested pure functions before UI work begins.

Payment, deletion, integrity, and audit rules:

- An order has zero or more posted settlements. Each settlement belongs to one payer checkout without creating a customer account or retaining payer identity.
- A settlement selects one or more unallocated order-item quantities. The server calculates its amount from immutable item snapshots and deterministic discount allocation; a selected quantity cannot be allocated more than once across active settlements.
- Each settlement has one or more tender records. The supported methods are `CASH`, `CARD_TERMINAL`, and `CARD_TRANSFER`; their amounts must sum exactly to the settlement amount. Card-terminal payments are manually entered on the physical terminal and are not synchronized with the application, so they store no reconciliation reference. Card-to-card transfer references are optional.
- A settlement request is idempotent as one atomic command. Creating it, inserting tenders and allocations, recalculating the order payment status/balance, incrementing the order version, and writing audit entries occur in one transaction.
- A settlement reversal recalculates the order payment status/balance, increments the order version, and writes its audit entry in one transaction.
- `UNPAID`, `PARTIALLY_PAID`, and `PAID` are derived from active settlement allocations and persisted on the order for efficient POS reads. Overpayment and an unallocated tender balance are forbidden.
- Order content and table assignment can be edited while the order state is `OPEN`. After the first settlement, edits are constrained to adding new items, increasing quantities, adjusting only quantities that have not been allocated to a settlement, item notes for unsettled items, and table transfer. Settled item quantities, posted settlement allocations, tenders, and payer receipts are never rewritten. Order-level discount changes are allowed only before the first settlement because they affect allocation math.
- Posted settlements, tenders, and allocations are not edited or physically deleted. A Manager corrects a mistake by reversing the entire settlement with a reason, then records a replacement settlement; this action is audited.
- Marking an order `DELETED` preserves the order, its items, settlements, tenders, reversals, and audit history. Reports can include or exclude deleted orders explicitly; they must never disappear accidentally.
- Database constraints enforce positive quantities, non-negative prices/discounts, valid states, unique identifiers, foreign keys, and required price snapshots.
- Every multi-record order or settlement operation runs in a PostgreSQL transaction.
- An order version field or equivalent compare-and-swap condition prevents lost updates between terminals.
- Idempotency records bind a key to actor/session, operation, request fingerprint, result, and expiration policy. They protect order creation and settlement recording.
- WebSocket notifications occur only after a committed transaction. Reconnecting clients fetch the API state because notifications may be missed.
- Products, categories, users, and tables are deactivated or archived when referenced by history.
- Orders, settlements, tenders, settlement reversals, and audit logs are retained; normal application actions never hard-delete them.
- Audit entries record actor, request ID, operation, entity, safe before/after fields, timestamp, and any provided reason. They exclude passwords, tokens, cookies, and unnecessary personal data.
- A bar ticket is an operational order view: it includes only the order number, `Asia/Tehran` display time, table/takeaway context, item quantities, item and option snapshots, and item notes needed for preparation. It excludes all prices, discounts, totals, payment/settlement details, and audit or staff identity data.
- A customer receipt is a detailed financial view. A whole-order customer receipt shows the order's item snapshots and current active-settlement summary; a payer-settlement customer receipt additionally scopes items and tenders to that settlement. Both retain the established Toman totals, tender summary where applicable, order number, and `Asia/Tehran` display time.

Table timing rules:

- Each physical table has a configurable seating-limit minutes value. The initial default is 45 minutes, stored in configuration/data rather than embedded in POS UI code.
- When a table order is created, the order snapshots the effective seating limit for that table. A later settings or table-limit change does not silently rewrite the estimate for an existing order.
- An order's estimated preparation minutes are the maximum preparation-deadline snapshot across its order items. This keeps v1 independent of kitchen capacity or station scheduling, which are outside scope.
- A table order's estimated release time is `order.createdAt + tableSeatingLimitSnapshotMinutes + estimatedPreparationMinutes`. The POS table interface can use this server-derived value to show expected table availability.

Waiter-call rules:

- The initial physical-table order is: `1`, `2`, `3`, `4`, `کانتر وسط`, `5`, `6`, `جگوار`, `7`, `8`, `سوشال`, `سوشال سوشال`, `9`, `10`, `11`, `12`. Only numeric tables `1` through `10`, plus `جگوار`, may receive waiter-calls: `1`, `2`, `3`, `4`, `5`, `6`, `جگوار`, `7`, `8`, `9`, `10`. `کانتر وسط`, `سوشال`, `سوشال سوشال`, `11`, and `12` never expose a waiter-call action.
- A table has the operational states `AVAILABLE` and `OCCUPIED`. Staff and Manager have the same authority to mark either state; the system does not assign acknowledgement or resolution to a particular person.
- When a customer scans an eligible table QR while that table is `AVAILABLE`, the dashboard receives a non-blocking occupancy reminder. The scan does not create an order, change the table to occupied, or expose any customer identity. Staff or Manager must explicitly mark the table `OCCUPIED`.
- A waiter-call may be submitted only from an eligible, occupied table. Submission creates or returns that table's one `PENDING` call and highlights the table in the shared POS dashboard. This is the customer's terminal state: the customer sees only that the request was sent.
- Opening/clicking the highlighted table in the shared POS acknowledges and resolves the pending call in one staff action, returns the table card to its normal `OCCUPIED` state, and retains the call as history. The acknowledgement/resolution records timestamps but no responsible-user foreign keys.
- The opaque QR credential is stored only as a hash and is never logged. Repeated taps are deduplicated by the one-pending-call database rule.

## Application Architecture

The system begins as a modular monolith. It keeps feature boundaries and strong transactions without microservice deployment overhead.

```text
 Digital Menu          Shared POS (Staff + Manager panels)
      ↓                              ↓
 Menu Next.js app              POS Next.js app
               ↘              ↙
        Fastify modular monolith (REST + WebSockets)
                         ↓
              PostgreSQL — source of truth
                         ↓
              Product image storage
```

Deployment units:

- One Fastify API process owns business rules, persistence, authentication, OpenAPI, and WebSocket notifications.
- One Next.js menu application provides the anonymous digital menu.
- One separate Next.js POS application provides a single shared shell for both Staff and Manager. They use the same operational routes and table dashboard; role-gated Manager routes/panels extend that shell rather than forming another application.
- PostgreSQL is the transactional source of truth.
- Local/self-hosted image storage holds product images; the database stores metadata and references.
- Caddy or Nginx terminates HTTPS and proxies web, API, and WebSocket traffic.
- Redis and background jobs are not required for the first single-instance deployment.

Recommended monorepo shape:

```text
apps/
  api/          # Fastify modular monolith
  web/          # Next.js public digital menu
  pos/          # Next.js shared Staff/Manager POS
packages/
  contracts/    # Zod DTO schemas and API types
  config/       # shared lint, TypeScript, test configuration
  ui/           # add only when reuse exists
```

Keep the existing `apps/web` package as the deployed public-menu application
and add `apps/pos` as a sibling workspace package named `@cafe/pos`. Do not turn
`apps/web` into a container holding nested `menu` and `pos` packages; it is
already an application package and is referenced by the current menu build,
tests, Docker image, and release workflow.

Backend and API rules:

- Do not expose Prisma models as API contracts. API DTO schemas are public contracts; persistence models stay internal to the backend.
- Use feature modules such as `orders`, `catalog`, `payments`, and `identity` with route/controller/service/repository/schema boundaries.
- Use versioned REST endpoints under `/api/v1` and named commands for business actions, such as `record-settlement` and `delete-order`.
- Use consistent pagination, filtering, sorting, error codes, and request IDs.
- Require idempotency keys for order creation and settlement recording.
- Return a conflict response for stale order versions; do not use silent last-write-wins behavior.

Frontend and operational UX:

- Use React, Next.js, TypeScript, Tailwind CSS, TanStack Query, React Hook Form, and Zod.
- Use Zustand only for small transient state such as an unsaved POS draft. Persisted business truth remains on the server.
- The digital menu is mobile-first and browse-only for commerce. It displays final Toman prices, priced item options, and current availability without a customer-facing availability-only toggle or preparation timing, and without exposing checkout, payment, or order-tracking controls. A table-scoped QR context may expose only the waiter-call action.
- The shared POS shows connection state, stale-data conflicts, open/deleted state, `UNPAID`/`PARTIALLY_PAID`/`PAID` status, settlement totals, active waiter-calls, and the actor responsible for privileged actions.
- Staff receipt viewing/printing is an operational order capability. It must not expose the Manager-only payment-history browser, accounting report, or audit search.
- Browser printing is the v1 receipt boundary. Validate the actual café printer and paper size before pilot.

Authentication, authorization, and security:

- Staff and Manager use short-lived access tokens with rotated, revocable refresh sessions. Store refresh tokens hashed at rest.
- Use secure HTTP-only cookies where the deployment origin permits, with CSRF protection through SameSite policy, origin checks, and a CSRF token when needed.
- Bootstrap the first Manager as a one-time deployment procedure, never as a permanent public registration route.
- Enforce Manager-only product sale-discount configuration, catalog, payment-history, user, settings, reporting, and full-audit operations server-side. Staff and Manager may apply reasoned item/order discounts through the shared POS while settlement rules permit them. Hiding panels in the shared POS is not sufficient authorization.
- Require HTTPS, security headers, least-privilege database credentials, secret management, request-size limits, rate-limited login, and safe logging.
- Normal QR-menu browsing is public and read-only. A table QR credential grants only the narrowly scoped QR-scan reminder and eligible-occupied-table waiter-call capabilities; it never grants order, receipt, or payment authority.
- Uploaded images are type-checked, size-limited, renamed, and never executed.

Reporting and audit:

- The first POS reporting implementation contains one Manager-only daily accounting report. The Manager may select only `today` or `yesterday` using `Asia/Tehran` calendar boundaries; arbitrary ranges, weekly/monthly reports, exports, product/category analytics, and forecasting are deferred.
- The daily report distinguishes gross item totals, discounts, active settled/paid amounts by payment method, reversed settlements, and logically deleted orders. There are no tax or service-charge fields.
- Manager-only payment history is a separate cursor-paginated operational view over retained settlements and receipts; it is not available to Staff. Staff may still open and print an individual whole-order or payer-settlement receipt through authorized POS order workflows.
- The two-day report window is never a retention policy. Orders, order items, settlements, tenders, reversals, receipts derived from snapshots, and audit records remain in PostgreSQL and are not deleted when they become older than yesterday.
- The daily report queries transactional tables, is verified against known fixtures, and receives supporting indexes based on measured query plans. The two permitted day windows keep reporting bounded so it cannot degrade POS work.

## Technology Baseline

| Concern              | Choice                                                 | Boundary                                                                               |
| -------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Language/runtime     | TypeScript on current Active LTS Node.js               | Strict compiler settings; runtime pinned in repository.                                |
| Backend              | Fastify                                                | Plugin-oriented HTTP/WebSocket host with structured logging and validated contracts.   |
| Validation/contracts | Zod plus generated OpenAPI                             | Runtime validation at boundaries; ORM types remain internal.                           |
| Database             | PostgreSQL                                             | Authoritative transactions, constraints, reporting, and concurrency control.           |
| Database toolkit     | Prisma                                                 | Migrations and normal data access; repositories; parameterized raw SQL when justified. |
| Frontend             | React, Next.js, Tailwind CSS                           | One web deployment with separate menu, POS, and Manager routes.                        |
| Client data          | TanStack Query, React Hook Form, Zod, optional Zustand | Server state is not duplicated in a global client store.                               |
| Testing              | Vitest plus browser E2E tooling                        | Real PostgreSQL integration tests and a small critical browser suite.                  |
| Storage              | Self-hosted image storage                              | Product images only; PostgreSQL stores metadata and references.                        |
| Operations           | Docker Compose and Caddy or Nginx                      | Single VPS/app instance initially; Redis/job queue only after measured need.           |

## Final Objective

The first release should be a trustworthy staff-operated café system, not merely a large codebase. It succeeds when the café can use it under real conditions and its order, payment, and operational history remain correct after retries, concurrent edits, price changes, logical deletion, deployments, and restores.

The guiding principle is simple: finish and verify the authoritative backend first, build each interface against its stable contract, and expand only after the existing production path is correct.
