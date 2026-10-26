# SEP SSP1126 integration: Phase A audit and scope proposal

Date: 25 October 2026. Status: **scope approved by the user on 25 October 2026; Phase B in progress**.

This record retains the Phase A findings and approved proposal. ADR 0012 and
the updated scope now own the decision. Approval does not authorize deployment
or establish browser or purchase compatibility.

## Scope gate

At the Phase A audit, the baseline excluded this integration. These historical
line references identify the clauses amended after approval:

- `scope.md:48` forbids Rial conversion.
- `scope.md:51` excludes terminal integration.
- `scope.md:72` excludes direct card-terminal control.
- `scope.md:155` describes manual tenders.
- `scope.md:221` requires manual terminal entry with no reconciliation reference.
- ADR 0003 requires a new decision and tests for future Rial conversion.
- ADR 0008 describes manual terminal entry without a reconciliation reference.
- `backend-backlog.md`, P1.7, covers manual settlement recording, not hardware
  attempts or uncertain financial results.

Amendment approved by the user:

> Approve an optional, disabled-by-default SEP SSP1126 / PAX Q80 integration
> for authenticated Staff and Manager POS checkouts at this single café. A
> Windows 8.1 x86 .NET Framework 4.8 bridge binds only to 127.0.0.1 and uses the
> matching official SEP managed assemblies. The existing VPS backend remains
> the only financial authority. Add durable authorized payment attempts,
> authenticated result handling, idempotency, and audited reconciliation while
> preserving manual card, cash, card-transfer, split tender, and existing
> settlement accounting. Keep storage, display, receipts, and accounting in
> integer Toman. Permit explicit checked conversion only at the SEP boundary
> after the official unit and tester behavior are verified. Store only
> allowlisted non-sensitive terminal evidence linked to an attempt and its
> posted payment. Pending or unknown attempts cannot close an order, release
> its table, be automatically retried, or be bypassed by another settlement.

Online payment gateways, automatic refunds, offline authoritative settlements,
LAN/public bridge access, and direct printer integration remain excluded.
Settlement reversal is an accounting operation and must never imply a bank
refund or initiate another terminal purchase.

After approval, ADR 0012 superseded the relevant parts of ADRs 0003 and 0008.
Scope, backend backlog, API inventory, ERD, database constraints, production
gates, and the active completion checklist were synchronized before runtime
implementation began.

## Current repository behavior

Only the root `AGENTS.md` was found; there are no nested instruction files.
The checkout was clean on `main` at the start of inspection. The required scope,
current checklist, backend backlog, and production gates were read.

| Concern | Observed implementation |
| --- | --- |
| Money | Prisma `Int` fields, integer-Toman ADR and scope. Settlement inputs accept positive integers. No SEP-unit conversion exists. New terminal bounds must account for database, conversion, protocol, and terminal limits. |
| Tender | Shared contracts accept `CASH`, `CARD_TERMINAL`, `CARD_TRANSFER`, with 1–10 tenders. Only transfers accept an optional reference. |
| Allocation | Backend supports item quantities and entered amounts. Amount allocation follows item display order and can leave a fractional item portion. |
| Financial mutation | `POST /api/v1/orders/:orderId/record-settlement` requires Staff/Manager authorization, an idempotency key, and `expectedVersion`. The service derives allocations from saved item/discount snapshots and checks tender totals. |
| Atomicity | Settlement, tenders, allocations, balance/status, version, audit, and idempotency result commit in one PostgreSQL transaction. |
| Completion | Zero balance sets `PAID` and `CLOSED`, invokes full-payment inventory recognition, frees a table and invalidates its guest context, and resolves its pending waiter call. Partial payment leaves the order open. |
| History | Corrections create a replacement settlement and reversal with audit records. Full reversal recalculates balances and can reopen an order. Neither operation performs a bank transaction. |
| Receipt | Staff-protected whole-order and payer-settlement receipt endpoints derive data from saved item/allocation snapshots. Browser print routes and the shared print document render the customer receipt; the bar ticket is a separate preparation view. |
| POS state | `SettlementSheet` lives in `orders-workspace.tsx`. It uses React state and user-scoped `sessionStorage` recovery for tender inputs, quantities, and a request key. Default tender is manual card. Operational views reload server data. |
| Retry | Same-payload settlement retries retain the request key. Changing tender/quantity generates a new key. The API client can replay a request after authentication refresh. Browser recovery does not itself submit a settlement. This is insufficient for terminal charging safety. |
| Missing terminal state | No persistent device pairing, payment-attempt journal, pending/unknown outcome, RRN, trace, terminal identity, or approved-amount verification exists. |

