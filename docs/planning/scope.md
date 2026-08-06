# Café Management System Scope

## Document Control

**Status:** implementation baseline  
**Primary stack:** TypeScript, Node.js, Fastify, PostgreSQL, Prisma, Next.js  
**Initial operating model:** one café, one branch, one source of truth  
**Baseline date:** 28 July 2026  
**Decision status:** baseline decisions are fixed unless replaced by an Architecture Decision Record (ADR).

This document owns product scope, business rules, architecture boundaries, and fixed v1 decisions. Delivery sequence lives in `roadmap.md`; backend tasks live in `backend-backlog.md`; production readiness lives in `production-gates.md`.

## Executive Summary

The project is an integrated café operations platform with three task-focused surfaces: a public digital menu, a Staff POS, and a Manager administration area. They share one backend, one PostgreSQL database, and one set of business rules.

The v1 system is intentionally simple: staff create every order; customers can browse the QR menu but cannot send an order. This lets the first production release concentrate on reliable POS operation, correct prices and payments, and a clean audit trail before customer self-ordering is introduced.

Product goals:

- Keep the menu, POS, and administration data synchronized.
- Make routine staff order entry fast and resistant to mistakes.
- Make prices, discounts, payments, and state changes authoritative on the server.
- Provide useful daily sales and operational reporting without manual reconciliation.
- Remain maintainable by one developer while leaving clear extension points for later features.

v1 success criteria:

- A Staff user can create a table or takeaway order, print a concise bar ticket for preparation, settle selected items with cash, card-terminal, or card-to-card transfer tenders, print a detailed customer receipt, and logically delete an order when required.
- A customer can scan a QR code and browse the current menu on a phone. They cannot create, submit, pay for, or track an order in v1.
- A product-price change never changes the price on a historical order or receipt.
- A retry cannot create duplicate orders, settlements, or tender records.
- Two simultaneous POS edits do not silently overwrite each other.
- The database can be restored from a tested backup and the application can be rolled back or forward-fixed after a failed release.

## Product Boundaries

| Area           | Baseline decision                                                                                                                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Business scope | One café and one branch. Multi-tenant SaaS behavior is outside v1.                                                                                                                                                                     |
| Roles          | Only Manager and Staff exist. Staff performs POS work.                                                                                                                                                                                 |
| Customers      | Customers are anonymous menu viewers in v1. There are no customer accounts, guest-order sessions, or self-ordering endpoints.                                                                                                          |
| Currency       | Every amount is an integer count of **Toman**. Floating-point values and Rial conversion are forbidden.                                                                                                                                |
| Time           | Store timestamps in UTC. Display timestamps and calculate calendar-day reports in `Asia/Tehran`.                                                                                                                                       |
| Ordering       | Every v1 order is created by a logged-in Staff user through POS.                                                                                                                                                                       |
| Payments       | Staff record one or more cash, card-terminal, or card-to-card transfer tenders per settlement. A settlement can cover selected order-item quantities, and split tender is allowed. There is no online payment or terminal integration. |
| Prices         | Each catalog price is already the finished price. There are no taxes or service charges.                                                                                                                                               |
| Receipts       | v1 uses print-friendly browser bar tickets and customer receipts. Silent ESC/POS printing and printer control are separate integrations.                                                                                               |
| Deployment     | One Iranian VPS hosts one authoritative application/database stack. There is no dual writable cloud/local setup.                                                                                                                       |

User-facing surfaces:

| Surface        | Primary user | v1 purpose                                                                                                                                 |
| -------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Digital Menu   | Customer     | Browse the menu, categories, item details, options, availability, and final Toman prices. No cart submission or order tracking.            |
| POS            | Staff        | Create and edit table or takeaway orders, assign tables where applicable, register payment, logically delete an order, and print receipts. |
| Administration | Manager      | Manage catalog, Staff accounts, settings, reports, and audit history.                                                                      |

Explicit non-goals for v1:

- Customer self-ordering, customer carts submitted to the café, table-order QR security, guest order tracking, customer accounts, loyalty, wallets, coupons, and marketing automation.
- Inventory, recipes, ingredient deduction, waste, suppliers, and purchase orders.
- Reservations, multi-branch management, multi-tenancy, franchise reporting, and third-party delivery synchronization.
- Online payments, direct card-terminal control, automatic refunds, and accounting integrations.
- Tax, VAT, service-charge, or item-level tax calculation.
- Full offline synchronization, a café-local authoritative server, or conflict resolution between two writable databases.
- Native mobile apps, advanced forecasting, automatic printer routing, and a CDN requirement.

Scope rule: a future feature may influence a clean module boundary, but it must not add tables, abstractions, services, or infrastructure to v1 unless a current v1 use case needs it.

## Actors, Permissions, And Workflows

