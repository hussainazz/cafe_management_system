# Run Café POS setup

`apps/pos` is the shared Staff/Manager Next.js application introduced for
Stage 7. It intentionally contains only the application foundation; table,
order, payment, printing, and Manager capability screens are added in their
scheduled UI passes.

## Local development

1. Copy `.env.example` to `.env.local` if the API is not available at
   `http://127.0.0.1:3001`.
2. Run `pnpm dev:pos` from the repository root.
3. Open `http://localhost:3002`.

## Local POS accounts

Create or reset the local development Manager account with:

```bash
pnpm auth:manager
```

Create or reset the local development Staff account with:

```bash
pnpm auth:staff
```

The commands print the local credentials they provision. By default they are
`run.manager` / `RunCafeManager2026` and `run.staff` / `RunCafeStaff2026`.
Override either username or password through the matching `DEV_POS_*`
environment variable. These commands refuse production, remote-host, and
`_test` databases.

The browser calls `/api/v1/*` on the POS origin. Next.js rewrites those requests
to the server-only `API_BASE_URL`, which keeps session cookies on the POS origin.

## Guardrails

- Keep `apps/web` as the anonymous public menu; do not merge POS routes into it.
- Keep Staff and Manager in this shared application and table dashboard.
- Treat API totals, permissions, idempotency results, and version conflicts as
  server-authoritative.
