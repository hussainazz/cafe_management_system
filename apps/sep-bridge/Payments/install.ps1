param([switch]$ApproveFinancialBridgeInstall)
$ErrorActionPreference = 'Stop'
if (!$ApproveFinancialBridgeInstall) { throw 'Explicit approval switch required. This does not enable payments.' }
if ($env:USERNAME -ine 'cafe run') { throw 'Run as the existing cafe run account.' }
$root = Join-Path $env:LOCALAPPDATA 'RunCafe\SepBridge.Payments'
$bin = Join-Path $root '0.2.0'
$taskName = 'RunCafe SEP Payments'
if ((Test-Path $bin) -or (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) { throw 'Installation exists; stop and use versioned rollback procedure.' }
$manifest = Get-Content (Join-Path $PSScriptRoot 'manifest.json') -Raw | ConvertFrom-Json
foreach ($entry in $manifest.files) {
  if ($entry.name -match '[\\/]' -or (Get-FileHash (Join-Path $PSScriptRoot $entry.name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw 'Release verification failed.' }
}
New-Item -ItemType Directory -Force -Path $bin | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $root /inheritance:r /grant:r "${identity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F'
if ($LASTEXITCODE -ne 0) { throw 'Private directory ACL failed.' }
foreach ($name in @('RunCafe.SepBridge.Payments.exe','RunCafe.SepBridge.Payments.exe.config','RunCafe.SepBridge.PurchaseWorker.exe','RunCafe.SepBridge.PurchaseWorker.exe.config','SSP1126.PcPos.dll','Sep.Logger.dll')) { Copy-Item (Join-Path $PSScriptRoot $name) $bin }
$action = New-ScheduledTaskAction -Execute (Join-Path $bin 'RunCafe.SepBridge.Payments.exe') -WorkingDirectory $bin
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -InputObject (New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings) | Out-Null
Write-Output 'Installed disabled; task not started. Existing registered SEP files were preserved.'
