# SEP payment timing records

Timing schema 1, implementation `sep-timing-20261101-v1`, bridges 0.2.5 and 0.2.6.
The purpose is to distinguish time in the POS/API/bridge from the external
synchronous SDK/terminal interval. No terminal display or bank-internal event is
inferred. The external interval can include cardholder interaction.

## Read and compare attempts on the VPS

Use the existing read-only database connection:

```sql
SELECT "occurredAt", "id" AS "reportId", "entityId" AS "attemptId", "afterSnapshot"
FROM "audit_logs"
WHERE "operation" = 'TERMINAL_PAYMENT_TIMING'
ORDER BY "occurredAt", "id";
```

Add `AND "entityId" = 'ATTEMPT_UUID'` before `ORDER BY` for one attempt.
Rows include `source`, `schemaVersion`, `implementation` and a phase or stage.
Bridge summaries also contain `bridgeVersion`, `terminalId`, `completeness`,
`dispatchGapMs` and `timingsMs`. Each browser event has its own report ID;
one bridge summary uses the attempt UUID as its report ID. Retries upsert the
same ID and do not duplicate database samples. API HTTP spans have separate IDs.

The service journal includes all attempted telemetry records and persistence
failures, including rejected financial requests without a trusted attempt ID:

```sh
sudo journalctl -u cafe-api.service --since '2026-11-01 00:00:00' -o cat | grep 'sep_terminal_timing'
```

Deduplicate journal records by `reportId`. Failed requests can be correlated
by the logger's request ID. Do not treat each retry as another payment attempt.

## Measurements and attribution

| Source/field | Meaning |
| --- | --- |
| POS `prepare_roundtrip` | Browser wait for preparation, including session recovery/retry and network/proxy time. |
| API `prepare_api` | API request entry through response completion, including authentication. |
| POS `bridge_roundtrip` | Localhost request through acknowledgment, including browser CORS preflight when needed. Outcome is ok/error/timeout. |
| Bridge `bridgeAcceptMs` | Intent validation and durable dispatch marker after HTTP body parsing. |
| Bridge `dispatchQueueMs` | Thread-pool scheduling delay. |
| Bridge `workerProcessMs` | Host wait for process startup, worker execution and exit/output handling. |
| Bridge `workerTotalMs` | Worker startup through SDK cleanup. It overlaps individual worker stages. |
| Bridge `prePurchaseMs` | Worker startup until entry into the external SDK purchase call. Includes claim and SDK preparation. |
| Bridge `intentValidationMs`, `deviceMutexMs`, `backendClaimMs` | Signed-intent revalidation, lock acquisition, and complete VPS claim round trip. |
| API `claim_api` | Successful claim request entry through response completion. |
| Bridge `sdkVerificationMs`, `sdkFactoryMs` | DLL hash checking and SDK factory construction. |
| Bridge `setLanMs`, `sdkInitializationMs`, `connectionTestMs`, `purchaseReinitializationMs` | Individual SDK preparation operations. Connection-test network time belongs to that operation. |
| Bridge `purchaseCallMs` | External synchronous SDK/terminal interval. Includes terminal processing and any customer/card/bank wait inside the call. |
| Bridge `sdkCleanupMs` | SDK disposal after the external call. |
| Bridge `diagnosticWriteMs` | Accumulated worker diagnostic-write overhead before final output. Millisecond resolution can round small writes to zero. |
| API `result_api` | Accepted financial result request entry through response completion. |
| POS `status_roundtrip` | Browser status-query latency. |
| POS `result_observed` | Click-to-first-observed backend result, including polling wait. Absent after a browser reload because the original monotonic start is unavailable. |
| Bridge `dispatchGapMs` in summary | Server attempt creation to claim timestamp. This overlaps preparation/claim work; it is a correlation interval, not a standalone network span. |

Use these comparisons:

- High browser preparation latency with a short API span points to session,
  browser, network or proxy time outside the API span. Nginx and transport are
  included in that residual; they are not separately identifiable from these
  measurements alone.
