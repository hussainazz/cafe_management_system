# SEP payment bridge 0.2.4

Windows 8.1 32-bit, .NET Framework 4.8, x86 WinExe. No Node.js runtime,
HTTP.sys URL reservation, administrator account, or inbound firewall rule.
Version 0.2.4 is installed under the existing cashier account and the scheduled
task is Running. The current VPS flag and Windows payment switch are enabled;
the bridge health endpoint reports payments mode, but requires manual result
verification before posting. It listens only on `127.0.0.1:18711`. No purchase
was initiated during this activation. Pairing and the durable attempt journal
remain preserved. The earlier
350,000 Toman attempt `3ae7bd3a-07e5-4cbd-a107-c86f2f032a41` was reconciled as
`FAILED` after the operator confirmed no receipt or debit; no settlement was
posted. The order was then still open and unpaid at 350,000 Toman. Two later POS
attempts were created. `4e72ae38-6b21-4c52-a892-91cf6b28de92` was resolved
`FAILED` with `TERMINAL_RECEIPT`. The latest,
`26f4fe04-7faa-491c-998d-49921f8813ad` was later reconciled `FAILED` with
`TERMINAL_RECEIPT`, no response code, and no linked settlement. Its audit
records no-charge, terminal-idle, and bridge-stopped confirmations. Its
diagnostic confirms the SDK connection test passed
(`00`), then `PcStarterPurchase` was entered and returned no result (worker exit
code 1); cleanup completed. The SDK evidence cannot prove whether the request
reached the terminal or whether it was approved. The operator saw a terminal
communication message and later reconciled the attempt as no-charge. New
initiation is paused: the backend flag and both Windows payment settings are
false, the payment task is Disabled, and no host, worker, or loopback listener
remains. The operator reports no matching bank transaction for the automated
attempt. A separate manual POS settlement was recorded as 350,000 Toman
`CARD_TERMINAL` seven
seconds after reconciliation; it is not linked to the terminal attempt. The
order is now CLOSED/PAID, and the operator confirms the settlement corresponds
to an actual debit. Health checks and polling never charge.

Incident trace for this attempt: cashier intent-file time was 18:40:26 UTC and
the signed backend issue time was 18:40:35 UTC (about 9 seconds of cashier
clock lag), inside the worker's 30-second future-time allowance. The worker
started and the backend claim was accepted; the journal evidence was produced
about 3 seconds later on the cashier clock. The operator reports no receipt or
debit in the Q80 or bank history. This was not the 30-second worker timeout.
Version 0.2.0 did not persist the worker exit code or SDK phase, and maps any
precheck failure, worker exception, missing output, or timeout to the same
empty `UNKNOWN` evidence. Consequently the journal cannot show whether
`PcStarterPurchase` was reached or which preflight failed. That old journal is
not evidence about version 0.2.1's phase logging.

Version 0.2.1 writes ordered local-only `.diagnostics.jsonl` records beside
each intent. Records contain fixed phase/outcome codes, a bounded process exit
code, and only a validated response code. They never contain exception text,
response descriptions, PAN, RRN, or trace and are never sent to the backend.
The ordinary payment evidence and manual reconciliation gate remain unchanged.

## Confirmed null-result cause and 0.2.3 fix

Static inspection of the pinned SDK IL identifies the exact failure in the
0.2.1 sequence. `ConnectionTest()` enters `DoSyncOperation`, which calls
`EndOfTransaction`; network `Dispose()` sends its close message, disconnects,
sets `Channel` to null, and clears the SDK's IP and port. The bridge then called
`PcStarterPurchase()` on that same factory. Its transaction-initialization
guard returns null when the network channel is null, before constructing or
sending a purchase message. This matches the observed successful connection
test followed by `RETURNED_NO_RESULT` and explains why the tester could reach
the terminal while the bridge did not begin the purchase protocol.

Version 0.2.3 reapplies `SetLan` and `Initialization(English, 10, Sync)` after
the connection test and before `PcStarterPurchase`. This reconstructs the
cleared network channel. It retains the inspected ten-argument purchase
signature, amount, terminal identity check, timeout/unknown handling, and
manual verification gate. Fake lifecycle tests assert that purchase cannot
start until the SDK is initialized again after the test. The disabled health
response reports version 0.2.3, `mode=health-only`, and `terminalAccess=false`.

