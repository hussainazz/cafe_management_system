# Current Backend Stage Status

This file is the active completion checklist and current stage status for the backend phase. Check it for every related request.

## In Progress Stages

None.

## Completed Stages

### Stage 2 - POS Backend

Done:

- Staff and Manager username authentication, signed access sessions, rotating hashed refresh sessions, logout/logout-all revocation, account-deactivation revocation, and safe authentication-event recording.
- Shared Staff/Manager route guards and service-level Manager checks, with tested `401 AUTHENTICATION_REQUIRED` and `403 FORBIDDEN` responses.
- Staff/Manager-protected POS catalog and active-table reads, including current catalog availability, option/image metadata, table seating limits, and active-order release timing.
- Staff table/takeaway order creation with server-calculated Toman totals and timing, immutable product/option snapshots, active-table validation, atomic audit/idempotency records, and retry-safe results.
- Order list/detail reads and controlled `OPEN`-order edits, including optimistic version checks, table transfers, catalog-backed additions, restricted post-settlement edits, and audit records.
- Manager-configured product sale discounts plus reasoned Staff/Manager item and order discounts, all server-calculated and snapshotted for historical orders.
- Staff/Manager logical order deletion with optimistic version checks, optional reason, retained financial/history rows, actor/timestamp, and audit record.
- Per-payer selected-item settlement recording with mixed manual tenders, reconciliation, idempotency, version checks, payment-status updates, and audit records.
- Manager-only full settlement reversal with a required reason, immutable posted rows, recalculated payment status, version increment, and audit record.
- Print-ready bar-ticket, whole-order receipt, and payer-settlement receipt API data using immutable order snapshots and `Asia/Tehran` display time.
- Real-PostgreSQL POS backend integration coverage for permissions, idempotent retries, stale and invalid transitions, partial/paid order additions, settled-item immutability, unavailable products, historical snapshots, selected allocations, mixed tenders, optional card-transfer references, reversal, reconciliation, and transaction rollback.

Verified:

- `pnpm typecheck` passes.
- `pnpm --filter @cafe/api test` passes: 9 files and 39 tests.
- The Stage 2 exit gate is covered through authenticated API calls against real PostgreSQL without a frontend dependency.

### Stage 0 - Scope And Domain Baseline

Done:

- `docs/planning/scope.md` and `docs/planning/roadmap.md` define the v1 scope, explicit non-goals, roles, order states, money/time/deployment rules, domain modules, architecture direction, production gates, and database-first/POS-first roadmap.
- ADR files document the fixed major decisions.
- The initial ERD, API inventory, database constraints, request/response conventions, error envelope, pagination, idempotency, and concurrency are documented.
- `docs/planning/backend-backlog.md` converts the approved scope into a prioritized backend backlog with acceptance criteria.

### Stage 1 - Database And Backend Foundation

Done:

- Database schema, reviewed Prisma migrations, and a Docker Compose PostgreSQL baseline.
- First-Manager bootstrap flow and isolated test-database workflow.
- Environment validation, structured error envelopes, request IDs, logging, health/readiness routes, graceful shutdown, and generated OpenAPI contract.
- Fresh-environment rehearsal on 13 August 2026: migrations applied to a new database; bootstrap created one Manager and rejected a repeat; liveness/readiness returned healthy responses.

Verified:

- `pnpm typecheck` passes.
- `pnpm --filter @cafe/api test` passes: 6 files and 18 tests.