- High `prePurchaseMs` points to preparation on the worker path. Inspect claim,
  SDK setup and diagnostic overhead to narrow it down.
- Short preparation followed by a long `purchaseCallMs` places the wait inside
  the external SDK/terminal interval. It does not identify the terminal, SDK,
  bank or customer individually.
- Delayed POS observation can be examined using delivery records, API result
  spans, status-query spans and the existing three-second polling schedule.

Do not sum overlapping totals or subtract clocks on different computers.
Monotonic elapsed milliseconds are measured within each process. UTC timestamps
are for ordering local records. Durations are not silently capped at 60 seconds;
the telemetry contract rejects values beyond one day.

## Local diagnostics, retries and incomplete attempts

The cashier journal is:

```text
%LOCALAPPDATA%\RunCafe\SepBridge.Payments\attempts\ATTEMPT_UUID.intent.json.diagnostics.jsonl
```

Use the configured `DataDirectory` instead if the installed settings override
it. Records include UTC time, process ID, bridge/schema version, fixed phase and
outcome, and elapsed milliseconds where an operation finished.
`EVIDENCE_DELIVERY` and `TIMING_DELIVERY` record each HTTP delivery attempt,
its acknowledgment or retry outcome, and duration. Timestamps show retry gaps
and process IDs distinguish restart sessions. Separate `.delivered` and
`.timing-delivered` markers prevent acknowledged messages being resent.

An interrupted worker can produce a partial summary. `completeness=interrupted`
means the worker did not emit its normal total. A missing phase is unknown or
not reached, never zero. Consult local phase outcomes to distinguish skipped,
failed and interrupted stages; do not include incomplete samples in successful
stage averages. `completed` describes worker execution, not payment approval.

## Persistence, overhead and upgrade behavior

Financial requests and responses use the unchanged 0.2.4 signature and wire
format. Telemetry uses a separate `sep-timing-v1` HMAC purpose and endpoint.
Older saved evidence without timing fields remains deliverable. Deploying the
new API first accepts the old bridge. Rolling the API back still accepts
financial evidence from the new bridge; telemetry retries until supported.
Timing fields are excluded from financial evidence identity.

API HTTP telemetry is queued after response completion. The queue holds at
most 128 pending writes with one writer, a 500 ms queue wait limit, a one-second database statement limit,
a 250 ms connection wait limit and a 1.5-second transaction limit. Queue/persistence failures remain in the
structured journal. Dedicated timing endpoints acknowledge only after their
bounded database write succeeds, so browser and bridge retries retain their
report IDs. This telemetry never initiates or retries a purchase.

The browser stores up to 64 unsent timing events in local storage, retries on
later payment/status observations, and uses a three-second delivery timeout.
The oldest event is dropped with a console warning when full. Storage failures
fall back to console records. Browser reloads therefore preserve queued events,
but cannot reconstruct an unrecorded start time.

Diagnostic files use ordinary buffered writes instead of per-event disk fsync.
Financial dispatch/evidence journals retain their durable writes. Worker
logging overhead is measured; filesystem errors in diagnostic recording do not
change purchase handling. A forced process termination may lose buffered
records, which must remain incomplete in the analysis.

No new database migration is required. Receipt/bank verification remains the
payment authority; timing records do not prove a charge or a safe retry.


## Bridge 0.2.6 interpretation

Per-payment connectionTestMs and purchaseReinitializationMs are absent in the
new direct-purchase flow. Their absence means those steps were removed, not that
the terminal connected in zero time. A separate connection-only worker runs
every 60 seconds when no payment is active; its last status, elapsedMs and age
are returned by passive GET /health in terminalConnection. These background
durations are not payment preparation durations and must not be added to them.
A purchase queued during an already-running background check may wait for it
before its worker starts. Host workerProcessMs includes that wait; the worker
prePurchaseMs and workerTotalMs begin after it. POS browser click-to-result
and server creation-to-claim spans also include that scheduling wait.
