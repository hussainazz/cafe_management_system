# Current Backend Stage Status

This file is the active completion checklist and current stage status for the backend phase. Check it for every related request.

## In Progress Stages

### Stage 2 - POS Backend

Done:

- Staff and Manager username authentication, signed access sessions, rotating hashed refresh sessions, logout/logout-all revocation, account-deactivation revocation, and safe authentication-event recording.
- Shared Staff/Manager route guards and service-level Manager checks, with tested `401 AUTHENTICATION_REQUIRED` and `403 FORBIDDEN` responses.
- Staff/Manager-protected POS catalog and active-table reads, including current catalog availability, option/image metadata, table seating limits, and active-order release timing.

Left:

- Implement Staff order creation.
- Implement order reads and controlled edits.
- Implement logical order deletion.
- Implement settlement recording.
- Implement Manager-only settlement reversal.
- Implement receipt and bar-ticket API data.
- Add POS backend integration coverage.

## Completed Stages

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