The `payments_reference_method_check` constraint also requires card-terminal
references to be null. The service deliberately discards references for that
method. Do not put RRN into the existing transfer-reference field. Prefer
dedicated terminal-attempt evidence linked uniquely to the posted payment;
retain existing manual reference semantics.

Primary implementation entry points:

- `apps/api/prisma/schema.prisma`: order, settlement, allocation, payment,
  reversal, and idempotency models.
- `packages/contracts/src/index.ts`: settlement/payment input and response DTOs.
- `apps/api/src/modules/orders/orders.routes.ts`: authorized mutation and
  receipt endpoints.
- `apps/api/src/modules/orders/orders.service.ts`: `recordSettlement`,
  `reverseSettlement`, `editSettlement`, and receipt builders.
- `apps/pos/app/components/orders-workspace.tsx`: existing settlement dialog.
- `apps/pos/app/lib/api-client.ts` and `automatic-recovery.ts`: requests,
  authentication recovery, and browser draft recovery.
- `apps/api/test/integration/orders.test.ts`, inventory tests, and
  `apps/pos/app/components/settlement-sheet.test.tsx`: existing regression coverage.

## Hardware and browser evidence

The Windows/terminal test results, addresses, terminal ID `31187710`, registered
DLL location, and real tester payment are operator-supplied evidence. This
audit did not access the cashier host or terminal and did not repeat them.

All three supplied Linux reference paths exist: the DLL directory, the PDF,
and `/home/hosein/sep1126.il`. The DLL directory contains the two assemblies
and TLB. Read-only assembly metadata confirms:

| File | Assembly version | SHA-256 |
| --- | --- | --- |
| SSP1126.PcPos.dll | 1.4.11.1 | `b1785db76f5b7748dc4cc59895f11a41d34542808fc61a317c175f4f0f821ffa` |
| Sep.Logger.dll | 1.0.0.2 | `19327d291e42d9adaf6905d80fe6aadfe1d255fb5b8d2e447d420bada5d52aa9` |

Compare these hashes with Windows before packaging. Version numbers alone
do not prove identical files. No SDK files were copied into the checkout.

