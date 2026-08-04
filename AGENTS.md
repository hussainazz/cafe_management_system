# Rules: 
- Read `docs/planning/scope.md` and `docs/planning/roadmap.md` before making any new decision. For backend work, also read `docs/planning/backend-backlog.md`. For deployment, testing, release, or operations work, also read `docs/planning/production-gates.md`.
- Given tasks should stay inside the framework of the planning docs unless changing the overview is essential. If a planning change is essential, do not implement that change without permission; update the relevant planning doc first, then make the codebase change.
- After completing each roadmap stage, briefly write the progress status here. Even if a stage is not completely done, write what is done and what is left in `In progress Stages`.
- Never ignore, delete, untrack, or accept a merge/rebase conflict resolution that removes `docs/`, `docs/planning/`, or any tracked planning document. Do not add `/docs` or `docs/` to `.gitignore`. After any pull, rebase, merge, or conflict resolution, verify the planning docs still exist before continuing.
- ignore the pnpm lint errors.

# In progress Stages:

- Stage 0 — Scope and domain baseline
  - Done: `docs/planning/scope.md` and `docs/planning/roadmap.md` define the v1 scope, explicit non-goals, roles, order states, money/time/deployment rules, domain modules, architecture direction, production gates, and database-first/POS-first roadmap.
  - Left: write ADR files, create the ERD, define the API inventory, list the database constraints explicitly, document request/response conventions, and convert the roadmap into a prioritized backend backlog with acceptance criteria.

- Stage 1 — Database and backend foundation
  - Done: pnpm monorepo workspace, shared strict TypeScript config, Prettier/ESLint setup, Fastify API skeleton, environment validation, request IDs, basic logging, CORS/Helmet/Sensible registration, Swagger/OpenAPI plugin registration, PostgreSQL Docker Compose service, Prisma schema/client setup, liveness/readiness routes, graceful shutdown, and API health integration tests.
  - Verified: `pnpm typecheck` passes. `pnpm --filter @cafe/api test` passes against the current local PostgreSQL connection.
  - Left: create the initial database tables, add the initial Prisma migration, create the seed/bootstrap flow for the first Manager, define a separate test database workflow, finish structured error envelopes, decide how OpenAPI schemas are generated from validated request/response schemas, and prove the fresh-environment Stage 1 exit gate.

# Completed Stages:

- None yet.
