# SEP backend payment-attempt contract

Approved scope: ADR 0012. Current Windows evidence is in the diagnostic runbook.
Implementation starts disabled; no production activation or real purchase is
authorized by local development work.

## Frozen checkout and reservation

One assisted settlement contains exactly one CARD_TERMINAL tender plus optional
CASH/CARD_TRANSFER companions. Multiple bank cards use separate partial
settlements, as selected by the user. Reuse the existing allocation and atomic
settlement calculations; never trust a browser total.

Persist one TerminalPaymentAttempt with an immutable checkout snapshot,
fingerprint, actor/idempotency key, order/installation/terminal identities,
authorized integer-Toman card amount, order version, dispatch/result times,
allowlisted terminal evidence, resolution actor/decision, and optional unique
posted settlement link. Order payment status remains derived from settlements.
The attempt states are PENDING, UNKNOWN, SUCCEEDED, and FAILED.

Preparing an attempt increments the order version atomically and reserves the
order and terminal. Partial unique indexes permit only one PENDING/UNKNOWN
attempt per order and per configured installation. All order mutations,
settlements, corrections/reversals, and both sides of table transfers must
respect this reservation. CAS order-version writes prevent prepare/mutation
races from both committing. Normal table release already rejects open orders.
Disabling the feature or ticket expiry never removes an unresolved reservation.

## Pairing, authorization, and dispatch

Provision a random per-installation HMAC key directly to protected backend and
Windows configuration, never JavaScript. The backend flag defaults off and
requires an explicit installation UUID, expected terminal identity, and key when
enabled. A development/test key is never a production default.

Use purpose-separated HMAC-SHA256 messages with a documented fixed field order
and newline-delimited restricted ASCII scalars, not serializer-dependent JSON.
The signed intent binds the attempt, checkout fingerprint, identities, amount,
explicit Toman unit, issuance/expiry, and nonce.

Before calling the DLL, the bridge persists its local dispatch marker and
redeems the attempt once through a bridge-authenticated backend claim. The
claim checks current state/expiry and records dispatch atomically. This prevents
an old still-signed ticket from charging after manual cancellation/resolution.
A lost claim response is uncertain; never automatically purchase after it.
The backend never holds a database transaction while the terminal runs.

The bridge delivers only an authenticated allowlisted result tied to the same
attempt. Identical retries are idempotent. A timeout, missing result, restart,
or unverified amount leaves UNKNOWN and keeps the reservation. No status read,
health call, reconnect, or retry may claim or purchase again.

## Explicit reconciliation for the initial SDK contract

The inspected SDK does not visibly populate PaidAmount, so initial results
cannot post a settlement automatically. Store code/terminal/RRN/trace evidence,
then require explicit operator verification. The user approved both Staff and
Managers to reconcile. Success requires checking the receipt/bank amount against
the server-authorized card amount; no-charge resolution requires an explicit
terminal-idle/no-charge confirmation. These decisions are audited and are not
inferred from an HTTP timeout. Persist actor, time, decision, and selected
verification basis; do not collect card data.

Confirmed success posts the frozen checkout through the existing settlement
transaction, including its normal order/table/inventory/audit effects, and links
the attempt exactly once in that transaction. Failure releases the reservation
without a settlement. Replays return the existing outcome. Conflicting or late
evidence must be retained/audited rather than causing another charge.

The observed tester calibration is setup-specific: input 1000 corresponded to
1000 Toman / 10000 Rial, and the tester forwards its input without observed
scaling. Do not introduce an assumed x10 conversion. All accounting remains
integer Toman; physical purchase tests still require separate approval.

## Implemented HTTP and signing contract

All backend paths below have `/api/v1` prefix and the existing `{data,meta}`
envelope. The POS reaches them through `/pos/api/v1`; the bridge uses that same
public HTTPS proxy path with no browser cookies. No secret is in the POS build.

| Method and path | Authority | Effect |
| --- | --- | --- |
| GET /terminal-payments/config | Staff/Manager | Disabled-by-default capability flag |
| GET /terminal-payments/active?orderId=UUID | Staff/Manager | Recover an unresolved attempt |
| GET /terminal-payments/:attemptId | Staff/Manager | Status/evidence only; dispatched pending older than 45 seconds becomes UNKNOWN |
| POST /orders/:orderId/terminal-payment | Staff/Manager + Idempotency-Key | Validate existing settlement request, reserve frozen checkout, return signed intent |
| POST /terminal-payments/claim | Installation HMAC | Single atomic dispatch redemption |
| POST /terminal-payments/result | Installation HMAC | Save allowlisted evidence; never post money |
| POST /terminal-payments/:attemptId/reconcile | Staff/Manager | Audited explicit decision and atomic settlement, or no-charge resolution |

HMAC-SHA256 uses the 32 bytes decoded from the configured 64 lowercase hex
characters. Messages are UTF-8, fields joined with LF, no trailing LF. Decimal
integers use ASCII without grouping, fractions or leading plus signs; nullable
result fields use empty strings. Prefixes and ordered fields are:

```text
sep-intent-v1
attemptId
bridgeId
terminalId
orderId
orderVersion
cardAmount
unit (= TOMAN)
checkoutHash
nonce
issuedAtUnix
expiresAtUnix
```

```text
sep-claim-v1
attemptId
bridgeId
nonce
sentAtUnix
```

```text
sep-result-v1
attemptId
bridgeId
terminalId
sentAtUnix
finishedAtUnix
responseCode (nullable)
rrn (nullable)
trace (nullable)
```

Intent signature is its `signature` property. Claim/result proof is the
`x-sep-signature` header, redacted by the API logger. Intent duration is 120
seconds; bridge accepts at most 30 seconds future issue time; backend bridge
messages require sentAtUnix within 90 seconds. Sync clocks before activation.
No automatic recovery of expired purchase authority is provided. Result delivery
re-signs a fresh sentAtUnix while preserving evidence and finishedAtUnix; backend
idempotency excludes sentAtUnix. HTTP redirects and configured proxies are
disabled for bridge backend requests; normal certificate verification remains.

No-charge reconciliation requires three true assertions: noChargeConfirmed,
terminalIdleConfirmed and bridgeStoppedConfirmed. The operator must verify the
terminal and Windows purchase worker before releasing an uncertain attempt.
Success requires receiptChecked=true and exact server-authorized cardAmount.
Both decisions require current attempt expectedVersion and a selected
TERMINAL_RECEIPT or BANK_RECORD basis. Successful reconciliation uses the frozen
companion cash/transfer composition and requires those funds to have been received.