The disassembly contains purchase signatures and result properties, including
`PaidAmount` and `RRN`. Metadata is not a verified purchase contract. Purchase
arguments, amount units, timeout/result semantics, cancellation/cleanup network
effects, response-code classification, and vendor logging remain Phase C gates.
The PDF has not yet been analyzed. The unofficial
[TypeScript implementation](https://github.com/vhidvz/saman-payment-pos) was
opened as a comparison reference; it is not the chosen runtime or authority.

Prefer a direct managed reference to the matching official assemblies because
the bridge itself is managed C#. This avoids COM activation/registration and
interop marshalling as additional failure points. Confirm dependencies,
threading, and runtime behavior in Phase C before making that choice final.
Do not move, replace, or re-register the current `/codebase` Windows installation.

At Phase A, no actual Firefox ESR 115 loopback test had run. The POS Next.js configuration
contains no explicit CSP; Fastify registers Helmet and disables API CORS.
Neither fact establishes the CSP of the delivered POS page or bridge access.
A read-only HTTPS header probe of `https://runncafe.ir/pos` failed with curl
error 35, connection reset by peer. Live CSP headers were therefore not obtained.

[Mozilla's mixed-content documentation](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content#loading_locally_delivered_mixed-resources)
describes loopback HTTP resources as locally trustworthy. This supports testing
the proposed transport; it does not establish compatibility for the cashier's
exact browser, site policy, or proxy/VPN configuration.

## Proposed implementation and lifecycle

This is the design to validate after scope approval, not implemented behavior.

1. The authenticated POS asks the backend to prepare an attempt for the
   existing selected allocation and complete tender composition. The backend
   computes the authoritative amount, reserves the checkout against competing
   mutations, and records a stable attempt ID. Do not keep a database
   transaction open while waiting for the terminal.
2. Pair one bridge installation through an explicit Manager/operations process.
   Provision a random per-installation secret to protected backend and Windows
   storage, never JavaScript. Use purpose-separated HMAC-SHA256 authorization
   tickets and result envelopes with an exact documented encoding. Bind tickets
   to installation, terminal, attempt, order/version, tender fingerprint,
   authorized amount/unit, and expiry. Reject tampering and replay. A diagnostic
   capability grants no purchase authority.
3. The browser explicitly sends the authorized purchase request to the bridge.
   Validate the exact Origin and Host, JSON content type, capability, and
   request bounds. CORS is an additional browser restriction, not authentication.
   Reject arbitrary, missing, or null origins on browser operations. Minimal
   read-only health can remain available to local SSH diagnostics.
4. Acquire a process-wide instance lock and a device-operation lock. Atomically
   persist and flush the attempt's dispatch marker before the single DLL
   purchase invocation. Same-ID/same-payload retries return the saved state;
   conflicting payloads fail. A crash after that marker always leaves a
   potentially charged attempt, even if the DLL call had not begun. Fail closed
   on an unreadable journal. Diagnostics must not interfere with a purchase.
5. Keep pending, confirmed success, confirmed failure, and unknown/reconciliation
   outcomes on the payment attempt. Keep existing order statuses derived only
   from posted settlements. Local state is a durable delivery journal of the
   same attempt, not another authoritative accounting system.
6. Allowlist the SDK result before persistence or logging. Authenticate its
   delivery to the backend using the installation secret. Verify attempt,
   terminal, approved amount/unit, outcome, and available RRN/trace evidence.
   Cryptography authenticates the paired bridge, not an independent bank
   attestation. Unverified or incomplete evidence requires explicit audited
   reconciliation and must not post a settlement automatically.
7. Finalize a verified successful attempt once, in the existing settlement
   transaction, including all cash/split-tender records and normal order,
   table, inventory, and audit effects. A verified approval followed by a
   backend conflict remains charged and needs posting recovery, never another
   purchase. Link evidence uniquely to prevent reuse across attempts/payments.
8. HTTP/DLL timeout, lost response, browser refresh, and bridge restart after
   dispatch cannot prove failure. Reconnect and polling read the existing
   attempt only. Keep the reservation and require recovery/reconciliation;
   never unlock it based only on timeout, feature-flag disablement, or ticket
   expiry. An unresolved dispatched attempt also blocks a new purchase on that
   terminal. Preserve manual fallback for checkouts without unresolved attempts.

The approved scope should cover the order mutation guards required by that
reservation, including normal settlement, item/discount changes, correction,
reversal, deletion, and table release. Their precise implementation and
reconciliation permissions must be recorded before Phase D code.

Vendor `Sep.Logger` configuration and all SDK-generated files must be inspected
before adapter execution. Sanitizing only bridge logs is insufficient if the
SDK itself writes card data. No raw result serialization or full PAN, PIN,
track data, tickets, or pairing secrets may enter logs or the journal.

## Delivery gates after approval

| Phase | Required exit evidence |
| --- | --- |
| B | Health-only x86 bridge and in-POS diagnostic using `fetch`, no DLL purchase path. Actual Windows Firefox ESR 115 evidence for GET and forced OPTIONS preflight, accepted/rejected origins, delivered CSP, loopback-only binding, and proxy/VPN behavior. If blocked, review a secure alternative before financial operations. |
| C | Exact documented official API contract, package/dependency hashes, confirmed units and tester interpretation, safe vendor logging, connection/terminal-identity fakes, and lifecycle analysis. `SetLan` must precede initialization; use the supplied English/Sync/10-second diagnostic setup. No real purchase. |
| D | Additive migration, protected pairing, durable attempts/reservations, result authentication, idempotent posting, restart recovery, and audited reconciliation with isolated PostgreSQL tests. |
| E | Extend the existing settlement sheet behind the disabled flag. Explicit initiation, amount display, waiting/result/recovery, restored attempt identity, and existing manual/cash/split flows. Review every new Persian string. |
| F | Mock-only transaction tests, Windows x86 build, matching dependency manifest, checksums, and reproducible installation/rollback artifacts. Document Task Scheduler login startup without a console, protected paths, SSH inspection, localhost URL reservation if needed, and clean stop/restart. No inbound LAN firewall opening. |

Required fake scenarios include successful connection, wrong terminal identity,
offline terminal/bridge, invalid response, duplicate/conflicting requests,
concurrent requests, refresh, timeout, lost approval response, process restart,
corrupt journal, result tampering/replay, reconciliation, and cash/split regressions.
No automated test may initiate a real payment.

No bridge artifact existed at Phase A. Phase B now supplies a health-only
artifact and [exact commands](../../apps/sep-bridge/README.md); this is not the
financial Phase F release. Installing or running anything on the cashier,
production deployment/activation, terminal configuration changes, and real
financial tests require separate explicit authorization.

## Phase B implementation and remaining acceptance

The read-only bridge, opt-in POS diagnostic, Windows build/install/stop scripts,
and checksummed health-only ZIP are ready. The host binds a real IPv4 loopback
socket, serves GET/OPTIONS health only, rejects wrong Host/Origin, bodies and
duplicate headers, bounds reads/concurrency, and logs only fixed safe fields.
No SEP package is loaded, copied, registered, or contacted. The narrow health
HTTP parser has not been approved as a future financial transport.

Host tests pass 8/8, including actual socket and CLR x86 inspection. Focused
POS checks pass 15/15 and the full POS suite passes 23 files / 161 tests;
typecheck and production build pass. Local HTTP checks
prove the route is 404 by default and 200 when explicitly enabled. Existing POS
still returns 200. No browser surface was available, so no visual or actual
browser execution is asserted. Package/source hashes and ZIP contents validate.

The health ZIP is 12,784 bytes, SHA-256
`6411104c97e93ca14190e9c2212fa5dbb119c63d0b39ccd717d23787b140236d`.
The user subsequently approved health-only cashier transfer, installation,
and startup. The approved ZIP and installed binary/config hashes match.
Actual Windows 8.1 32-bit startup, Limited/Interactive login task registration,
quiet execution, loopback binding, health GET, allowed preflight, and wrong-origin
rejection pass. Restricted execution policy was preserved by running reviewed
installation commands directly through SSH. Windows HTTPS POS returned 200
without CSP headers or meta in that response. See [the Windows evidence](../runbooks/sep-health-windows-verification.md).

The operator subsequently supplied HTTP 200 results for both simple and headered
Firefox health requests and confirmed no VPN/proxy was active. Normal browser
transport under its active security policy is proven. The actual OPTIONS-panel
capture, browser offline/recovery, and subsequent-login check remain operational
follow-ups. Windows clean stop/offline read/restart passes and the health task
is left running. No browser surface is available to the agent.

Phase C now has a separately packaged default-off x86 diagnostic worker and
direct managed adapter, with pinned package hashes, effective vendor logging
disablement guard, serialized cleanup, cross-session mutex, and a bounded
launcher. Fake diagnostic tests pass 17/17; real disabled-worker guards 4/4;
the launcher parses in Windows PowerShell 4.0. The separate diagnostic artifact
has not been installed or executed on Windows. See [the SDK contract](sep-ssp1126-sdk-contract.md)
and [diagnostic runbook](../../apps/sep-bridge/Diagnostics/README.md). Purchase
and backend financial implementation have not started.

## Verification record

- `pnpm --filter @cafe/pos test -- app/components/settlement-sheet.test.tsx
  app/lib/automatic-recovery.test.tsx app/lib/api-client.test.ts` passed. This
  invocation ran the full POS suite: 21 files, 146 tests, 27.10 seconds.
- From `apps/api`, `node --env-file=.env.test
  ../../node_modules/vitest/vitest.mjs run test/integration/orders.test.ts
  test/unit/order-calculations.test.ts` passed: 2 files, 49 tests, 36.01 seconds.
  The database setup enforces identical test database URLs ending in `_test`.
  This was a focused run against the authorized isolated database, not a full
  API suite or migration rehearsal.
- `git diff --check` passed after the documentation changes.
- These are existing-workflow baseline checks, not tests of an implemented
  bridge. No production, cashier, or terminal mutations ran. No commit or push
  was made.
