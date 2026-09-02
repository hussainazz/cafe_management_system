# API Fresh Environment Setup

This procedure starts the Stage 1 API on a new local database without using
development data.

## Prerequisites

- Node.js 24 and pnpm 11.
- Docker Compose.

## Start And Verify

1. Install dependencies from the repository root:

   ```sh
   pnpm install --frozen-lockfile
   ```

2. Copy `apps/api/.env.example` to `apps/api/.env`. Set `DATABASE_URL` to an
   empty PostgreSQL database and set distinct values for
   `BOOTSTRAP_MANAGER_USERNAME`, `BOOTSTRAP_MANAGER_PASSWORD`, `ACCESS_TOKEN_SECRET`, and
   `REFRESH_TOKEN_SECRET`. Both token secrets must be at least 32 characters.
   Production also requires independent `TABLE_QR_TOKEN_SECRET` and
   `TABLE_CONTEXT_COOKIE_SECRET` values of at least 32 characters.

3. Start PostgreSQL:

   ```sh
   pnpm docker:up
   ```

4. Apply migrations and create the one-time initial Manager. The bootstrap username
   must be lowercase and unique:

   ```sh
   pnpm --filter @cafe/api prisma:deploy
   pnpm db:bootstrap-manager
   ```

   The bootstrap command intentionally fails if a Manager already exists.

5. In one terminal, start the API:

   ```sh
   pnpm dev
   ```

   In another, verify both operational endpoints:

   ```sh
   curl http://localhost:3001/api/v1/health/live
   curl http://localhost:3001/api/v1/health/ready
   ```

6. Run the typecheck and isolated API tests:

   ```sh
   pnpm typecheck
   pnpm --filter @cafe/api test
   ```

For test-database configuration and lifecycle commands, see `TESTING.md`.
