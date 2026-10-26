# SEP SSP1126 delivery record, 26 October 2026

Local implementation and deployment preparation are complete. The coordinated
POS/API release was published and activated on 26 October with terminal payments
disabled. Financial Windows installation, protected pairing, runtime activation
and actual purchase acceptance remain open.

The approved hardware scope and business choices are in ADR 0012. Current
completion/Left items are in `docs/current-left.md`. The full Windows procedure,
including exact commands and Restricted-policy inline generation, is in
[`apps/sep-bridge/Payments/README.md`](../../apps/sep-bridge/Payments/README.md).

## Payment lifecycle

1. Existing Staff/Manager settlement inputs determine allocations and all
   tenders. One assisted settlement has one terminal tender, optionally cash
   and transfer companions. Multiple cards use separate partial settlements.
2. Backend validates amounts using existing settlement calculations, persists
   an immutable checkout, reserves order/terminal, advances order version and
   issues a 120-second signed Toman intent. No ledger record exists yet.
3. An explicit cashier click sends that intent to 127.0.0.1. The bridge flushes
   a local marker. Its isolated single-use worker redeems the backend claim
   once, verifies terminal identity, then invokes the official managed purchase
   signature once. A lost claim acknowledgment cannot reach purchase.
4. Any response, lost response, timeout or restart remains unposted and subject
   to reconciliation. Backend reads cannot dispatch. Expiry/flag disablement
   never release a reservation. Restart repeats evidence delivery only.
5. Staff or Manager checks the receipt/bank amount and companion funds, then
   confirms success. One transaction posts the existing settlement, allocation,
   tender, order/table/inventory and audit effects and links the attempt. An
   explicit no-charge decision instead requires bank/receipt verification,
   idle terminal and stopped worker assertions and records failure with audit.

Attempt states are PENDING/UNKNOWN/SUCCEEDED/FAILED; existing order statuses
remain UNPAID/PARTIALLY_PAID/PAID. Financial success is never inferred from a
frontend boolean, local HTTP 200 or SDK response code 00. Accounting reversals
remain accounting operations and never initiate terminal refunds.

The pairing key is protected backend configuration and Windows CurrentUser
DPAPI data, never JavaScript. Intent, claim and result messages use separate
HMAC purposes with a fixed LF-delimited UTF-8 encoding. Shared conformance
vectors pass in C# and TypeScript. Origin checks add protection to HMAC;
CORS alone is not authentication. SDK-free fakes are the only automated
financial test execution. No live credentials are in CI.

## Amounts and SDK

All database/UI money remains integer Toman. The operator's existing tester
input 1000 printed 10000 Rial / 1000 Toman. Static tester inspection finds no
scaling before PcStarterPurchase. This setup passes the same integer Toman
value to the official DLL without an assumed x10 conversion. Returned amount
semantics and PaidAmount population remain unverified. Initial posting therefore
requires the explicit reconciliation gate above.

Direct managed references use the pinned official SSP1126 1.4.11.1 and
Sep.Logger 1.0.0.2 pair. Loaded assembly hashes and effective vendor logging off
are checked before SDK construction. COM registration and its Documents DLLs
remain untouched. The SDK contract documents the exact ten arguments, English
Sync initialization, SetLan ordering, RRN/trace extraction, and network-active
cleanup. The worker deadline covers claim, connection, purchase and cleanup.
One bridge SDK invocation is enforced per attempt; bank/provider exactly-once
semantics are not independently certified by these local tests.

## Browser and physical diagnostic evidence

Actual Windows 8.1 32-bit / Firefox ESR 115 cashier tests supplied by the user
returned HTTP 200 for both plain and header-forced-preflight HTTPS-POS to
HTTP-loopback health fetches. No VPN/proxy was active. The Windows HTTP probe
observed no CSP header/meta in its POS response. Wrong-Origin requests were
rejected, OPTIONS returned 204, and the socket bound only 127.0.0.1. No browser
security changes or LAN firewall permissions were introduced.

