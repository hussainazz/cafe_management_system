param([switch]$ApproveBridgeUpgrade, [switch]$ConfirmedBackendDisabled)
$ErrorActionPreference = 'Stop'
if (!$ApproveBridgeUpgrade -or !$ConfirmedBackendDisabled) { throw 'Explicit upgrade approval and disabled backend initiation are required.' }
if ($env:USERNAME -ine 'cafe run') { throw 'Run as the existing cafe run account.' }
$root = Join-Path $env:LOCALAPPDATA 'RunCafe\SepBridge.Payments'
$oldBin = Join-Path $root '0.2.4'
$newBin = Join-Path $root '0.2.5'
$taskName = 'RunCafe SEP Payments'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
if ($task.State -ne 'Disabled') { throw 'Disable the payment task before upgrading.' }
if (@(Get-Process -Name 'RunCafe.SepBridge.Payments','RunCafe.SepBridge.PurchaseWorker' -ErrorAction SilentlyContinue).Count -gt 0) { throw 'Stop the bridge and purchase worker first.' }
if (@([System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | Where-Object { $_.Port -eq 18711 }).Count -gt 0) { throw 'Port 18711 is still listening.' }
if (!(Test-Path (Join-Path $root 'pairing.dpapi')) -or !(Test-Path $oldBin) -or (Test-Path $newBin)) { throw 'Expected paired 0.2.4 installation and unused 0.2.5 directory.' }
$manifest = Get-Content (Join-Path $PSScriptRoot 'manifest.json') -Raw | ConvertFrom-Json
foreach ($entry in $manifest.files) {
  if ($entry.name -match '[\\/]' -or (Get-FileHash (Join-Path $PSScriptRoot $entry.name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw 'Release verification failed.' }
}
$configNames = @('RunCafe.SepBridge.Payments.exe.config','RunCafe.SepBridge.PurchaseWorker.exe.config')
$configs = @()
foreach ($name in $configNames) {
  $oldPath = Join-Path $oldBin $name
  if (!(Test-Path $oldPath)) { throw 'Current configuration is missing.' }
  [xml]$config = Get-Content -LiteralPath $oldPath -Raw
  $values = @{}
  foreach ($entry in $config.configuration.appSettings.add) { $values[$entry.key] = $entry.value }
  $bridgeId = [Guid]::Empty
  if (![Guid]::TryParse($values['BridgeId'],[ref]$bridgeId) -or $bridgeId -eq [Guid]::Empty -or
      $values['PaymentsEnabled'] -ne 'false' -or
      $values['LogPermission'] -ne '0' -or $values['ExpectedTerminalId'] -ne '31187710' -or
      $values['TerminalIp'] -ne '192.168.1.101' -or $values['Port'] -ne '18711') { throw 'Existing pairing or fixed terminal configuration is invalid.' }
  $configs += $config
}
if (($configs[0].configuration.appSettings.add | Where-Object {$_.key -eq 'BridgeId'}).value -ne ($configs[1].configuration.appSettings.add | Where-Object {$_.key -eq 'BridgeId'}).value) { throw 'The host and worker installation identities differ.' }
New-Item -ItemType Directory -Path $newBin | Out-Null
foreach ($name in @('RunCafe.SepBridge.Payments.exe','RunCafe.SepBridge.PurchaseWorker.exe','SSP1126.PcPos.dll','Sep.Logger.dll')) { Copy-Item (Join-Path $PSScriptRoot $name) $newBin }
for ($i=0; $i -lt $configNames.Count; $i++) {
  ($configs[$i].configuration.appSettings.add | Where-Object {$_.key -eq 'PaymentsEnabled'}).value = 'false'
  ($configs[$i].configuration.appSettings.add | Where-Object {$_.key -eq 'LogPermission'}).value = '0'
  $configs[$i].Save((Join-Path $newBin $configNames[$i]))
}
$action = New-ScheduledTaskAction -Execute (Join-Path $newBin 'RunCafe.SepBridge.Payments.exe') -WorkingDirectory $newBin
Set-ScheduledTask -TaskName $taskName -Action $action | Out-Null
Write-Output 'Upgraded to 0.2.5. Task remains disabled; both payment switches remain false; pairing and journal were preserved.'
