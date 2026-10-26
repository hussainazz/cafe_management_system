$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $root 'dist'
New-Item -ItemType Directory -Force -Path $out | Out-Null
# Compile only against the installed .NET Framework; no NuGet or SEP dependency.
$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319'
$compiler = Join-Path $framework 'csc.exe'
$exe = Join-Path $out 'RunCafe.SepBridge.Health.exe'
& $compiler /nologo /target:winexe /platform:x86 /optimize+ /warnaserror+ /langversion:5 "/out:$exe" /reference:System.Configuration.dll (Join-Path $root 'Program.cs')
if ($LASTEXITCODE -ne 0) { throw 'Bridge compilation failed' }
Copy-Item (Join-Path $root 'App.config') "$exe.config" -Force
Write-Output $exe
