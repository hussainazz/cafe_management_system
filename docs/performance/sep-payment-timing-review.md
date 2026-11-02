# SEP payment timing implementation review

Reviewed 1 November 2026. The findings below describe the first candidate.
Remediation now preserves the legacy financial protocol, sends independently
signed and deduplicated telemetry, moves API telemetry off financial response
paths, adds browser spans and SDK pre-call/factory spans, and records delivery
retries. See the updated timing runbook for current semantics.

The user clarified that terminal/SDK processing is an external interval. The
implementation measures entry/return around that call; individual display or
bank events are outside the diagnostic scope. Nginx/network time is included
in browser round trips and cannot be separated by the API measurements alone.
No real terminal call was made during remediation.

## Findings

1. **High: result protocol compatibility is broken.**
   `terminal-signatures.ts:15` appends a newline even when timings are absent.
   Existing 0.2.4 signatures therefore fail on the new API. Conversely the old
   API rejects the new timing payload. `BackendClient.cs:30` also indexes
   `timingsMs` unconditionally, so the new bridge cannot deliver pending legacy
   evidence files without that property. Preserve the legacy encoding when
   timings are absent and define an explicit version for timed messages. Cover
   API-first rollout, rollback, and old journal replay with conformance tests.

2. **High: timing persistence can add unmeasured delay to payment handling.**
   Both timing audit inserts in `terminal-payments.routes.ts` are awaited after
   the duration has been computed. A slow insert delays the POS authorization
   response or bridge acknowledgment while remaining absent from `durationMs`.
   Catching a database failure does not bound a slow operation. Bridge timing
   records also use synchronous write-through and `Flush(true)` between SDK
   stages. These costs are outside individual SDK durations but inside broader
   totals. Separate or bound telemetry work and measure its overhead explicitly.

3. **High for the stated diagnosis: terminal amount-display time is unobserved.**
   `purchaseCallMs` wraps the whole synchronous SDK purchase, including terminal
   interaction and the customer's payment activity. It cannot establish when
   the amount first appears on the terminal. SDK entry is observable; socket
   transmission, terminal acknowledgment and screen display are not currently
   observable separately. Use a documented vendor event if available, or a
   synchronized operator observation/video marker. Do not label the whole
   purchase duration as amount-transmission latency.

4. **Medium: several request/response participants have no individual spans.**
   Browser click-to-prepare response, session refresh/retry, local bridge fetch
   and CORS preflight, Nginx request handling, bridge socket parsing/response,
   process startup, key loading and SDK factory construction are missing or
   folded into other totals. API prepare timing begins after authentication.
   `dispatchGapMs` starts at attempt creation inside the preparation transaction
   and ends at the claim timestamp inside another transaction. It overlaps
   other timings and excludes the initial browser request. It cannot replace
   browser round-trip measurements. No full click-to-display or result-to-UI
   measurement exists; the three-second POS polling interval is unmeasured.

5. **Medium: result delivery and failure coverage are incomplete.**
   `DeliverEvidence` does not measure each report attempt, acknowledgment,
   retry delay or restart recovery. VPS timing rows are written only after
   successful prepare/result service calls. Invalid requests, failed claims,
   conflicting evidence and lost responses have no corresponding complete VPS
   timeline. A worker killed inside a stage leaves the duration absent without
   an explicit timeout/incomplete status in the compact timing payload. Phase
   outcomes remain local. Duplicate delivery creates duplicate timing rows.

6. **Medium: records lack measurement and aggregation context.**
   No timing schema/build identifier, process start identity, terminal identity
   in the timing snapshot, completeness marker or observation source accompanies
   the compact durations. Some values silently clamp at 60,000 ms. Durations
   overlap, and only the local file carries stage timestamps. Define completed,
   failed, timed-out and missing samples, deduplication by attempt/report, clock
   source, overlap rules and version filtering before comparing attempts.

7. **Release check fails.**
   `python3 apps/sep-bridge/tests/payments_test.py` fails its C# result-message
   assertion at `PaymentEngineTests.cs:45-46`. The fixture now contains timings,
   but the C# conformance check still constructs the old message. Update the
   check to exercise the production message builder and add legacy/timed vectors.
   TypeScript-only proof tests passing do not establish cross-language parity.

Telemetry is also included in the financial result fingerprint because
`reportTerminalResult` hashes the whole body except `sentAtUnix`. A future
timing correction can consequently turn unchanged financial evidence into a
conflicting result. Define telemetry idempotency separately from payment evidence.

## Coverage map at initial review

| Participant or boundary | Current coverage |
| --- | --- |
| POS browser and session recovery | No elapsed spans |
| Browser to VPS network and Nginx | No dedicated spans |
| API preparation | Service-level duration, excludes auth and timing insert |
| POS to localhost bridge and preflight | No browser round-trip spans |
| Bridge intent acceptance and queue | Measured after HTTP parsing |
| Worker validation, mutex and backend claim | Measured, with setup work outside spans |
| SDK hashes, network setup, initialization and connection test | Measured |
| SDK factory construction | Unmeasured separately |
| Purchase call and cleanup | Measured as opaque SDK calls |
| Terminal receipt/display and bank processing | Unobserved separately |
| Bridge evidence delivery, retries and restart | No elapsed delivery spans |
| API result service | Measured only on accepted results |
| POS polling and visible update | No elapsed spans |

## Checks performed

- SDK-free C# payment safety/conformance suite: failed at the result-message
  assertion. Later assertions in that executable were not reached.
- SDK-free lifecycle fake scenarios: passed.
- TypeScript terminal-signature unit tests: 2 passed with a temporary unit-only
  configuration, avoiding database setup. The normal project configuration
  initially refused to run because test database environment variables were
  absent; no database was accessed.
- No VPS/cashier installation or financial transaction was performed.

Remediation checks now pass for legacy financial encoding, independent timing
HMACs, telemetry-only retry/deduplication, nonblocking financial responses,
bounded persistence, and browser timing delivery. Current coverage and the
external SDK/terminal boundary are documented in the runbook. Production
measurement still requires deploying both components and collecting real
operator-initiated attempts.
