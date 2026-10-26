"""Print one reviewed inline PowerShell command; never connects to or executes on Windows."""
import argparse
import base64
from pathlib import Path
parser = argparse.ArgumentParser()
parser.add_argument('operation', choices=['install', 'pair', 'configure', 'stop'])
parser.add_argument('--stage', default=r'C:\Users\Cafe Run\Documents\sep-payments-0.2.0-stage')
parser.add_argument('--bridge-id')
parser.add_argument('--key-file', default=r'C:\Users\Cafe Run\AppData\Local\RunCafe\SepBridge.Payments\pairing.key')
parser.add_argument('--enable', action='store_true')
args = parser.parse_args()
quote = lambda value: "'" + value.replace("'", "''") + "'"
body = (Path(__file__).parent / (args.operation + '.ps1')).read_text()
if body.startswith('param('): body = body.split('\n', 1)[1]
assign = '$stage=' + quote(args.stage) + ';'
if args.operation == 'install': assign += '$ApproveFinancialBridgeInstall=$true;'
if args.operation == 'pair':
    import uuid
    if not args.bridge_id: parser.error('--bridge-id is required')
    assign += '$KeyFile=' + quote(args.key_file) + ';[Guid]$BridgeId=' + quote(str(uuid.UUID(args.bridge_id))) + ';'
if args.operation == 'configure':
    assign += '$EnablePayments=$' + str(args.enable).lower() + ';$ConfirmedTomanCalibration=$' + str(args.enable).lower() + ';'
script = assign + '\n' + body.replace('$PSScriptRoot', '$stage')
command = 'powershell.exe -NoProfile -NonInteractive -EncodedCommand ' + base64.b64encode(script.encode('utf-16le')).decode()
if len(command) > 8000: raise SystemExit('Command exceeds safe Windows command-line size; split and review the script.')
print(command)
