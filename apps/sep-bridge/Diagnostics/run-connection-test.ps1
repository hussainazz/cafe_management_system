param([switch]$AuthorizeDeviceDiagnostics)
$ErrorActionPreference = 'Stop'
if (!$AuthorizeDeviceDiagnostics) { throw 'Explicit device-diagnostic authorization is required.' }
$exe = Join-Path $PSScriptRoot 'RunCafe.SepBridge.DiagnosticWorker.exe'
$config = [xml](Get-Content -LiteralPath "$exe.config" -Raw)
$settings = @{}
foreach ($item in $config.configuration.appSettings.add) { $settings[$item.key] = $item.value }
if ($settings['SepDiagnosticsEnabled'] -ne 'true' -or $settings['LogPermission'] -ne '0') {
    throw 'Diagnostic mode must be explicitly enabled with vendor logging disabled.'
}
$start = New-Object System.Diagnostics.ProcessStartInfo
$start.FileName = $exe
$start.WorkingDirectory = $PSScriptRoot
$start.Arguments = '--connection-test'
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
$process = New-Object System.Diagnostics.Process
$process.StartInfo = $start
try {
    if (!$process.Start()) { throw 'Diagnostic worker did not start.' }
    if (!$process.WaitForExit(30000)) {
        $process.Kill()
        if (!$process.WaitForExit(5000)) { throw 'Worker did not stop. Inspect it before any further terminal operation.' }
        # This deadline is diagnostic-only. Never use it to classify a purchase as failed.
        Write-Output '{"mode":"connection-diagnostic-only","status":"worker-deadline","paymentEnabled":false}'
        exit 1
    }
    # Do not print raw vendor stdout/stderr or parser exception messages.
    $raw = $process.StandardOutput.ReadToEnd()
    $null = $process.StandardError.ReadToEnd()
    try { $result = $raw | ConvertFrom-Json } catch { throw 'Unexpected diagnostic worker output.' }
    if ($result.mode -ne 'connection-diagnostic-only' -or $result.paymentEnabled -ne $false -or
        $result.status -notin @('Connected','TerminalUnavailable','TerminalMismatch','ProtocolError','Busy','disabled','authorization-required','configuration-or-worker-error') -or
        ($null -ne $result.responseCode -and $result.responseCode -cnotmatch '\A[0-9A-Z]{2,3}\z') -or
        ($null -ne $result.terminalId -and $result.terminalId -notmatch '\A[0-9]{8}\z')) {
        throw 'Unexpected diagnostic worker output.'
    }
    [pscustomobject]@{ mode=$result.mode; status=$result.status; responseCode=$result.responseCode; terminalId=$result.terminalId; cleanupFailed=($result.cleanupFailed -eq $true); paymentEnabled=$false } | ConvertTo-Json
    exit $process.ExitCode
} finally { $process.Dispose() }
