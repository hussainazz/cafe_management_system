"""Build a separate, disabled-by-default diagnostic package. Never execute SEP."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument("--sdk-directory", type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent
out = root.parent / "dist/diagnostics"
out.mkdir(parents=True, exist_ok=True)
expected = {
    "SSP1126.PcPos.dll": "b1785db76f5b7748dc4cc59895f11a41d34542808fc61a317c175f4f0f821ffa",
    "Sep.Logger.dll": "19327d291e42d9adaf6905d80fe6aadfe1d255fb5b8d2e447d420bada5d52aa9",
}
for name, digest in expected.items():
    if hashlib.sha256((args.sdk_directory / name).read_bytes()).hexdigest() != digest:
        raise SystemExit("SEP package checksum mismatch")
exe = out / "RunCafe.SepBridge.DiagnosticWorker.exe"
subprocess.run([
    "mcs", "-sdk:4.8", "-langversion:5", "-warnaserror", "-platform:x86",
    "-target:winexe", "-optimize+", "-r:System.Configuration", f"-out:{exe}",
    *[f"-r:{args.sdk_directory / name}" for name in expected],
    *[str(root / name) for name in ("ConnectionDiagnostics.cs", "OfficialSepDiagnosticDevice.cs", "DiagnosticWorker.cs")],
], check=True)
shutil.copyfile(root / "App.config", out / (exe.name + ".config"))
names = [exe.name, exe.name + ".config", "README.md", "run-connection-test.ps1", *expected]
for name in ("README.md", "run-connection-test.ps1"):
    shutil.copyfile(root / name, out / name)
for name in expected:
    shutil.copyfile(args.sdk_directory / name, out / name)
manifest = {
    "mode": "connection-diagnostic-only", "platform": "x86", "framework": "net48",
    "paymentEnabled": False, "diagnosticsEnabledByDefault": False,
    "files": [{"name": name, "sha256": hashlib.sha256((out / name).read_bytes()).hexdigest()} for name in names],
    "sources": {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in ("ConnectionDiagnostics.cs", "OfficialSepDiagnosticDevice.cs", "DiagnosticWorker.cs")},
}
(out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
archive = out / "run-cafe-sep-diagnostics-0.1.0-x86.zip"
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as package:
    for name in names + ["manifest.json"]:
        package.write(out / name, name)
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(out / (archive.name + ".sha256")).write_text(f"{digest}  {archive.name}\n")
print(archive)
print(digest)
