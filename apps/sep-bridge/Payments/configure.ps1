param([switch]$EnablePayments, [switch]$ConfirmedTomanToRialConversion)
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'RunCafe\SepBridge.Payments'
$task = Get-ScheduledTask -TaskName 'RunCafe SEP Payments' -ErrorAction Stop
if ($task.State -ne 'Disabled' -or @(Get-Process -Name 'RunCafe.SepBridge.Payments','RunCafe.SepBridge.PurchaseWorker','RunCafe.SepBridge.ConnectionWorker' -ErrorAction SilentlyContinue).Count -gt 0) { throw 'Keep the payment task disabled and stop host/workers before configuration.' }
$hostPath = [IO.Path]::GetFullPath($task.Actions[0].Execute)
$rootPath = [IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
if (!$hostPath.StartsWith($rootPath, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($hostPath) -ne 'RunCafe.SepBridge.Payments.exe') { throw 'Payment task does not point to the managed bridge installation.' }
$versionDirectory = Split-Path -Parent $hostPath
if ($EnablePayments -and !$ConfirmedTomanToRialConversion) { throw 'Explicit confirmation of the reviewed Toman-to-Rial conversion in bridge 0.2.6 is required.' }
if ($EnablePayments -and !(Test-Path (Join-Path $root 'pairing.dpapi'))) { throw 'Pair first.' }
$paths = @('RunCafe.SepBridge.Payments.exe','RunCafe.SepBridge.PurchaseWorker.exe') | ForEach-Object { Join-Path $versionDirectory "$_.config" }
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
$monitorPath = Join-Path $versionDirectory 'RunCafe.SepBridge.ConnectionWorker.exe.config'
[xml]$monitorConfig = Get-Content -LiteralPath $monitorPath -Raw
($monitorConfig.configuration.appSettings.add | Where-Object {$_.key -eq 'SepDiagnosticsEnabled'}).value = $(if ($EnablePayments) {'true'} else {'false'})
($monitorConfig.configuration.appSettings.add | Where-Object {$_.key -eq 'LogPermission'}).value = '0'
$monitorConfig.Save($monitorPath)
Write-Output 'Configuration updated. Backend initiation flag is separate. Task was not started.'
