# Read-only SEP diagnostic adapter

This is a Phase C adapter, one-shot diagnostic worker, and fake-tested core.
It is not installed. The approved health executable, its project, package,
and Windows task do not reference these sources or SEP. There is no purchase
method or HTTP endpoint in this adapter.

Run the normal tests without the vendor binaries:

```bash
python3 apps/sep-bridge/tests/diagnostics_test.py
```

Compile the adapter against the verified local package without executing it:

```bash
mcs -sdk:4.8 -langversion:5 -warnaserror -platform:x86 -target:library \
  -r:System.Configuration \
  '-r:/home/hosein/Downloads/Telegram Desktop/SSP1126-DLLs/SSP1126.PcPos.dll' \
  '-r:/home/hosein/Downloads/Telegram Desktop/SSP1126-DLLs/Sep.Logger.dll' \
  -out:apps/sep-bridge/dist/RunCafe.SepBridge.Diagnostics.dll \
  apps/sep-bridge/Diagnostics/ConnectionDiagnostics.cs \
  apps/sep-bridge/Diagnostics/OfficialSepDiagnosticDevice.cs
```

No vendor binary is committed, copied, registered, or executed by that command.
The compiled diagnostic library is deliberately excluded from the health ZIP.
Do not execute it on the cashier under the earlier health-only approval.

The isolated Windows x86 host must configure `SepDiagnosticsEnabled=true`
and `LogPermission=0` explicitly before calling `OfficialSepDiagnosticDevice.Create`.
The method verifies hashes of the actual loaded official assemblies before
constructing a factory. Omit either setting and it refuses construction.
Vendor logging/timeout containment still needs isolated Windows verification.

Build the separate diagnostic artifact locally, without executing it:

```bash
python3 apps/sep-bridge/Diagnostics/package-diagnostics.py \
  --sdk-directory '/home/hosein/Downloads/Telegram Desktop/SSP1126-DLLs'
python3 apps/sep-bridge/tests/worker_guard_test.py
```

This produces `apps/sep-bridge/dist/diagnostics/run-cafe-sep-diagnostics-0.1.0-x86.zip`.
Its manifest pins both official DLL hashes and source/file hashes. It includes
the matching DLL copies for direct managed loading, never moves registered
files, and requires no COM registration. The worker configuration ships with
diagnostics disabled and vendor logging disabled. It cannot purchase or print.

## Windows procedure, only after separate approval

Transfer the ZIP using the health runbook's SSH binary-transfer method, using
the distinct destination `C:\Users\Cafe Run\Documents\sep-diagnostics-0.1.0.zip`.
Compare its SHA-256 against the generated local sidecar before extraction.
Extract into the new private, versioned directory below, as `cafe run`; no
login task or firewall rule is created for this one-shot worker.

```powershell
$zip = 'C:\Users\Cafe Run\Documents\sep-diagnostics-0.1.0.zip'
Get-FileHash -Algorithm SHA256 -LiteralPath $zip
$stage = Join-Path $env:LOCALAPPDATA 'RunCafe\SepDiagnostics\0.1.0'
if (Test-Path -LiteralPath $stage) { throw 'Diagnostic staging directory already exists' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory($zip, $stage)
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $stage /inheritance:r /grant:r "${identity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F'
if ($LASTEXITCODE -ne 0) { throw 'Directory protection failed' }
$manifest = Get-Content (Join-Path $stage 'manifest.json') -Raw | ConvertFrom-Json
foreach ($entry in $manifest.files) {
    if ((Get-FileHash -Algorithm SHA256 (Join-Path $stage $entry.name)).Hash.ToLowerInvariant() -ne $entry.sha256) { throw 'Diagnostic checksum mismatch' }
}
```

Do not run a terminal test while the terminal is processing a payment or an
earlier payment is uncertain. After approval and confirming it is idle, enable
only this version's one-shot diagnostic configuration:

```powershell
$configPath = Join-Path $stage 'RunCafe.SepBridge.DiagnosticWorker.exe.config'
$config = [xml](Get-Content -LiteralPath $configPath -Raw)
($config.configuration.appSettings.add | Where-Object { $_.key -eq 'SepDiagnosticsEnabled' }).value = 'true'
$config.Save($configPath)
```

Run `run-connection-test.ps1 -AuthorizeDeviceDiagnostics` from the extracted
directory when script-file execution is permitted. With the cashier's Restricted
execution policy, run those reviewed commands directly through SSH, replace the
initial `param([switch]$AuthorizeDeviceDiagnostics)` line with the explicit
`$AuthorizeDeviceDiagnostics=$true` assignment, define the known `$stage`, and
replace `$PSScriptRoot` with `$stage` in that command string.
Keep each encoded command below Windows' command-line length limit. Do not
change the execution policy. Restore the flag to `false` after the check.

The launcher starts a hidden worker, captures stdout/stderr in memory without
persisting raw vendor data, and emits only a validated allowlisted result. It
enforces a 30-second process deadline and waits for termination after a kill.
If it cannot stop the worker, inspect the PID before further device operations.
There is no automatic retry. A Windows Global mutex held by the worker prevents
another diagnostic worker in a different login/SSH session from overlapping.
Mutex creation failures fail closed. That cross-session behavior still needs
Windows runtime verification. No diagnostic may bypass future backend pending
payment guards.

Rollback requires no migration, registration, or service change: ensure the
worker has exited, set its flag false, and retain/rename this private version
directory. The existing health login task and registered SEP DLL paths remain
unchanged. This procedure does not approve any purchase test.

`ConnectionDiagnostics` fixes the terminal IP and expected eight-digit identity
when constructed. `Run()` is explicit, serializes construction through cleanup,
and never retries. Only code 00 with the exact identity is connected. Diagnostic
03/99 and socket/timeout exceptions are unavailable; other/null/invalid responses
are protocol errors. This classification must never be used for payment failure.

Official Dispose can reconnect and send a cleanup message. A hung call or cleanup
must not be abandoned with the device gate released. The host must exclude diagnostics while a
payment outcome is unresolved. No payment-attempt engine exists here yet.

See [the inspected SDK contract](../../../docs/planning/sep-ssp1126-sdk-contract.md)
for signatures, logging, timeout, cleanup, and the unresolved purchase amount unit.
