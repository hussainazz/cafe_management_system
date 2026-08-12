# Current Backend Stage Status

This file is the active completion checklist and current stage status for the backend phase. Check it for every related request.

## In Progress Stages

### Stage 1 - Database And Backend Foundation

Done:

- pnpm monorepo workspace.
- Shared strict TypeScript config.
- Prettier and ESLint setup.
- Fastify API skeleton.
- Environment validation.
- Request IDs and basic logging.
- CORS, Helmet, and Sensible registration.
- Swagger/OpenAPI plugin registration.
- PostgreSQL Docker Compose service.
- Prisma schema/client setup.
- Liveness and readiness routes.
- Graceful shutdown.
- API health integration tests.
- Structured error envelopes with safe validation details and request IDs.

Verified:

- `pnpm typecheck` passes.
- `pnpm --filter @cafe/api test` passes against the current local PostgreSQL connection.

Left:

- Decide how OpenAPI schemas are generated from validated request/response schemas.
- Prove the fresh-environment Stage 1 exit gate.

## Completed Stages

### Stage 0 - Scope And Domain Baseline

Done:

- `docs/planning/scope.md` and `docs/planning/roadmap.md` define the v1 scope, explicit non-goals, roles, order states, money/time/deployment rules, domain modules, architecture direction, production gates, and database-first/POS-first roadmap.
- ADR files document the fixed major decisions.
- The initial ERD, API inventory, database constraints, request/response conventions, error envelope, pagination, idempotency, and concurrency are documented.
- `docs/planning/backend-backlog.md` converts the approved scope into a prioritized backend backlog with acceptance criteria.
