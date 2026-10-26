param([switch]$EnablePayments, [switch]$ConfirmedTomanCalibration)
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'RunCafe\SepBridge.Payments'
if ((Get-ScheduledTask -TaskName 'RunCafe SEP Payments').State -eq 'Running' -or @(Get-Process -Name 'RunCafe.SepBridge.PurchaseWorker' -ErrorAction SilentlyContinue).Count -gt 0) { throw 'Stop host and purchase workers before configuration.' }
if ($EnablePayments -and !$ConfirmedTomanCalibration) { throw 'Explicit confirmation of tester 1000 = 1000 Toman calibration is required.' }
if ($EnablePayments -and !(Test-Path (Join-Path $root 'pairing.dpapi'))) { throw 'Pair first.' }
$paths = @('RunCafe.SepBridge.Payments.exe','RunCafe.SepBridge.PurchaseWorker.exe') | ForEach-Object { Join-Path $root "0.2.0\$_.config" }
$configs = @()
foreach ($path in $paths) {
  [xml]$config = Get-Content $path
  $values = @{}
  foreach ($entry in $config.configuration.appSettings.add) { $values[$entry.key] = $entry.value }
  $id = [Guid]::Empty
  if ($EnablePayments -and (![Guid]::TryParse($values['BridgeId'],[ref]$id) -or $id -eq [Guid]::Empty -or $values['LogPermission'] -ne '0' -or $values['ExpectedTerminalId'] -ne '31187710' -or $values['TerminalIp'] -ne '192.168.1.101')) { throw 'Pairing, logging or terminal configuration is invalid.' }
  $configs += $config
}
if ($EnablePayments -and ($configs[0].configuration.appSettings.add | Where-Object {$_.key -eq 'BridgeId'}).value -ne ($configs[1].configuration.appSettings.add | Where-Object {$_.key -eq 'BridgeId'}).value) { throw 'Installation identities differ.' }
for ($i=0; $i -lt $paths.Count; $i++) {
  ($configs[$i].configuration.appSettings.add | Where-Object {$_.key -eq 'PaymentsEnabled'}).value = $(if ($EnablePayments) {'true'} else {'false'})
  $configs[$i].Save($paths[$i])
}
Write-Output 'Configuration updated. Backend initiation flag is separate. Task was not started.'
