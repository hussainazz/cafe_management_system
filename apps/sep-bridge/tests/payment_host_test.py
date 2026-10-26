"""Real payment host HTTP checks, disabled, no SDK files or pairing key present."""
import http.client
import json
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import unittest
ROOT = Path(__file__).resolve().parents[1]
class PaymentHostTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='sep-payment-host-')
        cls.work = Path(cls.temp.name)
        cls.exe = cls.work / 'Payments.exe'
        sources = ['PaymentProtocol.cs', 'PaymentEngine.cs', 'BackendClient.cs', 'ProcessPurchaseWorker.cs', 'PaymentHost.cs']
        subprocess.run(['mcs', '-sdk:4.8', '-langversion:5', '-warnaserror', '-platform:x86', '-target:winexe', '-r:System.Configuration', '-r:System.Security', '-r:System.Web.Extensions', f'-out:{cls.exe}', *[str(ROOT / 'Payments' / p) for p in sources]], check=True)
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0)); cls.port = probe.getsockname()[1]
        config = (ROOT / 'Payments/App.config').read_text().replace('value="18711"', f'value="{cls.port}"').replace('key="DataDirectory" value=""', f'key="DataDirectory" value="{cls.work / "data"}"')
        Path(str(cls.exe) + '.config').write_text(config)
        cls.process = subprocess.Popen(['mono', str(cls.exe)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                with socket.create_connection(('127.0.0.1', cls.port), timeout=.1): return
            except OSError:
                if cls.process.poll() is not None: raise RuntimeError('Host exited')
                time.sleep(.05)
        raise RuntimeError('Host did not start')
    @classmethod
    def tearDownClass(cls):
        (cls.work / 'data/stop.request').touch()
        try: cls.process.wait(timeout=6)
        finally:
            if cls.process.poll() is None: cls.process.kill(); cls.process.wait()
            cls.temp.cleanup()
    def request(self, method='GET', path='/health', headers=None, body=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=3)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse(); return response.status, dict(response.getheaders()), response.read()
        finally: connection.close()
    def test_health_never_loads_sdk_and_payment_requires_opt_in(self):
        status, _, body = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['paymentEnabled'], False)
        self.assertEqual(self.request('POST', '/payments', {'Origin':'https://runncafe.ir', 'Content-Type':'application/json'}, '{}')[0], 503)
        self.assertFalse((self.work / 'data/attempts').exists())
    def test_payment_preflight_is_narrow_and_has_no_credentials(self):
        headers = {'Origin':'https://runncafe.ir', 'Access-Control-Request-Method':'POST', 'Access-Control-Request-Headers':'content-type'}
        status, result, _ = self.request('OPTIONS', '/payments', headers)
        self.assertEqual(status, 204); self.assertNotIn('Access-Control-Allow-Credentials', result)
        for patch in ({'Origin':'null'}, {'Origin':'https://evil.example'}, {'Access-Control-Request-Headers':'authorization'}, {'Access-Control-Request-Method':'DELETE'}):
            self.assertEqual(self.request('OPTIONS','/payments',{**headers, **patch})[0],403)
    def test_rejects_missing_or_wrong_origin_dns_rebinding_and_non_json(self):
        for headers in ({}, {'Origin':'null'}, {'Origin':'https://runncafe.ir.evil.example'}):
            self.assertEqual(self.request('POST','/payments',headers,'{}')[0],403)
        self.assertEqual(self.request(headers={'Host':'evil.example'})[0],400)
        self.assertEqual(self.request('POST','/payments',{'Origin':'https://runncafe.ir','Content-Type':'text/plain'},'{}')[0],400)
        self.assertEqual(self.request('POST','/health',{'Origin':'https://runncafe.ir'},'{}')[0],400)
    def test_ipv4_loopback_and_second_host_refused(self):
        rows = Path('/proc/net/tcp').read_text().splitlines()[1:]
        listeners = [r.split()[1] for r in rows if r.split()[1].endswith(f':{self.port:04X}') and r.split()[3]=='0A']
        self.assertEqual(listeners,[f'0100007F:{self.port:04X}'])
        result = subprocess.run(['mono',str(self.exe)], capture_output=True,timeout=5)
        self.assertNotEqual(result.returncode,0)
if __name__ == '__main__': unittest.main()