## Amount-unit incident and correction in 0.2.4

The backend authorizes integer Toman. In the 29 October attempt for order
`46f27c22-cf07-48c1-8cdd-6af015313de5`, version 0.2.3 passed `590000` directly
to `PcStarterPurchase`; the operator observed `590000` on the terminal rather
than the expected `5900000` Rial. The exact managed API takes `mainAmount` as
decimal text, the bridge had no conversion, the SDK purchase message includes
currency `364` (IRR), and it returned response `98`. The SDK defines `98` as
its cancel response. No settlement was posted; the backend attempt remains
`UNKNOWN` until audited reconciliation. The user's report that no debit
occurred and terminal history was cleared is recorded, but does not change the
durable attempt state by itself.

Version 0.2.4 converts the validated amount once at the bridge boundary:
`590000` Toman becomes `5900000` Rial. The conversion is covered by an
SDK-free test. This corrects the automated path based on the observed terminal
amount and IRR message currency; the earlier successful tester calibration
was insufficient to establish the behavior of the bridge path. No payment was
performed while making or testing this change. At the time this correction was
prepared, the package was disabled and not installed; its later activation is
recorded under the current activation snapshot below. Do not use it for a charge
without cashier-side amount confirmation.

The terminal text remembered as `signum(13)` does not appear in the official
DLL strings/IL or supplied setup guide, and no authoritative SEP description
was found. The bridge evidence establishes SDK response code `98` (cancel),
but does not prove what internal terminal `signum(13)` means or whether the
wrong amount caused that display. Ask SEP for its model/firmware-specific
meaning before attributing it to an amount rejection.

## Architecture and limits

HTTPS POS -> IPv4 loopback host -> isolated official managed SDK worker ->
192.168.1.101:1197 / terminal 31187710. The backend authorizes an immutable
checkout and owns all settlements. Direct managed references avoid legacy COM
interface/version ambiguity and registration changes. Package only the pinned
SSP1126 1.4.11.1 and Sep.Logger 1.0.0.2 pair. Never move or replace the registered
Documents DLLs or re-register them as part of this installation.

`GET /health` is read-only and never contacts the device. `POST /payments`
requires the exact allowed Origin, application/json, and a valid backend-signed
intent. It returns promptly after durable reservation, not after payment.
`POST /status` accepts that same signed intent and only reads an existing local
attempt. An expired intent may read/replay a known attempt but cannot start a
new one. Browser recovery polls the authenticated backend, never the purchase
endpoint. Device diagnostics remain the explicitly gated one-shot CLI in
`../Diagnostics`; no unauthenticated HTTP terminal-test endpoint is added.

The host validates exact Host/Origin, bounded headers/body, preflight, methods,
and a total socket deadline. It binds exclusively to 127.0.0.1. Browser requests
omit cookies and use no global browser security exceptions. CORS is only an
origin restriction; HMAC authorizes the amount and attempt.

Pairing uses a unique random 32-byte installation key. Keep it only in protected
backend configuration and Windows CurrentUser DPAPI storage. JavaScript receives
short-lived signed intent capabilities, never that key. Same-account malicious
Windows software is outside this boundary: it can read the user's credentials
and operate the terminal. Protect the cashier login and installation directory.

An immutable local `.intent.json` file is flushed to disk before backend claim.
The claim is redeemed once. A lost claim acknowledgment never starts a purchase.
The worker creates its own exclusive `.worker-started` marker and holds the same
Global terminal mutex as the diagnostic worker, through SDK cleanup. Duplicate
requests and process restarts never enqueue an existing marker. The worker
checks the terminal identity before calling the exact ten-argument
PcStarterPurchase method. No retry, reversal, bank inquiry, or automatic refund
exists. Sync English initialization uses 10 seconds; SetLan precedes it.
The process deadline is 30 seconds, followed by a kill/wait boundary of 5 seconds.
A surviving worker keeps the terminal mutex. Never assume the bank declined
because that worker timed out, was killed, or failed cleanup.

