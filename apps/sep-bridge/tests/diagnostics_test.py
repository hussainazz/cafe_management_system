"""Compile/run only the SDK-free diagnostic core and fakes. Never load SEP."""
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="sep-diagnostic-fakes-") as directory:
    exe = Path(directory) / "DiagnosticTests.exe"
    subprocess.run([
        "mcs", "-sdk:4.8", "-langversion:5", "-warnaserror", "-platform:x86",
        f"-out:{exe}", str(root / "Diagnostics/ConnectionDiagnostics.cs"),
        str(root / "tests/ConnectionDiagnosticsTests.cs"),
    ], check=True)
    # No official adapter or vendor DLL is referenced or present in this test host.
    subprocess.run(["mono", str(exe)], check=True, timeout=20)
