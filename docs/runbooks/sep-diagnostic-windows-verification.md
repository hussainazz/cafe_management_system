# SEP diagnostic worker: approved Windows connection test

Date: 25 October 2026. The user explicitly approved installation and one
non-payment ConnectionTest while the terminal was idle.

## Artifact and installation

- ZIP SHA-256: `a71d68a69f63b40923acf4949ac48f521a49eea079e197804f38291990990d56`.
- Size: 87,509 bytes. All six manifest files verified on Windows before execution.
- Installed privately at
  `C:\Users\Cafe Run\AppData\Local\RunCafe\SepDiagnostics\0.1.0`.
- Existing account used. No login task, firewall, COM registration, terminal
  configuration, or production POS change was made.
- The SSH stdin transfer stalled after 32 KiB and the ZIP remained locked while
  its writer exited. No installation or SDK call occurred from that attempt.
  The partial file was retained with a `.partial-<timestamp>` suffix. SFTP to
  `/C:/Users/Cafe Run/Documents/sep-diagnostics-0.1.0.zip` completed and its
  checksum matched. Prefer the verified SFTP path for subsequent artifacts.

## Single device operation

The reviewed launcher ran directly through SSH without changing the Restricted
PowerShell execution policy. The isolated Windows x86 worker loaded the pinned
managed DLLs and returned:

```json
{
  "mode": "connection-diagnostic-only",
  "status": "Connected",
  "responseCode": "00",
  "terminalId": "31187710",
  "cleanupFailed": false,
  "paymentEnabled": false
}
```

The launcher exited 0. There was one ConnectionTest invocation and its normal
SDK cleanup; cleanup may itself send protocol messages. No purchase method
exists in this worker and no real payment was initiated.

## Post-run verification

- The worker exited; zero diagnostic worker processes remain.
- `SepDiagnosticsEnabled` was restored to `false`.
- `LogPermission` remains `0`. The adapter requires the vendor's effective
  `Constants.logPermission` to equal zero before creating PcPosFactory, and
  execution reached the successful connection result.
- `C:\Sep-SSP` had nine existing files before and after. A metadata fingerprint
  over sorted paths, lengths, and UTC last-write ticks was identical. No log
  contents were read, copied, or exposed. This establishes no observed vendor
  log-file changes during this run, not proof of every future SDK path.
- Original registered DLL hashes under Documents are unchanged and match the
  Linux package. The new copies require no registration.
- The existing localhost health service still returns health-only with both
  capabilities false. Its login task remains running.

## Limits

The successful run exercised normal process exit and cleanup. It did not force
the 30-second deadline, a transport failure, or cross-session lock contention
on Windows. Those fault paths still need controlled verification before a
financial pilot. Existing fake tests cover serialization/failure cases. Future
payment status and amount verification are separate backend/bridge work;
response 00 here is not payment approval.
