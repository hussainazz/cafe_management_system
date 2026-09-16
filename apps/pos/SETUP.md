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

## Windows POS88C and QZ Tray production printing

1. Connect the OSCAR POS88C by USB, install its Windows driver, and first pass
   a Windows test print. Configure the driver for 80 mm media and its supported
   cutter/feed behavior.
2. Install QZ Tray on the café Windows POS computer and enable its Start with
   Windows option. QZ Tray, rather than Chrome kiosk printing, sends jobs to
   the Windows printer queue.
3. In POS, use the compact **چاپگر** control to verify QZ connectivity and
   select the local POS88C queue. This preference is intentionally stored only
   on that Windows machine; bar and receipt roles currently use the same queue.
4. Configure `QZ_CERTIFICATE_PATH` and `QZ_PRIVATE_KEY_PATH` on the API host.
   The private key must stay server-side and must never be put in a
   `NEXT_PUBLIC_*` variable, browser storage, or Git.
5. Install the appropriate QZ trusted signing certificate. A locally generated
   key pair alone does not establish trusted no-warning production printing.
6. Verify a bar ticket, normal receipt, and settlement receipt: Persian glyph
   joining, RTL layout, dynamic receipt height, 80 mm width, and no Chrome
   print preview/dialog. QZ submission means the job entered the Windows queue;
   it does not prove paper has exited the printer.

Chrome does not need `--kiosk-printing` for this QZ printing path. Full-screen
or kiosk mode can still be used independently for the POS interface.
