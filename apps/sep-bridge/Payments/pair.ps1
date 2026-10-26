param([Parameter(Mandatory=$true)][string]$KeyFile, [Parameter(Mandatory=$true)][Guid]$BridgeId)
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'RunCafe\SepBridge.Payments'
if (!(Test-Path $root) -or (Test-Path (Join-Path $root 'pairing.dpapi'))) { throw 'Install first. Refusing to replace an existing pairing.' }
if ((Get-ScheduledTask -TaskName 'RunCafe SEP Payments').State -eq 'Running') { throw 'Stop the bridge before pairing.' }
$keyText = [IO.File]::ReadAllText((Resolve-Path $KeyFile)).Trim()
if ($keyText -cnotmatch '^[a-f0-9]{64}$') { throw 'Expected one 32-byte lowercase hexadecimal key.' }
$keyBytes = New-Object byte[] 32
for ($i=0; $i -lt 32; $i++) { $keyBytes[$i] = [Convert]::ToByte($keyText.Substring($i*2,2),16) }
Add-Type -AssemblyName System.Security
$protected = [Security.Cryptography.ProtectedData]::Protect($keyBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
[IO.File]::WriteAllBytes((Join-Path $root 'pairing.dpapi'),$protected)
[Array]::Clear($keyBytes,0,$keyBytes.Length)
foreach ($name in @('RunCafe.SepBridge.Payments.exe','RunCafe.SepBridge.PurchaseWorker.exe')) {
  $path = Join-Path $root "0.2.0\$name.config"
  [xml]$config = Get-Content $path
  ($config.configuration.appSettings.add | Where-Object {$_.key -eq 'BridgeId'}).value = $BridgeId.ToString()
  $config.Save($path)
}
Remove-Item -LiteralPath $KeyFile
Write-Output 'Paired under the current Windows account. Plaintext transfer file removed. Payments remain disabled.'
