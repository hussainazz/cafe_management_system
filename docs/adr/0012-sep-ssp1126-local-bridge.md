# ADR 0012: Optional SEP SSP1126 local Windows bridge

## Status

Accepted by explicit user approval on 25 October 2026. Supersedes only the
manual-only terminal boundary in ADR 0008 and the terminal-boundary conversion
exclusion in ADR 0003. Other decisions remain unchanged.

## Decision

Use an optional, disabled-by-default bridge on the existing cashier account,
Windows 8.1 x86 and .NET Framework 4.8. Bind exclusively to `127.0.0.1`, default
port `18711`. Use the matching official SSP1126 package. Prefer direct managed
references after inspecting the actual API and dependencies; do not alter the
existing COM `/codebase` installation incidentally.

The HTTPS POS communicates with the bridge using `fetch`. Establish actual
Firefox ESR 115 health/preflight compatibility before implementing financial
operations. Do not weaken browser security. The initial health-only artifact
must not load the DLL or contact the terminal.

The backend remains authoritative for amounts, authorization, allocations,
settlements, inventory, and order/table state. Add one durable payment-attempt
lifecycle, with pending, confirmed success, confirmed failure, and unknown /
reconciliation outcomes. Existing order payment statuses remain derived from
posted settlements. The local journal is a recoverable delivery record of the
same attempt, not a second accounting database.

Pair the bridge using protected per-installation credentials. Authenticate
server-issued intent tickets and bridge result envelopes, with separate
cryptographic purposes and a documented deterministic encoding. Never expose
the pairing secret to JavaScript. CORS and exact Origin/Host validation are
additional controls, not payment authentication.

Authorize the complete allocation/tender composition and reserve it against
competing mutations before dispatch, without holding a database transaction
open during a purchase. Persist and flush the local dispatch marker before
calling the DLL, serialize device operations, and return the saved state for
same-ID retries. A timeout, restart, or lost response after that marker is
potentially charged. Never automatically resend or release a reservation on
timeout, ticket expiry, or flag disablement. An unresolved dispatched attempt
also blocks new purchases on its terminal.

Only a verified result or explicit audited reconciliation may finalize the
existing atomic settlement transaction. Authenticate the paired bridge, verify
amount/unit and terminal identity, and retain allowlisted RRN/trace evidence
where supplied. This authenticates the bridge, not an independent bank
attestation. Unverified evidence cannot mark an order paid. Reversal/correction
of accounting records never initiates terminal refunds or purchases.

The user explicitly approved Staff and Manager authority for uncertain-payment
reconciliation on 25 October 2026. Each resolution must be an explicit audited
decision, separate from ordinary manual card entry. Hiding a control is not
authorization; both roles must be enforced by the backend.

The user selected separate partial settlements for multiple bank cards. Each
terminal-assisted settlement has exactly one terminal charge and may also
contain cash/card-transfer tenders. The existing manual multi-tender path
remains available. Never combine distinct cards into a single charge silently.

Accounting, receipts, and display remain integer Toman. Inspect the official
purchase API, terminal amount unit, and tester interpretation before writing
conversion. Permit only checked integer boundary conversion; retain the
original integer wire amount with its unit only as operational evidence.
Do not reuse the transfer-reference field for terminal evidence.

Preserve manual card, cash, transfer, and split workflows, with guards against
bypassing unresolved attempts. Diagnostics and polling cannot purchase.
Allowlist all stored/logged SDK fields and inspect vendor logging before DLL
execution. No full PAN, PIN, track data, raw SDK results, or secrets in logs.

## Delivery gates

Follow Phases B–F and their acceptance criteria in the backend backlog and
[integration audit](../planning/sep-ssp1126-integration-audit.md). Actual browser
proof precedes financial implementation. Automated transactions use fakes only.
Installation/execution on the cashier, production deployment/activation, terminal
configuration changes, and real payments require separate explicit approval.

This decision approves scope and implementation work, not those live actions.
