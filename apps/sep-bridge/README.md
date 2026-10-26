# SEP bridge Phase B: health and browser compatibility

This artifact is read-only. It has no SEP dependency, terminal connection,
purchase route, pairing secret, or payment state. It cannot take a payment.
Actual Firefox ESR 115 evidence is still required before Phase C/D financial
implementation. The user approved and the agent completed health-only Windows
installation/startup on 25 October. See [the Windows verification record](../../docs/runbooks/sep-health-windows-verification.md)
for actual results, unchanged Restricted execution policy, and commands that
do not require script-file execution. The packaged README is the pre-install
snapshot; the approved executable and configuration have not changed.

## Build and automated checks

From the repository root on Linux with Mono installed:

```bash
python3 apps/sep-bridge/tests/health_test.py
python3 apps/sep-bridge/package-health.py
pnpm --filter @cafe/pos exec vitest run app/lib/sep-bridge-diagnostic.test.ts app/components/payment-bridge-diagnostic.test.tsx
pnpm --filter @cafe/pos typecheck
```

The package script produces
`apps/sep-bridge/dist/run-cafe-sep-health-0.1.0-x86.zip`, a SHA-256 sidecar,
and a manifest containing per-file and source hashes. Build outputs are ignored
by Git. Tests inspect the running Linux socket and PE/CLR x86 flags. Mono
execution is not Windows 8.1 runtime evidence.

For a Windows source build with .NET Framework 4.8 installed:

```powershell
powershell.exe -NoProfile -File .\apps\sep-bridge\build.ps1
```

Alternatively, with MSBuild and the .NET 4.8 targeting pack:

```powershell
MSBuild.exe .\apps\sep-bridge\RunCafe.SepBridge.csproj /p:Configuration=Release /p:Platform=x86
```

The build is a C# 5 x86 Windows GUI executable and opens no console. A Windows
source build must be repackaged and checksummed before installing; do not reuse
the manifest from another build. No Node.js or SDK installation is required
on the cashier. PowerShell scripts must comply with the machine's existing
execution policy; stop and report a policy failure rather than changing a
machine-wide policy.

## Transfer after approval

The following Linux command sends only the health ZIP through the existing SSH
connection and writes a new file under the known Windows Documents path. It
does not start or install it. It avoids assuming Bitvise's SFTP drive mapping.
Do not run it until the cashier transfer is approved. Never supply passwords
in commands or files. Check that the destination filename is unused first.

```bash
ssh -T 'cafe run@192.168.1.102' 'powershell.exe -NoProfile -Command "$p = '\''C:\Users\Cafe Run\Documents\sep-health-0.1.0.zip'\''; if (Test-Path -LiteralPath $p) { throw '\''Destination already exists'\'' }; $s = [IO.File]::CreateNew($p); try { [Console]::OpenStandardInput().CopyTo($s) } finally { $s.Dispose() }"' < apps/sep-bridge/dist/run-cafe-sep-health-0.1.0-x86.zip
sha256sum apps/sep-bridge/dist/run-cafe-sep-health-0.1.0-x86.zip
```

After connecting as the existing cashier account, use PowerShell. Compare the
Windows checksum with the Linux value before extraction. This is a separate
health installation and never moves or registers the existing SEP DLLs.

```powershell
$zip = 'C:\Users\Cafe Run\Documents\sep-health-0.1.0.zip'
Get-FileHash -Algorithm SHA256 -LiteralPath $zip
$stage = 'C:\Users\Cafe Run\Documents\sep-health-0.1.0'
if (Test-Path -LiteralPath $stage) { throw 'Staging directory already exists' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory($zip, $stage)
Set-Location -LiteralPath $stage
.\install-health.ps1
```

The installer verifies its manifest, restricts its per-user data directory,
copies to `%LOCALAPPDATA%\RunCafe\SepBridge.Health\bin`, and registers the
`RunCafe SEP Health` login task for the existing account with `Limited` run
level and interactive logon. It refuses to overwrite an existing installation.
It does not start the executable. Task Scheduler support/permissions and the
Windows build/install scripts still require actual Windows verification.

## Start, inspect, stop, restart

Run as `cafe run`, with that account logged into the desktop:

```powershell
Start-ScheduledTask -TaskName 'RunCafe SEP Health'
Start-Sleep -Seconds 1
Get-ScheduledTaskInfo -TaskName 'RunCafe SEP Health'
Invoke-RestMethod -Uri 'http://127.0.0.1:18711/health' -TimeoutSec 5
netstat.exe -ano -p tcp | Select-String ':18711'
Get-Content (Join-Path $env:LOCALAPPDATA 'RunCafe\SepBridge.Health\bridge.jsonl') -Tail 30
```

Confirm a listener on **127.0.0.1:18711**, never `0.0.0.0`, `::`, or the LAN IP.
The process uses `TcpListener(IPAddress.Loopback, port)` and exclusive binding,
so no HTTP.sys URL reservation or inbound firewall permission is needed.
Port defaults to `18711`; change `Port` in the installed `.exe.config` while
stopped, and set the POS diagnostic's matching `SEP_BRIDGE_PORT`.
`AllowedOrigin` defaults to the exact `https://runncafe.ir` origin, without a
path or trailing slash. Invalid configuration exits with code 2; startup/bind
failure exits with code 1. Logs contain only UTC time, fixed event names, and
status numbers, rotating at 256 KiB with two archives. Logs never contain raw
requests or browser/SDK data.