The worker converts authorized integer Toman to Rial before the SDK call;
unused extensions are null, ReserveFlag and totalAmount are -1, and
ValidTerminalID is the expected terminal. See
`docs/planning/sep-ssp1126-sdk-contract.md` for the inspected message currency
and exact API. This does not prove the unit/meaning of returned amount fields.
Therefore all device outcomes,
including 00, require explicit Staff/Manager receipt or bank verification before
the backend posts money. No-charge resolution also requires confirming the
terminal is idle and the Windows purchase process has stopped.

Only sanitized code, terminal ID, RRN and trace leave the worker. Vendor logging
must be effectively disabled (`LogPermission=0`), and loaded assembly hashes must
match before constructing the factory. Do not serialize SDK results/exceptions
or inspect raw vendor logs. SDK cleanup can perform network operations.

Sanitized `.evidence.json` files are delivered with purpose-separated HMAC.
Only evidence delivery can repeat automatically, including after restart. The
`.delivered` marker prevents routine repeated reports. A backend 409 leaves the
evidence retained for investigation. Never delete an unresolved journal to make
a payment retry possible. Journal growth is intentional financial recovery data;
archive resolved attempts only through a separately reviewed retention procedure.

## Build and fake checks on Linux

From repository root:

```bash
pnpm --filter @cafe/contracts build
pnpm --filter @cafe/api prisma:generate
pnpm --filter @cafe/api typecheck
pnpm --filter @cafe/api test
pnpm --filter @cafe/pos test
pnpm --filter @cafe/pos typecheck
python3 apps/sep-bridge/tests/health_test.py
python3 apps/sep-bridge/tests/diagnostics_test.py
python3 apps/sep-bridge/tests/worker_guard_test.py
python3 apps/sep-bridge/tests/payments_test.py
python3 apps/sep-bridge/tests/payment_host_test.py
uv run --with pytest pytest -q apps/sep-bridge/tests/purchase_lifecycle_test.py apps/sep-bridge/tests/sep_amount_test.py
python3 apps/sep-bridge/Payments/package.py --sdk-directory '/home/hosein/Downloads/Telegram Desktop/SSP1126-DLLs'
(cd apps/sep-bridge/dist/payments && sha256sum -c run-cafe-sep-payments-0.2.4-x86.zip.sha256)
```

Run the checksum command from its archive directory, or supply the archive path
explicitly. Builds and tests never call the real terminal. CI needs Mono mcs
4.8 reference assemblies for C# checks; SDK-free tests do not need vendor files.
To build with Microsoft's compiler on a suitable separate Windows build machine:

```powershell
& .\apps\sep-bridge\Payments\build.ps1 -SdkDirectory 'C:\Users\Cafe Run\Documents'
```

Do not compile on or install onto the live cashier incidentally. The Linux
package command compiles binaries and pins a manifest. It never executes them.
Verify PE32 GUI subsystem, CLR 32BITREQUIRED, matching net48 metadata and package
hashes. A Microsoft compiler build is not byte-identical to a Mono build; create
and review a new manifest before substituting any binaries.

## Deployment commands for separate approval

The coordinated API/schema release, Windows bridge installation, protected
pairing, and Firefox loopback checks are complete. The 29 October order attempt
returned SDK code 98 and remains UNKNOWN with no posted settlement. The current
activation snapshot is recorded below. Keep any attempt outcome subject to
explicit receipt or bank verification and audited reconciliation; never retry
an uncertain attempt.

### Current activation snapshot — 30 October 2026

Bridge 0.2.4 was transferred with SHA-256
`6d7937b87e891f3287eda0e3a9e86ec515a0884ba18f544b5de32822256d879d`, upgraded
under the existing cashier account, and started through Task Scheduler. The
task is Running; health reports `mode=payments`, `paymentEnabled=true`,
`terminalAccess=true`, and `manualVerificationRequired=true`. `netstat`
confirms the sole listener is `127.0.0.1:18711`. The VPS has
`SEP_TERMINAL_ENABLED=true`; `cafe-api.service` is active and readiness reports
the database connected. `/pos/release` reports `cafe-sep-75a2f4a`. No purchase
worker was running during verification and no payment was initiated. The
earlier unresolved attempt still needs its own audited reconciliation; enabling
the bridge does not resolve it.

