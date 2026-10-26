"""Build/package Windows binaries on Linux without executing SEP or opening sockets."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--sdk-directory', required=True, type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parent
out = root.parent / 'dist/payments'
out.mkdir(parents=True, exist_ok=True)
expected = {'SSP1126.PcPos.dll': 'b1785db76f5b7748dc4cc59895f11a41d34542808fc61a317c175f4f0f821ffa', 'Sep.Logger.dll': '19327d291e42d9adaf6905d80fe6aadfe1d255fb5b8d2e447d420bada5d52aa9'}
for name, digest in expected.items():
    if hashlib.sha256((args.sdk_directory / name).read_bytes()).hexdigest() != digest:
        raise SystemExit('SDK checksum mismatch')
shared = ['mcs', '-sdk:4.8', '-langversion:5', '-warnaserror', '-platform:x86', '-target:winexe', '-optimize+', '-r:System.Configuration', '-r:System.Web.Extensions', '-r:System.Security']
subprocess.run([*shared, f'-out:{out / "RunCafe.SepBridge.Payments.exe"}', *[str(root / name) for name in ('PaymentProtocol.cs', 'PaymentEngine.cs', 'BackendClient.cs', 'ProcessPurchaseWorker.cs', 'PaymentHost.cs')]], check=True)
subprocess.run([*shared, f'-out:{out / "RunCafe.SepBridge.PurchaseWorker.exe"}', *[f'-r:{args.sdk_directory / name}' for name in expected], str(root / 'PaymentProtocol.cs'), str(root / 'BackendClient.cs'), str(root / 'PaymentEngine.cs'), str(root / 'PurchaseWorker.cs')], check=True)
names = ['RunCafe.SepBridge.Payments.exe', 'RunCafe.SepBridge.PurchaseWorker.exe', *expected]
for name in names[:2]:
    shutil.copyfile(root / 'App.config', out / (name + '.config'))
names += ['RunCafe.SepBridge.Payments.exe.config', 'RunCafe.SepBridge.PurchaseWorker.exe.config']
for name in expected:
    shutil.copyfile(args.sdk_directory / name, out / name)
for name in ('README.md', 'install.ps1', 'pair.ps1', 'configure.ps1', 'stop.ps1'):
    shutil.copyfile(root / name, out / name)
    names.append(name)
manifest = {'version': '0.2.0', 'platform': 'x86', 'framework': 'net48', 'paymentsEnabledByDefault': False, 'manualVerificationRequired': True,
            'files': [{'name': name, 'sha256': hashlib.sha256((out / name).read_bytes()).hexdigest()} for name in names],
            'sources': {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(root.glob('*.cs'))}}
(out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
archive = out / 'run-cafe-sep-payments-0.2.0-x86.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as package:
    for name in names + ['manifest.json']:
        # Stable ZIP metadata for reproducible builds with the same compiler.
        info = zipfile.ZipInfo(name, date_time=(2026, 10, 25, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        package.writestr(info, (out / name).read_bytes())
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(out / (archive.name + '.sha256')).write_text(f'{digest}  {archive.name}\n')
print(f'{archive}\n{archive.stat().st_size} bytes\n{digest}')
