"""Build/package the health-only Windows x86 artifact on Linux, no SEP DLLs."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import zipfile

root = Path(__file__).resolve().parent
out = root / "dist"
out.mkdir(exist_ok=True)
exe = out / "RunCafe.SepBridge.Health.exe"
subprocess.run(["mcs", "-sdk:4.8", "-langversion:5", "-warnaserror", "-platform:x86", "-target:winexe", "-optimize+", "-r:System.Configuration", f"-out:{exe}", str(root / "Program.cs")], check=True)
shutil.copyfile(root / "App.config", out / (exe.name + ".config"))
for name in ("install-health.ps1", "stop-health.ps1", "README.md"):
    shutil.copyfile(root / name, out / name)
files = [{"name": p.name, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(out.iterdir()) if p.name in (exe.name, exe.name + ".config", "install-health.ps1", "stop-health.ps1", "README.md")]
manifest = {"version": "0.1.0", "mode": "health-only", "framework": "net48", "platform": "x86", "paymentEnabled": False, "sourceSha256": hashlib.sha256((root / "Program.cs").read_bytes()).hexdigest(), "files": files}
(out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
archive = out / "run-cafe-sep-health-0.1.0-x86.zip"
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as package:
    for name in [entry["name"] for entry in files] + ["manifest.json"]:
        package.write(out / name, name)
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(out / (archive.name + ".sha256")).write_text(f"{digest}  {archive.name}\n")
print(archive)
print(digest)