The fresh-install script registers the logon-triggered task; disable it before
pairing or acceptance. For this already paired cashier, the earlier 0.2.3
versioned upgrade preserved the task, pairing, and journal, changed the task
action to the 0.2.3 binary, and left the task disabled at that time. The final
uploaded archive was checked against its adjacent `.sha256` file. The previous
health-only launch returned version 0.2.3, `mode=health-only`,
`paymentEnabled=false`, `terminalAccess=false`, and
`manualVerificationRequired=true`. It was stopped with `stop.request`; final
verification found no bridge or worker process and no listening socket. Both
installed payment switches remain false and vendor logging is disabled.

The following commands document the reviewed 0.2.4 transfer and upgrade path;
that upgrade has already been completed as recorded above. Do not rerun the
upgrade merely to refresh the POS control. Transfer only the reviewed ZIP after
its checksum is recorded when preparing a later approved reinstall:

```bash
sftp -oBatchMode=yes -oConnectTimeout=8 -oStrictHostKeyChecking=yes -b - 'cafe run@192.168.1.102' <<'SFTP'
put "apps/sep-bridge/dist/payments/run-cafe-sep-payments-0.2.4-x86.zip" "/C:/Users/Cafe Run/Documents/run-cafe-sep-payments-0.2.4-x86.zip"
SFTP
ssh -T -oBatchMode=yes -oConnectTimeout=8 -oStrictHostKeyChecking=yes 'cafe run@192.168.1.102'
```

Use PowerShell 4 commands as that existing user. Verify the ZIP hash against the
separately reviewed Linux value, then extract without modern Expand-Archive:

```powershell
$zip = 'C:\Users\Cafe Run\Documents\run-cafe-sep-payments-0.2.4-x86.zip'
(Get-FileHash $zip -Algorithm SHA256).Hash
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stage = 'C:\Users\Cafe Run\Documents\sep-payments-0.2.4-stage'
[IO.Compression.ZipFile]::ExtractToDirectory($zip,$stage)
& "$stage\install.ps1" -ApproveFinancialBridgeInstall
```

For the already paired cashier, do not run `install.ps1`. Keep backend
initiation disabled. With the payment task disabled, both payment switches
false, no bridge or worker running, and port 18711 free, use packaged
`upgrade.ps1` through the reviewed command helper. It preserves the DPAPI
pairing and journal, installs the pinned SDK pair under a new 0.2.4 directory,
updates the task action, and leaves the task disabled. The 0.2.3 directory
remains available for rollback:

```bash
python3 apps/sep-bridge/Payments/reviewed-command.py upgrade --approve-upgrade --backend-disabled --stage 'C:\Users\Cafe Run\Documents\sep-payments-0.2.4-stage' > /tmp/sep-upgrade-command.txt
cat /tmp/sep-upgrade-command.txt
```

Run that reviewed command from the cashier SSH session only after its stated
preconditions are true. Keep the task disabled until the fix is approved for a
supervised hardware run.

The upgrade completed on 29 October 2026. It changed only the task action and
installed versioned files/configs, retaining the shared attempt journal and
pairing. A hidden health-only launch was verified from Windows PowerShell using
`Invoke-RestMethod -Proxy $null`; its stop request was written using .NET
`[IO.File]::WriteAllText` for PowerShell 4 compatibility. No terminal SDK call
or payment occurred during this check. Do not enable the task or payment
settings until a supervised live test is explicitly approved.

The cashier's execution policy is Restricted. Do not alter it or use an
ExecutionPolicy bypass. The script commands above are reviewable file forms.
For that cashier, execute the reviewed script body inline through SSH using
PowerShell `-NoProfile -NonInteractive -EncodedCommand` with UTF-16LE base64,
substituting explicit parameter values and `$PSScriptRoot` with `$stage`. Split
commands below the Windows 8191-character limit. See the existing diagnostic
runbook for the exact inline execution pattern and observed policy evidence.

Before pairing, generate a random installation UUID and key in a private local
operations directory. Do not print either secret or include it in shell history:

```bash
install -d -m 700 "$HOME/.config/run-cafe-sep"
python3 - <<'PY'
import os, pathlib, secrets, uuid
root = pathlib.Path.home() / '.config/run-cafe-sep'
key = secrets.token_hex(32)
bridge_id = str(uuid.uuid4())
for name, value in {'pairing.key': key + '\n', 'backend.env': 'SEP_TERMINAL_ENABLED=false\nSEP_BRIDGE_ID=' + bridge_id + '\nSEP_TERMINAL_ID=31187710\nSEP_BRIDGE_HMAC_KEY=' + key + '\n', 'bridge-id.txt': bridge_id + '\n'}.items():
    fd = os.open(root / name, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as stream: stream.write(value)
PY
```

