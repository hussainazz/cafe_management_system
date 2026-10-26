"""Exercise the real health-only host under Mono. No SDK or terminal access."""
import http.client
import json
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import unittest


ROOT = Path(__file__).resolve().parents[1]


class HealthTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="sep-health-test-")
        cls.work = Path(cls.temp.name)
        cls.exe = cls.work / "RunCafe.SepBridge.Health.exe"
        subprocess.run(["mcs", "-sdk:4.8", "-langversion:5", "-warnaserror", "-platform:x86", "-target:winexe", "-optimize+", "-r:System.Configuration", f"-out:{cls.exe}", str(ROOT / "Program.cs")], check=True)
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            cls.port = probe.getsockname()[1]
        cls.config = cls.exe.with_suffix(".exe.config")
        cls.config.write_text((ROOT / "App.config").read_text().replace('value="18711"', f'value="{cls.port}"').replace('key="DataDirectory" value=""', f'key="DataDirectory" value="{cls.work / "data"}"'))
        cls.process = subprocess.Popen(["mono", str(cls.exe)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                with socket.create_connection(("127.0.0.1", cls.port), timeout=.1):
                    return
            except OSError:
                if cls.process.poll() is not None:
                    raise RuntimeError("Bridge exited during startup")
                time.sleep(.05)
        raise RuntimeError("Bridge did not start")

    @classmethod
    def tearDownClass(cls):
        (cls.work / "data" / "stop.request").touch()
        try:
            code = cls.process.wait(timeout=6)
            if code != 0:
                raise RuntimeError(f"Unexpected bridge exit: {code}")
        finally:
            if cls.process.poll() is None:
                cls.process.kill()
                cls.process.wait()
            cls.temp.cleanup()

    def request(self, method="GET", path="/health", headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        try:
            connection.request(method, path, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_health_is_read_only_and_does_not_claim_device_readiness(self):
        status, headers, body = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), dict(service="run-cafe-sep-bridge", version="0.1.0", mode="health-only", paymentEnabled=False, terminalAccess=False))
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_only_exact_allowed_origin_receives_cors(self):
        status, headers, _ = self.request(headers={"Origin": "https://runncafe.ir"})
        self.assertEqual(status, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "https://runncafe.ir")
        self.assertNotIn("Access-Control-Allow-Credentials", headers)
        for origin in ("null", "https://evil.example", "http://runncafe.ir", "https://runncafe.ir.evil.example", "https://runncafe.ir/"):
            status, headers, _ = self.request(headers={"Origin": origin})
            self.assertEqual(status, 403)
            self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_preflight_allows_only_the_diagnostic_get(self):
        headers = {"Origin": "https://runncafe.ir", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "x-run-cafe-diagnostic"}
        status, result, body = self.request("OPTIONS", headers=headers)
        self.assertEqual(status, 204)
        self.assertEqual(result["Access-Control-Allow-Methods"], "GET")
        self.assertEqual(body, b"")
        for changed in ({"Access-Control-Request-Method": "POST"}, {"Access-Control-Request-Headers": "authorization"}, {"Origin": "null"}):
            self.assertEqual(self.request("OPTIONS", headers={**headers, **changed})[0], 403)
        self.assertEqual(self.request("OPTIONS")[0], 403)

    def test_rejects_payment_routes_wrong_hosts_and_bodies(self):
        for path in ("/payments", "/purchase", "/health?purchase=true"):
            self.assertEqual(self.request(path=path)[0], 404)
        # http.client supplies the absolute URL's Host, so this fails Host validation.
        self.assertEqual(self.request(path="http://evil.example/health")[0], 400)
        self.assertEqual(self.request("POST")[0], 405)
        for headers in ({"Host": "evil.example"}, {"Host": f"192.168.1.102:{self.port}"}, {"Content-Length": "1"}, {"Transfer-Encoding": "chunked"}):
            self.assertEqual(self.request(headers=headers)[0], 400)

    def test_rejects_duplicate_headers_and_bounds_incomplete_input(self):
        with socket.create_connection(("127.0.0.1", self.port), timeout=5) as client:
            client.sendall(f"GET /health HTTP/1.1\r\nHost: 127.0.0.1:{self.port}\r\nHost: evil.example\r\n\r\n".encode())
            self.assertTrue(client.recv(4096).startswith(b"HTTP/1.1 400"))
        for payload in (b"G" * 8200, b"GET /health HTTP/1.1\r\n"):
            with socket.create_connection(("127.0.0.1", self.port), timeout=6) as client:
                client.sendall(payload)
                self.assertEqual(client.recv(4096), b"")
        self.assertEqual(self.request()[0], 200)

    def test_concurrent_reads_and_exclusive_binding(self):
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=4) as pool:
            self.assertEqual(list(pool.map(lambda _: self.request()[0], range(12))), [200] * 12)
        other = subprocess.run(["mono", str(self.exe)], timeout=5, capture_output=True)
        self.assertNotEqual(other.returncode, 0)
        self.assertEqual(self.request()[0], 200)

    def test_linux_socket_is_ipv4_loopback_and_metadata_is_x86(self):
        # Verify the live socket, not just source/configuration.
        rows = Path("/proc/net/tcp").read_text().splitlines()[1:]
        matches = [row.split()[1] for row in rows if row.split()[1].endswith(f":{self.port:04X}") and row.split()[3] == "0A"]
        self.assertEqual(matches, [f"0100007F:{self.port:04X}"])
        metadata = subprocess.check_output(["file", str(self.exe)], text=True)
        self.assertIn("PE32 executable", metadata)
        self.assertRegex(metadata, r"Intel (i386|80386)")
        # PE32 alone could be AnyCPU. Verify the CLR 32BITREQUIRED bit too.
        import struct
        image = self.exe.read_bytes()
        pe = struct.unpack_from("<I", image, 0x3C)[0]
        section_count = struct.unpack_from("<H", image, pe + 6)[0]
        optional_size = struct.unpack_from("<H", image, pe + 20)[0]
        cli_rva = struct.unpack_from("<I", image, pe + 24 + 96 + 14 * 8)[0]
        section_offset = pe + 24 + optional_size
        for i in range(section_count):
            offset = section_offset + i * 40
            size, rva, raw_size, raw = struct.unpack_from("<IIII", image, offset + 8)
            if rva <= cli_rva < rva + max(size, raw_size):
                cli_offset = raw + cli_rva - rva
                flags = struct.unpack_from("<I", image, cli_offset + 16)[0]
                self.assertEqual(flags & 3, 3)  # ILONLY | 32BITREQUIRED
                break
        else:
            self.fail("Missing CLR header")

    def test_logs_do_not_contain_raw_inputs(self):
        marker = "sensitive-marker-do-not-log"
        self.request(headers={"Origin": f"https://{marker}.invalid"})
        time.sleep(.1)
        text = (self.work / "data" / "bridge.jsonl").read_text()
        self.assertNotIn(marker, text)
        for line in text.splitlines():
            self.assertEqual(set(json.loads(line)), {"utc", "event", "status"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