There are no application roles beyond Manager and Staff in v1. A person’s real-world job title does not determine application permissions; the POS uses the **Staff** role.

| Capability                                                                  | Staff | Manager |
| --------------------------------------------------------------------------- | :---: | :-----: |
| Sign in and use POS                                                         |  Yes  |   Yes   |
| Create and edit `UNPAID` open orders                                        |  Yes  |   Yes   |
| Assign or move a table on an open order                                     |  Yes  |   Yes   |
| Record a cash, card-terminal, or card-to-card transfer settlement           |  Yes  |   Yes   |
| Delete an order, including an already-paid order, without a required reason |  Yes  |   Yes   |
| Print/reprint receipts                                                      |  Yes  |   Yes   |
| Manage categories, products, options, images, prices, and availability      |  No   |   Yes   |
| Manage Staff accounts and role assignment                                   |  No   |   Yes   |
| Change café settings                                                        |  No   |   Yes   |
| View reports and full audit history                                         |  No   |   Yes   |

Authorization is enforced by permissions in routes and service methods, not only by hiding buttons. Since v1 has only two roles, the initial permission set can be simple and explicit rather than over-designed.

v1 staff-created order flow:

1. A Staff user selects the order type: table or takeaway.
2. They add products, options, quantities, and notes in POS.
3. The server validates availability and calculates all totals from current catalog data.
4. The server creates the order with state `OPEN`, payment status `UNPAID`, and snapshots the item names and finished Toman prices.
5. For each payer checkout, Staff selects one or more order-item quantities and records one or more cash, card-terminal, or card-to-card transfer tenders as one settlement. The server calculates the settlement amount from the selected items.
6. The payment status is `PARTIALLY_PAID` until active settlements cover every item quantity, then becomes `PAID`. The order remains `OPEN` until it is cleared from the active table/POS list.
7. If the order must be removed from the active table/POS list, Staff chooses `DELETED`. This is a logical deletion; historical financial and audit records remain preserved. No deletion reason is required.

v1 order states:

| State     | Meaning                                                                                                              | Allowed next action                                                                                                   |
| --------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `OPEN`    | Staff has registered the order. Its payment status may be `UNPAID`, `PARTIALLY_PAID`, or `PAID`.                     | Settle selected unallocated item quantities; delete → `DELETED`; content/table edits are allowed only while `UNPAID`. |
| `DELETED` | The order was removed from active work, with or without settlement. It is never physically erased from the database. | No normal transition. A settlement reversal is an audited Manager action, not a silent rewrite.                       |

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
| Catalog                | Categories, products, options, images, display order, final Toman price, active state, temporary availability, and product preparation-deadline minutes.                                                                                                                                                                                                                                                                        |
| POS order entry        | Table/takeaway orders; quantities, options, notes, server totals, controlled edits before settlement, logical deletion, and order history.                                                                                                                                                                                                                                                                                      |
| Table operations       | Assign, transfer, view active orders with estimated table release time, and clear table orders through the defined settlement/delete flow. No order or table split/merge.                                                                                                                                                                                                                                                       |
| Customer menu          | Mobile-first QR menu for browse/search/filter, availability, item options, preparation-deadline minutes, and final Toman price. No checkout or order submission.                                                                                                                                                                                                                                                                |
| Payments               | Per-payer settlements for selected item quantities, each with one or more manual cash, card-terminal, or card-to-card transfer tenders; split tender, item allocation, total-paid calculation, optional card-to-card transfer references, and audit trail. No online payments.                                                                                                                                                  |
| Discounts              | One permissioned order-level fixed or percentage discount with reason. There are no taxes or service charges.                                                                                                                                                                                                                                                                                                                   |
| Receipts               | Print-friendly HTML has two variants: a concise bar ticket with the order number, local time, table/takeaway context, item quantities, selected options, and notes; and a detailed customer receipt (whole-order or payer-settlement) with item snapshots, Toman totals, tender summary where applicable, order number, and `Asia/Tehran` display time. The bar ticket excludes prices, discounts, totals, and payment details. |
| Reports                | Daily/weekly/monthly sales, orders, average value, payment mix, item/category sales, discounts, deleted orders, and hourly sales.                                                                                                                                                                                                                                                                                               |
| Administration         | Catalog, product preparation deadlines, table seating limits, availability, Staff accounts, settings, reports, and audit log.                                                                                                                                                                                                                                                                                                   |
| Quality and operations | Critical tests, OpenAPI documentation, Docker deployment, HTTPS, backups, restore test, monitoring, and release rollback/forward-fix.                                                                                                                                                                                                                                                                                           |

Pilot acceptance scenarios:

