param([Parameter(Mandatory=$true)][string]$SdkDirectory, [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\dist\payments'))
$ErrorActionPreference = 'Stop'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
if (!(Test-Path $csc)) { throw '.NET Framework compiler missing.' }
$expected = @{'SSP1126.PcPos.dll'='b1785db76f5b7748dc4cc59895f11a41d34542808fc61a317c175f4f0f821ffa';'Sep.Logger.dll'='19327d291e42d9adaf6905d80fe6aadfe1d255fb5b8d2e447d420bada5d52aa9'}
foreach ($name in $expected.Keys) {
  if ((Get-FileHash (Join-Path $SdkDirectory $name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected[$name]) { throw 'SDK checksum mismatch.' }
}
New-Item -ItemType Directory -Force $OutputDirectory | Out-Null
$shared = @('/nologo','/target:winexe','/platform:x86','/langversion:5','/warnaserror','/optimize+','/r:System.Configuration.dll','/r:System.Web.Extensions.dll','/r:System.Security.dll')
$hostSources = @('PaymentProtocol.cs','PaymentEngine.cs','BackendClient.cs','ProcessPurchaseWorker.cs','PaymentHost.cs') | ForEach-Object { Join-Path $PSScriptRoot $_ }
& $csc @shared "/out:$(Join-Path $OutputDirectory 'RunCafe.SepBridge.Payments.exe')" @hostSources
if ($LASTEXITCODE -ne 0) { throw 'Host build failed.' }
& $csc @shared "/out:$(Join-Path $OutputDirectory 'RunCafe.SepBridge.PurchaseWorker.exe')" "/r:$(Join-Path $SdkDirectory 'SSP1126.PcPos.dll')" "/r:$(Join-Path $SdkDirectory 'Sep.Logger.dll')" (Join-Path $PSScriptRoot 'PaymentProtocol.cs') (Join-Path $PSScriptRoot 'BackendClient.cs') (Join-Path $PSScriptRoot 'PaymentEngine.cs') (Join-Path $PSScriptRoot 'PurchaseWorker.cs')
if ($LASTEXITCODE -ne 0) { throw 'Worker build failed.' }
foreach ($name in @('RunCafe.SepBridge.Payments.exe','RunCafe.SepBridge.PurchaseWorker.exe')) { Copy-Item (Join-Path $PSScriptRoot 'App.config') (Join-Path $OutputDirectory "$name.config") -Force }
foreach ($name in $expected.Keys) { Copy-Item (Join-Path $SdkDirectory $name) $OutputDirectory -Force }
Write-Output 'Built disabled x86 .NET Framework 4.8 host and worker. No execution or COM registration performed.'
