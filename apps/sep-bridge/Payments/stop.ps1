$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'RunCafe\SepBridge.Payments'
New-Item -ItemType File -Force -Path (Join-Path $root 'stop.request') | Out-Null
for ($i=0; $i -lt 80; $i++) {
  $hostRunning = (Get-ScheduledTask -TaskName 'RunCafe SEP Payments').State -eq 'Running'
  $workers = @(Get-Process -Name 'RunCafe.SepBridge.PurchaseWorker' -ErrorAction SilentlyContinue)
  if (!$hostRunning -and $workers.Count -eq 0) { Write-Output 'Host and purchase workers stopped. Reconcile unresolved attempts before any new charge.'; exit 0 }
  Start-Sleep -Milliseconds 500
}
throw 'A host or worker remains. Do not reconcile as no-charge or start another payment; inspect and stop it explicitly.'