Clean stop and restart, from the extracted package directory:

```powershell
.\stop-health.ps1
Start-ScheduledTask -TaskName 'RunCafe SEP Health'
Invoke-RestMethod -Uri 'http://127.0.0.1:18711/health' -TimeoutSec 5
```

The stop script creates the local `stop.request` sentinel and waits at most
10 seconds. No HTTP stop/purchase endpoint exists. Startup clears a stale stop
sentinel. Active health reads may be interrupted at shutdown.

If it cannot stop, inspect the scheduled task and PID before explicitly forcing
`Stop-ScheduledTask -TaskName 'RunCafe SEP Health'`. The financial bridge will
need different durable-recovery acceptance; this health executable has no
transactions to recover.

## Actual Firefox ESR 115 gate

The POS route `/pos/diagnostics/payment-bridge` is unavailable by default.
Set these server environment variables for an explicitly approved POS test
release, restart that POS process, and leave the payment feature disabled:

```text
SEP_BRIDGE_DIAGNOSTICS_ENABLED=true
SEP_BRIDGE_PORT=18711
```

This is a production POS configuration/release action and requires separate
approval. A local-only check can start POS using:

```bash
SEP_BRIDGE_DIAGNOSTICS_ENABLED=true pnpm --filter @cafe/pos dev
```

On the cashier, sign in to the HTTPS POS, then open:
`https://runncafe.ir/pos/diagnostics/payment-bridge`.
There is no automatic bridge request on page load. Click the single diagnostic
button. It performs two credential-free GETs to the fixed loopback health URL;
the second includes `X-Run-Cafe-Diagnostic: 1`, requiring browser preflight.
It does not use the authenticated API client for loopback requests and cannot
replay a payment. The user session gate is UI access control only; the public
health response intentionally contains no sensitive information.

Record these observations with date and exact Windows/Firefox version:

1. Both GETs return the exact health-only response. The browser Network panel
   shows the second request's OPTIONS returning 204, exact allowed origin,
   GET-only permission, and the diagnostic header. No credential sharing.
2. The delivered POS document's response headers and any meta CSP allow this
   connection. Record effective `connect-src`, fallback `default-src`, and
   mixed-content/upgrading directives. Source configuration alone is not proof.
3. The console reports no mixed-content or CORS/CSP block. A fetch failure alone
   cannot distinguish a stopped bridge, CORS, CSP, mixed content, or proxy error.
4. Repeat using the cashier's normal proxy/VPN configuration and its approved
   alternate state. Do not change global browser security preferences.
5. Stop the bridge and repeat. It must report connection failure, never device
   failure, payment success/failure, or an automatic retry. Restart and click
   explicitly again.
6. Review the automatic origin-rejection tests and optionally verify the same
   403 without CORS permission locally:

```powershell
try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:18711/health' -Headers @{ Origin = 'https://invalid.example' } -TimeoutSec 5 } catch { $_.Exception.Response.StatusCode }
```

To establish the same transport gate before deploying the POS diagnostic page,
the operator can run the following reviewed health-only snippet in the Web
Console of the existing authenticated `https://runncafe.ir/pos` page. It uses the
existing document's CSP and avoids a production release just for diagnostics.
It only logs read-only health results and cannot contact the terminal. Open
the Network panel first so OPTIONS is captured. Record document CSP headers
as described above. Do not bypass a browser security warning to run it.

```javascript
(async function () {
  if (location.origin !== "https://runncafe.ir") throw new Error("Use the café POS origin");
  for (const preflight of [false, true]) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch("http://127.0.0.1:18711/health", {
        method: "GET", mode: "cors", credentials: "omit", cache: "no-store",
        redirect: "error", signal: controller.signal,
        headers: preflight ? { "X-Run-Cafe-Diagnostic": "1" } : {}
      });
      console.log({ preflight, status: response.status, health: await response.json() });
    } catch (error) {
      console.log({ preflight, error: String(error) });
    } finally { clearTimeout(timer); }
  }
})();
```

Browser transport is not approved until these observations exist on the actual
cashier. If HTTP loopback is blocked, stop financial work and review a compatible
secure alternative. Mozilla documents the loopback exception, but that is not
device-specific evidence:
<https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content#loading_locally_delivered_mixed-resources>.

The small, bounded HTTP parser deliberately serves only one read-only resource,
rejects bodies/chunking/duplicate headers, and closes each connection. This
Phase B proof does not approve that parser for future payment transport.
The financial transport needs separate authenticated-request/body review and
fault tests before adding any operation.

## Disable and rollback

Disable `SEP_BRIDGE_DIAGNOSTICS_ENABLED` in the approved POS environment and
restart only that POS process. To remove login startup, first cleanly stop the
health task, then:

```powershell
Unregister-ScheduledTask -TaskName 'RunCafe SEP Health' -Confirm:$false
$bin = Join-Path $env:LOCALAPPDATA 'RunCafe\SepBridge.Health\bin'
$retired = Join-Path $env:LOCALAPPDATA ('RunCafe\SepBridge.Health\bin.retired-' + (Get-Date -Format 'yyyyMMddHHmmss'))
Move-Item -LiteralPath $bin -Destination $retired
```

Keep logs and the retired binaries for inspection. No database/schema rollback,
SEP COM registration, terminal setting, user account, or firewall change exists
in this phase. Future payment installation/rollback is Phase F work.