- Create a normal takeaway order, print its concise bar ticket, settle it with cash, and print its customer receipt.
- Create and transfer a table order, then settle selected items for one payer with both cash and card-terminal tenders.
- Create a table order for multiple customers; print the bar ticket, settle each customer’s selected item quantities separately, including a card-to-card transfer, and print each customer settlement receipt.
- Delete an `UNPAID` order and a `PAID` order; verify that neither is physically removed and both have an actor and timestamp in audit history. Verify that Staff can delete the paid order without providing a reason.
- Change a product price and confirm that an earlier bar ticket and customer receipt remain unchanged.
- Retry an order or settlement request and confirm that only one result exists.
- Use two POS terminals to edit the same `UNPAID` order and confirm that stale data receives a conflict response. Confirm that an order cannot be edited after its first settlement.
- Restart the application during a busy workflow and confirm clients recover state from the API.
- Restore a backup into a clean environment and run the critical smoke tests.

## Domain Model And Business Rules

| Module     | Owns                                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Identity   | Users, credentials, sessions, Manager/Staff role, permissions, authentication events.                                         |
| Catalog    | Categories, products, images, option groups/options, availability, preparation deadlines, and display order.                  |
| Ordering   | Orders, order items, price/preparation snapshots, notes, channel, lifecycle state, payment status, and idempotency.           |
| Tables     | Physical tables, seating limits, active table estimates, and assignment/clearing of active orders.                            |
| Payments   | Settlements, tender entries, item-quantity allocations, settlement reversal policy, order numbering, and balance calculation. |
| Reporting  | Read-oriented sales queries and exports based on committed data.                                                              |
| Operations | Café settings, audit logs, system health, and operational metadata.                                                           |

Money, pricing, and tax rules:

- The database stores money as signed-safe integer Toman values. It never stores Rial or floating-point money.
- Product and option prices are final customer prices. No tax, VAT, service charge, or tax calculation exists in v1.
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
- Order content, discounts, and table assignment can be edited only while payment status is `UNPAID`. After the first settlement, Staff creates another order for additional items rather than rewriting allocation history.
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

## Application Architecture

The system begins as a modular monolith. It keeps feature boundaries and strong transactions without microservice deployment overhead.

```text
Digital Menu | Staff POS | Manager Admin
                 ↓
    Next.js web application (separate routes)
                         ↓
        Fastify modular monolith (REST + WebSockets)
                         ↓
              PostgreSQL — source of truth
                         ↓
              Product image storage
```

Deployment units:

- One Fastify API process owns business rules, persistence, authentication, OpenAPI, and WebSocket notifications.
- One Next.js application provides separate menu, POS, and admin routes with their own authorization/layouts.
- PostgreSQL is the transactional source of truth.
- Local/self-hosted image storage holds product images; the database stores metadata and references.
- Caddy or Nginx terminates HTTPS and proxies web, API, and WebSocket traffic.
- Redis and background jobs are not required for the first single-instance deployment.

Recommended monorepo shape:

```text
apps/
  api/          # Fastify modular monolith
  web/          # Next.js menu, POS, manager admin
packages/
  contracts/    # Zod DTO schemas and API types
  config/       # shared lint, TypeScript, test configuration
  ui/           # add only when reuse exists
```

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
- The digital menu is mobile-first, browse-only, and displays final Toman prices and current availability.
- The POS shows connection state, stale-data conflicts, open/deleted state, `UNPAID`/`PARTIALLY_PAID`/`PAID` status, settlement totals, and the actor responsible for privileged actions.
- Browser printing is the v1 receipt boundary. Validate the actual café printer and paper size before pilot.

Authentication, authorization, and security:

- Staff and Manager use short-lived access tokens with rotated, revocable refresh sessions. Store refresh tokens hashed at rest.
- Use secure HTTP-only cookies where the deployment origin permits, with CSRF protection through SameSite policy, origin checks, and a CSRF token when needed.
- Bootstrap the first Manager as a one-time deployment procedure, never as a permanent public registration route.
- Enforce Manager-only catalog, user, settings, full-report, and full-audit operations server-side.
- Require HTTPS, security headers, least-privilege database credentials, secret management, request-size limits, rate-limited login, and safe logging.
- QR menu URLs are public read-only URLs in v1. They do not grant table, order, or payment authority.
- Uploaded images are type-checked, size-limited, renamed, and never executed.

Reporting and audit:

- Initial reports include daily, weekly, and monthly sales; order count; average order value; sales by payment method, channel, hour, category, and product; discounts; settlement reversals; deleted orders; and table turnover when table timestamps are complete.
- Report boundaries use `Asia/Tehran` calendar days, weeks, and months, while stored timestamps remain UTC. The cafe is always open, so v1 has no configurable business-day cutoff.
- Report definitions explicitly distinguish item totals, discounts, active settlement amount, reversed settlement amount, paid amount, and deleted orders. There are no tax or service-charge fields.
- Initial reports query transactional tables and are verified against known fixtures. Add indexes based on measured query plans.
- Exports and large ranges are bounded so reporting cannot degrade POS work.

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