The separately approved official ConnectionTest returned Connected / 00 /
terminal 31187710 / cleanupFailed=false and exited cleanly. Diagnostics were
turned off afterward. Original SDK file hashes and vendor-log metadata were
unchanged. The approved health task is running; the financial package has not
been transferred or installed. See the two Windows verification runbooks.

The financial POST/content-type preflight, DPAPI round-trip, public HTTPS
backend reachability from the worker, cross-session mutex contention, forced
worker deadline, actual next-login startup, browser offline/recovery and physical
purchase remain target-machine acceptance checks. No browser surface was
available here for visual UI inspection. DOM tests and production build passed.

## Verification

| Check | Result |
| --- | --- |
| Fresh isolated PostgreSQL migration reset | Pass |
| Local development additive migration deploy/status | Pass, no pending migration |
| Full isolated API suite | Pass |
| Final terminal integration / signature tests | 12 + 2 passed |
| Full POS suite | 25 files, 171 tests passed |
| API/POS typechecks and production builds | Pass |
| Original real loopback health host | 8 passed |
| SDK-free connection diagnostic cases | 17 passed |
| Financial host HTTP/CORS/binding checks, disabled | 4 passed |
| Diagnostic / purchase worker unsafe-invocation guards, no SDK files | 4 + 4 passed |
| Fake payment lifecycle and C#/TS proof vectors | Pass |
| Package manifest/ZIP and x86 GUI/CLR flags | Pass |
| Git whitespace check | Pass |
| Remote CI workflow | Added, not run remotely |
| Financial hardware payment test | Not run, separate authorization required |

## Prepared artifact and approval boundaries

Financial artifact:
`apps/sep-bridge/dist/payments/run-cafe-sep-payments-0.2.0-x86.zip`.
108,112 bytes. SHA-256:

```text
f5c30e524d6642307150f6ece195130dea885205b7ada622a2939fc56fdf09e7
```

Generated binaries/SDK files/archives stay ignored. The source package builder
recreates a manifest for each build; re-record the checksum if rebuilding with
another compiler or source revision. The financial configuration defaults false
in both executable configs and the backend environment.

The coordinated disabled release is `cafe-sep-75a2f4a`, commit
`75a2f4acb39ee500e3dd4741289f1d419cb07c1e`, artifact SHA-256
`94c0bb859479a3671205ed40efb9b1ad6d42af3d60afb7444406f402ec6a284c`. Migration
`20261025120000_sep_terminal_attempts` is applied; all 41 production migrations
are current. The pre-release PostgreSQL 17 backup and runtime rollback archive
are recorded in `docs/current-left.md`. Production health and public POS release
probes passed. No pairing key was provisioned, financial bridge was installed,
or real payment initiated. After café setup, runtime activation uses the backend
environment flag and Windows bridge configuration; it does not require another
code release. Financial bridge installation, pairing, activation and any real
payment test remain separate operations. Automatic financial posting and refunds
are not enabled.

## Changed source and documentation files

