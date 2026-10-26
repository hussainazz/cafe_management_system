# SEP health bridge: Windows installation evidence

Date: 25 October 2026. The user explicitly approved transfer, installation, and
startup of the Phase B health-only artifact. Financial operations and production
POS deployment were not authorized by this approval.

## Verified on the cashier

SSH connected using the existing trusted host entry and existing authentication,
as `Cafe-Run\Cafe Run` at `192.168.1.102`. No password was requested or stored.

| Observation | Result |
| --- | --- |
| OS | Microsoft Windows 8.1 Enterprise, 6.3.9600, 32-bit |
| PowerShell | 4.0 |
| .NET Framework Full Release | 528049 |
| Installed Firefox executable | Product version 115.43.1; this is file metadata, not a browser runtime test |
| PowerShell execution policy | Restricted before and after installation |
| ZIP SHA-256 on Linux and Windows | `6411104c97e93ca14190e9c2212fa5dbb119c63d0b39ccd717d23787b140236d` |
| Staging directory | `C:\Users\Cafe Run\Documents\sep-health-0.1.0` |
| Installation directory | `C:\Users\Cafe Run\AppData\Local\RunCafe\SepBridge.Health\bin` |
| Task | `RunCafe SEP Health`, Running, Limited, Interactive, enabled logon trigger for the existing account |
| Process at verification | PID 4948, session 2, no window |
| Windows socket | `127.0.0.1:18711`, LISTENING; no wildcard or LAN listener |
| Linux-to-cashier LAN port probe | Connection timed out; no accepted LAN connection |
| GET health on Windows | HTTP 200; health-only, `paymentEnabled=false`, `terminalAccess=false` |
| OPTIONS health on Windows | HTTP 204, allowed origin `https://runncafe.ir`, method GET, header `x-run-cafe-diagnostic` |
| Wrong origin on Windows | HTTP 403 with no Access-Control-Allow-Origin |
| Purchase route on this health host | HTTP 404; no implementation exists |
| Logs | Structured UTC event/status entries; startup and health HTTP 200 observed |

Installed binary and configuration hashes match the approved manifest:

```text
RunCafe.SepBridge.Health.exe
efd932702a89e22ca192a0569d471cdbef37b7c6566b4ba6e4a8bb94d7cfaad4
RunCafe.SepBridge.Health.exe.config
8393d76f78f84c73c28de9a1115491c93a51391a6e33db4a851143fa4bdb1ab4
```

An anonymous HTTPS request from Windows to `https://runncafe.ir/pos` returned
200. No CSP or CSP-Report-Only response header or CSP meta tag was found in that
response. This does not establish the policy of an already open browser document.
The Windows system proxy setting was disabled; Firefox-specific proxy/VPN state
still requires operator confirmation.

## Installation details and operational commands

The archive and all manifest entries were verified before installation. The
private per-user directory ACL was applied, matching binary/config copied, and
the login task registered and explicitly started. No firewall, browser security,
Windows account, SEP COM registration, DLL location, terminal configuration, or
production service was changed. The health process was left running.

Restricted policy blocks `.ps1` file execution. The reviewed installer commands
were executed directly through SSH using PowerShell `-EncodedCommand`, with
`$PSScriptRoot` replaced by the known staging-directory variable. No execution
policy was changed. Keep each encoded command below Windows' command-line length
limit; extraction/verification, installation, and startup were separate calls.

The first transfer attempt used a nonexistent `System.IO.File.CreateNew`
method and failed without creating the ZIP. The corrected transfer used
`File.Open(path, FileMode.CreateNew, FileAccess.Write)` and its checksum passed.
An initially oversized combined remote command was rejected before execution;
the commands were split. These attempts did not install or execute the bridge.

Use these commands in PowerShell as the existing cashier account. They work
without running script files or changing execution policy.

```powershell
# Inspect
Get-ScheduledTask -TaskName 'RunCafe SEP Health'
Get-ScheduledTaskInfo -TaskName 'RunCafe SEP Health'
Invoke-RestMethod -Uri 'http://127.0.0.1:18711/health' -TimeoutSec 5
netstat.exe -ano -p tcp | Select-String ':18711'
Get-Content (Join-Path $env:LOCALAPPDATA 'RunCafe\SepBridge.Health\bridge.jsonl') -Tail 30

# Clean stop. Do not stop while the operator is performing the browser check.
$root = Join-Path $env:LOCALAPPDATA 'RunCafe\SepBridge.Health'
New-Item -ItemType File -Force -Path (Join-Path $root 'stop.request') | Out-Null
for ($i=0; $i -lt 20; $i++) {
    if ((Get-ScheduledTask -TaskName 'RunCafe SEP Health').State -ne 'Running') { break }
    Start-Sleep -Milliseconds 500
}
if ((Get-ScheduledTask -TaskName 'RunCafe SEP Health').State -eq 'Running') { throw 'Inspect the task before forcing a stop' }

# Start/restart, after the previous task has stopped
Start-ScheduledTask -TaskName 'RunCafe SEP Health'
```

Startup/health and clean stop/restart have been verified. The task reached Ready
after its stop sentinel, health failed while stopped, then explicit restart
returned health 200. Logs record stopped at 11:24:27 UTC and started at
11:24:33 UTC on 25 October. Actual next-login startup remains untested; do not
confuse a registered logon trigger with a tested login. The task is left running.
The build/transfer/rollback procedures and browser snippet are
in [`apps/sep-bridge/README.md`](../../apps/sep-bridge/README.md).

## Operator Firefox evidence

The user ran the reviewed console snippet on the cashier and supplied both
results. Plain GET and the GET carrying `X-Run-Cafe-Diagnostic` each returned
HTTP 200 with the expected service/version/mode and both capabilities false.
The user confirmed no VPN or proxy was active. The headered request succeeded
under the browser's active CORS/mixed-content/CSP behavior. A browser Network
panel capture of OPTIONS was not supplied; Windows had independently verified
the server's 204 preflight response.

The normal HTTPS-POS-to-loopback transport is therefore demonstrated in the
actual cashier browser. Do not infer behavior with a future VPN/proxy setup.

## Remaining operational follow-ups

No browser/computer surface is available to this agent. Detailed browser Network
observations, an offline/recovery browser check, and subsequent-login startup
remain follow-ups. No browser security warning
should be bypassed. The installed health artifact still cannot load SEP, and
no terminal call or financial operation has run. Static SDK inspection and
fake-tested diagnostic groundwork may proceed; do not treat these results as
financial acceptance or authorization to install another executable.

Mozilla's [mixed-content documentation](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content#loading_locally_delivered_mixed-resources)
explains the loopback secure-origin treatment. This supports the design; the
operator's actual Firefox fetch results above are the compatibility evidence.
Financial POST/content-type preflight must still be checked with an invalid,
non-purchasing body after approved financial-host installation.
