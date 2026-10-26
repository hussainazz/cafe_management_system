"""Verify the real worker refuses default/unsafe invocation without SDK files."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
worker = root / "dist/diagnostics/RunCafe.SepBridge.DiagnosticWorker.exe"
with tempfile.TemporaryDirectory(prefix="sep-worker-guards-") as directory:
    exe = Path(directory) / worker.name
    shutil.copyfile(worker, exe)
    baseline = Path(str(worker) + ".config").read_text()
    cases = [([], baseline, "authorization-required"),
             (["--purchase"], baseline, "authorization-required"),
             (["--connection-test"], baseline, "disabled"),
             (["--connection-test"], baseline.replace('key="SepDiagnosticsEnabled" value="false"', 'key="SepDiagnosticsEnabled" value="true"').replace('key="LogPermission" value="0"', 'key="LogPermission" value="1"'), "disabled")]
    for arguments, config, expected in cases:
        Path(str(exe) + ".config").write_text(config)
        result = subprocess.run(["mono", str(exe), *arguments], capture_output=True, text=True, timeout=5)
        body = json.loads(result.stdout)
        assert result.returncode == 2 and body["status"] == expected
        assert body["paymentEnabled"] is False and body["mode"] == "connection-diagnostic-only"
        assert not list(Path(directory).glob("*.dll"))
        print("PASS worker guard:", arguments or "no arguments", expected)
print("4/4 real worker guard checks passed; no SDK files loaded or executed")

payment_worker = root / 'dist/payments/RunCafe.SepBridge.PurchaseWorker.exe'
if payment_worker.exists():
    with tempfile.TemporaryDirectory(prefix='sep-purchase-worker-guards-') as directory:
        exe = Path(directory) / payment_worker.name
        shutil.copyfile(payment_worker, exe)
        baseline = Path(str(payment_worker) + '.config').read_text()
        cases = [([], baseline), (['--purchase', 'unused'], baseline),
                 (['--purchase', 'unused'], baseline.replace('key="PaymentsEnabled" value="false"', 'key="PaymentsEnabled" value="true"').replace('key="LogPermission" value="0"', 'key="LogPermission" value="1"'))]
        # On Linux, even explicitly enabled configuration must reject the OS before touching SDK/files.
        import sys
        if sys.platform != 'win32':
            cases.append((['--purchase','unused'], baseline.replace('key="PaymentsEnabled" value="false"','key="PaymentsEnabled" value="true"')))
        for arguments, config in cases:
            Path(str(exe) + '.config').write_text(config)
            result = subprocess.run(['mono',str(exe),*arguments],capture_output=True,text=True,timeout=5)
            assert result.returncode == 2 and not result.stdout and not result.stderr
            assert not list(Path(directory).glob('*.dll'))
        print(f'{len(cases)}/{len(cases)} purchase worker guard checks passed; no SDK files or financial calls')
