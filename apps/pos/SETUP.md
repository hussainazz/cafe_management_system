# Run Café POS setup

`apps/pos` is the shared Staff/Manager Next.js application introduced for
Stage 7. Its first replacement UI pass contains the shared authenticated
`سفارش` workspace, table/takeaway entry, table occupancy controls, and a local
order-composition draft backed by the current catalog/table/order read
contracts. Payment, printing, waiter-call handling, order persistence/editing,
and Manager capability screens remain for their scheduled UI passes.

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

The browser calls `/pos/api/v1/*` on the POS origin. Next.js rewrites those requests
to the server-only `API_BASE_URL`, which keeps session cookies on the POS origin.

## Guardrails

- Keep `apps/web` as the anonymous public menu; do not merge POS routes into it.
- Keep Staff and Manager in this shared application and table dashboard.
- Treat API totals, permissions, idempotency results, and version conflicts as
  server-authoritative.

## Windows POS88C browser printing

1. Connect the OSCAR POS88C by USB, install its Windows driver, and first pass
   a Windows test print. Configure the driver for 80 mm media and its supported
   cutter/feed behavior.
2. Configure Chrome's kiosk printing or the browser print workflow on the café
   POS computer so the POS88C queue, 80 mm media, and supported cutter/feed
   behavior are selected without manual printer changes during service.
3. POS print actions load the authenticated `/pos/print/...` document in a
   hidden same-origin iframe and trigger the browser's configured print flow;
   the preview route is not a separate user-facing tab.
4. Verify a bar ticket, normal receipt, and settlement receipt: Persian glyph
   joining, RTL layout, dynamic receipt height, 80 mm width, and the expected
   browser print behavior.
