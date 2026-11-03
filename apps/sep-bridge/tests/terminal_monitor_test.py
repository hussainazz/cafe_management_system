from pathlib import Path
import subprocess
import tempfile
root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as folder:
    exe = Path(folder) / 'TerminalMonitorTests.exe'
    subprocess.run(['mcs', '-sdk:4.8', '-langversion:5', '-warnaserror', '-r:System.Web.Extensions', '-r:System.Security', f'-out:{exe}', *[str(root/'Payments'/p) for p in ['PaymentProtocol.cs', 'PaymentEngine.cs', 'TerminalMonitor.cs']], str(root/'tests/TerminalMonitorTests.cs')], check=True)
    subprocess.run(['mono', str(exe)], check=True, timeout=15)
