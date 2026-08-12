# API Test Database

API tests use a separate PostgreSQL database so they never reset development
data. The test database name must end in `_test`.

## First Use

1. Copy `.env.test.example` to `.env.test` and adjust the connection values if
   your local PostgreSQL configuration differs.
2. Start PostgreSQL with `pnpm docker:up`.
3. Run `pnpm --filter @cafe/api test`. The command creates the test database,
   applies migrations, resets its data, and runs Vitest.

## Database Commands

- `pnpm --filter @cafe/api test:db:create` creates the test database if needed.
- `pnpm --filter @cafe/api test:db:reset` recreates the schema and clears test data.
- `pnpm --filter @cafe/api test:db:dispose` terminates test connections and drops only the `_test` database.

Every API test starts with empty application tables. The Vitest configuration
runs test files sequentially so one test cannot erase another test's data.