Provision backend.env into the protected production API environment only in the
approved coordinated API/migration release. Do not replace unrelated production
variables. Transfer pairing.key directly into the installed private Windows
root using SFTP, not Documents. Set `<installation UUID>` to bridge-id.txt's
non-secret value, then run the reviewed pairing body inline as described above:

```powershell
& "$stage\pair.ps1" -KeyFile "$env:LOCALAPPDATA\RunCafe\SepBridge.Payments\pairing.key" -BridgeId '<installation UUID>'
```

Pairing removes that plaintext Windows transfer file after DPAPI protection;
this is logical deletion, not secure disk erasure. Retain the protected source
key for recovery. Never rotate pairing while an attempt is unresolved.
The installation/pairing scripts do not start a process or enable purchases.

To start the financial host disabled for a harmless health check, first stop
the old health task so the port has one owner:

```powershell
New-Item -ItemType File -Force "$env:LOCALAPPDATA\RunCafe\SepBridge.Health\stop.request" | Out-Null
# Verify the health task is stopped before continuing.
Get-ScheduledTask -TaskName 'RunCafe SEP Health'
Disable-ScheduledTask -TaskName 'RunCafe SEP Health'
Enable-ScheduledTask -TaskName 'RunCafe SEP Payments'
Start-ScheduledTask -TaskName 'RunCafe SEP Payments'
Invoke-RestMethod -Proxy $null 'http://127.0.0.1:18711/health'
```

For a future activation, after pairing and browser acceptance, confirm no
unresolved attempt or worker exists, stop the host, change `PaymentsEnabled` to
`true` in both installed executable configs, and set backend
`SEP_TERMINAL_ENABLED=true`. Keep `LogPermission=0`, terminal identity 31187710,
and the pinned DLLs. Restart the task. Activation exposes terminal-assisted
checkout to authorized Staff/Managers; it does not initiate a charge. Each live
test still requires a specific order and amount, followed by staff initiation
and terminal confirmation.

## Inspect, stop, restart, rollback

```powershell
Get-ScheduledTask -TaskName 'RunCafe SEP Payments'
Get-ScheduledTaskInfo -TaskName 'RunCafe SEP Payments'
Get-Process -Name 'RunCafe.SepBridge.Payments','RunCafe.SepBridge.PurchaseWorker' -ErrorAction SilentlyContinue
Get-NetTCPConnection -LocalPort 18711 -State Listen
Invoke-RestMethod -Proxy $null 'http://127.0.0.1:18711/health'
Get-Content "$env:LOCALAPPDATA\RunCafe\SepBridge.Payments\bridge.jsonl" -Tail 30
Get-ChildItem "$env:LOCALAPPDATA\RunCafe\SepBridge.Payments\attempts" | Select-Object Name,Length,LastWriteTimeUtc
Get-Content "$env:LOCALAPPDATA\RunCafe\SepBridge.Payments\attempts\<attempt-id>.intent.json.diagnostics.jsonl"
& "$stage\stop.ps1"
Start-ScheduledTask -TaskName 'RunCafe SEP Payments'
```

Use the same reviewed inline form under Restricted policy. Do not print pairing
or full intent files in SSH logs. When a worker survives the stop deadline, do
not release the payment reservation. Inspect the specific worker PID and terminal
state. A separately approved forced stop still leaves its financial result
UNKNOWN. Check the bank record before attesting no charge.

For rollback: disable new initiation in backend, stop host and confirm purchase
workers exited, disable the financial task, set both PaymentsEnabled flags false,
retain pairing/journal/evidence, and retain the additive database table and APIs
needed to reconcile unresolved attempts. Do not drop financial history. Enable
and start the original health task only after confirming port 18711 is free:

```powershell
Disable-ScheduledTask -TaskName 'RunCafe SEP Payments'
Enable-ScheduledTask -TaskName 'RunCafe SEP Health'
Start-ScheduledTask -TaskName 'RunCafe SEP Health'
```

