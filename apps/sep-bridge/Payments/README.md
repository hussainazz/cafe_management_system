# SEP payment bridge 0.2.0

Windows 8.1 32-bit, .NET Framework 4.8, x86 WinExe. No Node.js runtime,
HTTP.sys URL reservation, administrator account, or inbound firewall rule.
This release is disabled by default. It has not been installed or run against
the cashier terminal. Existing health/diagnostic installations are separate.

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

The setup's observed tester calibration is preserved: SDK input 1000 corresponded
to 1000 Toman / 10000 Rial. No x10 conversion is applied. The worker passes the
integer Toman amount as invariant decimal text; unused extensions are null,
ReserveFlag and totalAmount are -1, and ValidTerminalID is the expected terminal.
See `docs/planning/sep-ssp1126-sdk-contract.md` for IL evidence. This is not proof
of the unit/meaning of returned amount fields. Therefore all device outcomes,
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
python3 apps/sep-bridge/Payments/package.py --sdk-directory '/home/hosein/Downloads/Telegram Desktop/SSP1126-DLLs'
(cd apps/sep-bridge/dist/payments && sha256sum -c run-cafe-sep-payments-0.2.0-x86.zip.sha256)
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

No commands below have been executed for this financial release. Production
API/schema release and financial bridge installation/activation need explicit
approval. Retain backend configuration while disabling initiation so late signed
evidence and reconciliation remain available.

Transfer only the reviewed ZIP, after its checksum is recorded:

```bash
sftp -oBatchMode=yes -oConnectTimeout=8 -oStrictHostKeyChecking=yes -b - 'cafe run@192.168.1.102' <<'SFTP'
put "apps/sep-bridge/dist/payments/run-cafe-sep-payments-0.2.0-x86.zip" "/C:/Users/Cafe Run/Documents/run-cafe-sep-payments-0.2.0-x86.zip"
SFTP
ssh -T -oBatchMode=yes -oConnectTimeout=8 -oStrictHostKeyChecking=yes 'cafe run@192.168.1.102'
```

Use PowerShell 4 commands as that existing user. Verify the ZIP hash against the
separately reviewed Linux value, then extract without modern Expand-Archive:

```powershell
$zip = 'C:\Users\Cafe Run\Documents\run-cafe-sep-payments-0.2.0-x86.zip'
(Get-FileHash $zip -Algorithm SHA256).Hash
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stage = 'C:\Users\Cafe Run\Documents\sep-payments-0.2.0-stage'
[IO.Compression.ZipFile]::ExtractToDirectory($zip,$stage)
& "$stage\install.ps1" -ApproveFinancialBridgeInstall
```

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
Start-ScheduledTask -TaskName 'RunCafe SEP Payments'
Invoke-RestMethod -Proxy $null 'http://127.0.0.1:18711/health'
```

Activation is a separate approved operation. After pairing, browser acceptance,
and confirmation no unresolved prior charge or worker exists, stop the host,
change `PaymentsEnabled` to `true` in BOTH installed executable configs, and
activate backend `SEP_TERMINAL_ENABLED=true` in a coordinated release. Keep
LogPermission at 0, expected terminal identity 31187710, and the pinned DLLs.
Restart the task. A new financial test requires a separate explicit approval of
one order, amount, and attempt. The installation itself grants no such approval.

## Inspect, stop, restart, rollback

```powershell
Get-ScheduledTask -TaskName 'RunCafe SEP Payments'
Get-ScheduledTaskInfo -TaskName 'RunCafe SEP Payments'
Get-Process -Name 'RunCafe.SepBridge.Payments','RunCafe.SepBridge.PurchaseWorker' -ErrorAction SilentlyContinue
Get-NetTCPConnection -LocalPort 18711 -State Listen
Invoke-RestMethod -Proxy $null 'http://127.0.0.1:18711/health'
Get-Content "$env:LOCALAPPDATA\RunCafe\SepBridge.Payments\bridge.jsonl" -Tail 30
Get-ChildItem "$env:LOCALAPPDATA\RunCafe\SepBridge.Payments\attempts" | Select-Object Name,Length,LastWriteTimeUtc
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
Actual login startup, Windows worker deadline/contention and DPAPI round-trip,
HTTPS bridge-to-backend TLS reachability, and the deployed financial POST
preflight remain target-machine acceptance checks. Health GET/preflight and one
non-payment official SDK connection test already passed on this cashier.

## Exact Restricted-policy command generation

The helper prints a reviewed command and never contacts Windows. Inspect the
source scripts first. After separate approval, these commands execute exactly
that script body under the existing policy without importing a script file:

```bash
python3 apps/sep-bridge/Payments/reviewed-command.py install > /tmp/sep-install-command.txt
ssh -T -oBatchMode=yes -oStrictHostKeyChecking=yes 'cafe run@192.168.1.102' "$(cat /tmp/sep-install-command.txt)"
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
