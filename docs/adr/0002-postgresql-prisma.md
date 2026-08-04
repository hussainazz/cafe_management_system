# ADR 0002: Use PostgreSQL And Prisma

## Status

Accepted

## Context

The application needs one authoritative transactional source of truth for orders, payments, catalog data, users, audit logs, idempotency records, and reports.

Important v1 behavior depends on database transactions, constraints, foreign keys, unique identifiers, and restoreable backups.

## Decision

Use PostgreSQL as the primary database and Prisma as the TypeScript persistence toolkit.

PostgreSQL stores authoritative business data. Prisma manages schema definition, migrations, and generated TypeScript client access. API contracts must remain separate from Prisma models.

## Consequences

- Multi-record order and payment workflows can run inside PostgreSQL transactions.
- Database constraints can enforce important invariants instead of relying only on application code.
- Historical data, audit logs, and reports share one consistent source.
- Prisma schema changes require reviewed migrations and migration rehearsal before production.
- Exposing Prisma models directly as API DTOs remains forbidden.