Rollback of a later bridge binary uses the previous versioned directory/task
and the same retained data root. No DLL/COM registration change is needed.
After stopping the host and confirming backend initiation remains disabled,
switch the task action back to the retained 0.2.0 binary while leaving the task
disabled:

```powershell
$oldBin = Join-Path $env:LOCALAPPDATA 'RunCafe\SepBridge.Payments\0.2.2'
$oldAction = New-ScheduledTaskAction -Execute (Join-Path $oldBin 'RunCafe.SepBridge.Payments.exe') -WorkingDirectory $oldBin
Set-ScheduledTask -TaskName 'RunCafe SEP Payments' -Action $oldAction | Out-Null
Get-ScheduledTask -TaskName 'RunCafe SEP Payments'
```

The DPAPI blob was unprotected under the cashier account and its SHA-256 matched
the source key without exposing the key. From the cashier, a .NET Framework
TLS 1.2 request with proxy disabled to the API readiness URL returned 200. The
financial host's POST preflight returned 204 with the exact café Origin and 403
with an unapproved Origin. Health reports `paymentEnabled=false`; netstat shows
only `127.0.0.1:18711`. A clean host stop/restart with no attempt present
returned to the same healthy, disabled state. The cashier Firefox diagnostic
reached the bridge: the allowed preflight returned 204 and the guarded empty
POST returned 503. No payment was initiated during that diagnostic check. The
staff-initiated 350,000 Toman checkout subsequently created attempt
`3ae7bd3a-07e5-4cbd-a107-c86f2f032a41` for order
`456e0c4e-61b9-4154-ab58-63322f458704`. It is `UNKNOWN`, with no response code,
RRN, trace, or settlement. The backend flag was returned to false and the
financial task disabled; checks found no worker or listener. Backend live and
readiness probes now return 200. Do not retry. Verify the Q80 and bank record
around 22:10:40 Iran time, then reconcile the original attempt with audited
evidence. Worker deadline/contention, login startup, and attempt recovery
remain open.
Health GET/preflight and one non-payment official SDK connection test also
passed on this cashier.

## Exact Restricted-policy command generation

The helper prints a reviewed command and never contacts Windows. Inspect the
source scripts first. After separate approval, these commands execute exactly
that script body under the existing policy without importing a script file:

```bash
python3 apps/sep-bridge/Payments/reviewed-command.py install > /tmp/sep-install-command.txt
ssh -T -oBatchMode=yes -oStrictHostKeyChecking=yes 'cafe run@192.168.1.102' "$(cat /tmp/sep-install-command.txt)"
ssh -T -oBatchMode=yes -oStrictHostKeyChecking=yes 'cafe run@192.168.1.102' 'schtasks.exe /Change /TN "RunCafe SEP Payments" /Disable'
sftp -oBatchMode=yes -oStrictHostKeyChecking=yes -b - 'cafe run@192.168.1.102' <<'SFTP'
put "/home/hosein/.config/run-cafe-sep/pairing.key" "/C:/Users/Cafe Run/AppData/Local/RunCafe/SepBridge.Payments/pairing.key"
SFTP
python3 apps/sep-bridge/Payments/reviewed-command.py pair --bridge-id "$(cat "$HOME/.config/run-cafe-sep/bridge-id.txt")" > /tmp/sep-pair-command.txt
ssh -T -oBatchMode=yes -oStrictHostKeyChecking=yes 'cafe run@192.168.1.102' "$(cat /tmp/sep-pair-command.txt)"
python3 apps/sep-bridge/Payments/reviewed-command.py stop > /tmp/sep-stop-command.txt
ssh -T -oBatchMode=yes -oStrictHostKeyChecking=yes 'cafe run@192.168.1.102' "$(cat /tmp/sep-stop-command.txt)"
```

After separately approving activation and confirming the calibrated input unit:

```bash
python3 apps/sep-bridge/Payments/reviewed-command.py configure --enable > /tmp/sep-config-command.txt
ssh -T -oBatchMode=yes -oStrictHostKeyChecking=yes 'cafe run@192.168.1.102' "$(cat /tmp/sep-config-command.txt)"
```

Without `--enable`, configure disables both executables. It requires host and
worker processes stopped and validates the expected terminal and pairing before
enabling. It never starts a task or changes backend configuration.
