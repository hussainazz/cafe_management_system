$ErrorActionPreference = 'Stop'
if ($env:USERNAME -ine 'cafe run') { throw 'Run this as the existing cafe run account.' }
$taskName = 'RunCafe SEP Health'
$root = Join-Path $env:LOCALAPPDATA 'RunCafe\SepBridge.Health'
$bin = Join-Path $root 'bin'
if ((Test-Path $bin) -or (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) {
    throw 'Existing health installation found. Use the documented stop/rollback procedure first.'
}
$sourceExe = Join-Path $PSScriptRoot 'RunCafe.SepBridge.Health.exe'
if (!(Test-Path $sourceExe) -or !(Test-Path "$sourceExe.config")) { throw 'Missing release files.' }
# Verify the manifest before copying or registering anything.
$manifest = Get-Content (Join-Path $PSScriptRoot 'manifest.json') -Raw | ConvertFrom-Json
foreach ($entry in $manifest.files) {
    $path = Join-Path $PSScriptRoot $entry.name
    $hash = (Get-FileHash -Algorithm SHA256 $path).Hash.ToLowerInvariant()
    if ($hash -ne $entry.sha256) { throw 'Release checksum mismatch.' }
}
New-Item -ItemType Directory -Force -Path $bin | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
# Private per-user application data. No elevation, extra account, or firewall rule.
& icacls.exe $root /inheritance:r /grant:r "${identity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F'
if ($LASTEXITCODE -ne 0) { throw 'Could not protect the health installation.' }
Copy-Item $sourceExe (Join-Path $bin 'RunCafe.SepBridge.Health.exe')
Copy-Item "$sourceExe.config" (Join-Path $bin 'RunCafe.SepBridge.Health.exe.config')
$action = New-ScheduledTaskAction -Execute (Join-Path $bin 'RunCafe.SepBridge.Health.exe') -WorkingDirectory $bin
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -InputObject (New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings) | Out-Null
Write-Output 'Health task installed but not started. Start explicitly after reviewing the configuration.'
