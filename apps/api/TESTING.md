# API Test Database

API tests use a separate PostgreSQL database so they never reset development
data. The test database name must end in `_test`.

## First Use

1. Copy `.env.test.example` to `.env.test` and adjust the connection values if
   your local PostgreSQL configuration differs.
2. Start PostgreSQL with `pnpm docker:up`.
3. Run `pnpm --filter @cafe/api test`. The command creates the test database,
   applies migrations, resets its data, and runs Vitest.

For the full pre-release database gate, run
`pnpm --filter @cafe/api test:database`. It first runs the migration verifier,
then resets the normal test database and runs the complete API suite.

The migration verifier creates and removes only isolated database names derived
from `TEST_DATABASE_URL` and ending in `_test`. It proves a fresh deploy, a
no-op repeat deploy, upgrade of valid existing financial data, rejection and
atomic rollback for invalid historical data, exact physical-table seed data,
and a clean `pg_dump`/`pg_restore` drill. It never connects to the development
or production database.

## Database Commands

- `pnpm --filter @cafe/api test:db:create` creates the test database if needed.
- `pnpm --filter @cafe/api test:db:reset` recreates the schema and clears test data.
- `pnpm --filter @cafe/api test:db:dispose` terminates test connections and drops only the `_test` database.
- `pnpm --filter @cafe/api test:migrations` runs only the isolated migration and restore rehearsal.
- `pnpm --filter @cafe/api test:database` runs the migration rehearsal and the full PostgreSQL API suite.

Every API test starts with empty application tables. The Vitest configuration
runs test files sequentially so one test cannot erase another test's data.
