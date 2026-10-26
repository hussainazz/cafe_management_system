"""SDK-free fake financial scenarios. Never launches a vendor assembly."""
from pathlib import Path
import subprocess
import tempfile
root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as folder:
    exe = Path(folder) / 'PaymentEngineTests.exe'
    subprocess.run(['mcs', '-sdk:4.8', '-langversion:5', '-warnaserror', '-r:System.Web.Extensions', '-r:System.Security', f'-out:{exe}', str(root / 'Payments/PaymentProtocol.cs'), str(root / 'Payments/PaymentEngine.cs'), str(root / 'tests/PaymentEngineTests.cs')], check=True)
    subprocess.run(['mono', str(exe), str(root / 'tests/protocol-vectors.json')], check=True, timeout=20)
