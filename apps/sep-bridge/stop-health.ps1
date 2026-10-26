$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'RunCafe\SepBridge.Health'
if (!(Test-Path $root)) { throw 'Health installation not found.' }
New-Item -ItemType File -Force -Path (Join-Path $root 'stop.request') | Out-Null
for ($i = 0; $i -lt 20; $i++) {
    $task = Get-ScheduledTask -TaskName 'RunCafe SEP Health'
    if ($task.State -ne 'Running') { Write-Output 'Health task stopped.'; exit 0 }
    Start-Sleep -Milliseconds 500
}
throw 'Health task did not stop within 10 seconds. Inspect it before forcing a stop.'