The following inventory excludes ignored generated binaries and archives.
- `.github/workflows/sep-bridge-fakes.yml`
- `apps/api/.env.example`
- `apps/api/prisma/migrations/20261025120000_sep_terminal_attempts/migration.sql`
- `apps/api/prisma/schema.prisma`
- `apps/api/src/app.ts`
- `apps/api/src/config/env.ts`
- `apps/api/src/modules/orders/orders.service.ts`
- `apps/api/src/modules/orders/terminal-reservation.ts`
- `apps/api/src/modules/terminal-payments/terminal-payments.routes.ts`
- `apps/api/src/modules/terminal-payments/terminal-payments.service.ts`
- `apps/api/src/modules/terminal-payments/terminal-signatures.ts`
- `apps/api/test/integration/terminal-payments.test.ts`
- `apps/api/test/setup/database.ts`
- `apps/api/test/unit/terminal-signatures.test.ts`
- `apps/pos/.env.example`
- `apps/pos/app/components/orders-workspace.tsx`
- `apps/pos/app/components/payment-bridge-diagnostic.test.tsx`
- `apps/pos/app/components/payment-bridge-diagnostic.tsx`
- `apps/pos/app/components/settlement-sheet.test.tsx`
- `apps/pos/app/components/terminal-payment.test.tsx`
- `apps/pos/app/components/terminal-payment.tsx`
- `apps/pos/app/diagnostics/payment-bridge/page.tsx`
- `apps/pos/app/lib/api-client.ts`
- `apps/pos/app/lib/sep-bridge-diagnostic.test.ts`
- `apps/pos/app/lib/sep-bridge-diagnostic.ts`
- `apps/pos/app/lib/sep-payment.test.ts`
- `apps/pos/app/lib/sep-payment.ts`
- `apps/sep-bridge/.gitignore`
- `apps/sep-bridge/App.config`
- `apps/sep-bridge/Diagnostics/App.config`
- `apps/sep-bridge/Diagnostics/ConnectionDiagnostics.cs`
- `apps/sep-bridge/Diagnostics/DiagnosticWorker.cs`
- `apps/sep-bridge/Diagnostics/OfficialSepDiagnosticDevice.cs`
- `apps/sep-bridge/Diagnostics/README.md`
- `apps/sep-bridge/Diagnostics/package-diagnostics.py`
- `apps/sep-bridge/Diagnostics/run-connection-test.ps1`
- `apps/sep-bridge/Payments/App.config`
- `apps/sep-bridge/Payments/BackendClient.cs`
- `apps/sep-bridge/Payments/PaymentEngine.cs`
- `apps/sep-bridge/Payments/PaymentHost.cs`
- `apps/sep-bridge/Payments/PaymentProtocol.cs`
- `apps/sep-bridge/Payments/ProcessPurchaseWorker.cs`
- `apps/sep-bridge/Payments/PurchaseWorker.cs`
- `apps/sep-bridge/Payments/README.md`
- `apps/sep-bridge/Payments/build.ps1`
- `apps/sep-bridge/Payments/configure.ps1`
- `apps/sep-bridge/Payments/install.ps1`
- `apps/sep-bridge/Payments/package.py`
- `apps/sep-bridge/Payments/pair.ps1`
- `apps/sep-bridge/Payments/reviewed-command.py`
- `apps/sep-bridge/Payments/stop.ps1`
- `apps/sep-bridge/Program.cs`
- `apps/sep-bridge/README.md`
- `apps/sep-bridge/RunCafe.SepBridge.csproj`
- `apps/sep-bridge/build.ps1`
- `apps/sep-bridge/install-health.ps1`
- `apps/sep-bridge/package-health.py`
- `apps/sep-bridge/stop-health.ps1`
- `apps/sep-bridge/tests/ConnectionDiagnosticsTests.cs`
- `apps/sep-bridge/tests/PaymentEngineTests.cs`
- `apps/sep-bridge/tests/diagnostics_test.py`
- `apps/sep-bridge/tests/health_test.py`
- `apps/sep-bridge/tests/payment_host_test.py`
- `apps/sep-bridge/tests/payments_test.py`
- `apps/sep-bridge/tests/protocol-vectors.json`
- `apps/sep-bridge/tests/worker_guard_test.py`
- `docs/adr/0003-integer-toman-money.md`
- `docs/adr/0008-settlement-allocation.md`
- `docs/adr/0012-sep-ssp1126-local-bridge.md`
- `docs/current-left.md`
- `docs/planning/api-inventory.md`
- `docs/planning/backend-backlog.md`
- `docs/planning/database-constraints.md`
- `docs/planning/erd.md`
- `docs/planning/production-gates.md`
- `docs/planning/scope.md`
- `docs/planning/sep-ssp1126-delivery.md`
- `docs/planning/sep-ssp1126-integration-audit.md`
- `docs/planning/sep-ssp1126-sdk-contract.md`
- `docs/planning/sep-terminal-backend.md`
- `docs/runbooks/sep-diagnostic-windows-verification.md`
- `docs/runbooks/sep-health-windows-verification.md`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/terminal-payments.ts`
