using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using RunCafe.SepBridge.Payments;

internal static class PaymentEngineTests
{
    private sealed class Backend : IPaymentBackend
    {
        public int Claims, Reports; public bool ClaimOk = true, ReportOk = true;
        public bool Claim(Dictionary<string, object> value) { Interlocked.Increment(ref Claims); return ClaimOk; }
        public bool Report(Dictionary<string, object> value) { Interlocked.Increment(ref Reports); return ReportOk; }
    }
    private sealed class Worker : IPurchaseWorker
    {
        public Backend Backend; public int Calls; public bool Lost; public readonly ManualResetEvent Started = new ManualResetEvent(false), Release = new ManualResetEvent(false);
        public Dictionary<string, object> Run(string path) { if (!Backend.Claim(PaymentProtocol.Parse(File.ReadAllText(path)))) return null; Interlocked.Increment(ref Calls); Started.Set(); Release.WaitOne(3000); return Lost ? null : new Dictionary<string, object> { { "terminalId", "31187710" }, { "responseCode", "00" }, { "rrn", "123456789012" }, { "trace", "123456" } }; }
    }
    private static byte[] key = new byte[32];
    private const string bridge = "7b150841-7a93-4e1c-8283-bbab396a7689";
    private static Dictionary<string, object> Intent()
    {
        var value = new Dictionary<string, object> {
            { "attemptId", Guid.NewGuid().ToString() }, { "bridgeId", bridge }, { "terminalId", "31187710" }, { "orderId", Guid.NewGuid().ToString() },
            { "orderVersion", 2 }, { "cardAmount", 1000 }, { "unit", "TOMAN" }, { "checkoutHash", new string('a', 64) },
            { "nonce", Guid.NewGuid().ToString() }, { "issuedAtUnix", PaymentProtocol.Now() }, { "expiresAtUnix", PaymentProtocol.Now() + 120 }
        };
        value["signature"] = PaymentProtocol.Sign(PaymentProtocol.IntentMessage(value), key); return value;
    }
    private static PaymentEngine Engine(string root, Backend backend, Worker worker) { worker.Backend = backend; return new PaymentEngine(root, bridge, "31187710", key, backend, worker); }
    private static void Check(bool value) { if (!value) throw new Exception("Payment safety assertion failed"); }
    private static void Throws(Action action) { bool threw = false; try { action(); } catch (Exception) { threw = true; } Check(threw); }
    private static void Await(Func<bool> check) { for (int i = 0; i < 300 && !check(); i++) Thread.Sleep(10); Check(check()); }
    private static int Main(string[] args)
    {
        var vectors = PaymentProtocol.Parse(File.ReadAllText(args[0]));
        var vectorIntent = (Dictionary<string, object>)vectors["intent"];
        Check(PaymentProtocol.IntentMessage(vectorIntent) == (string)vectors["intentMessage"]);
        Check(PaymentProtocol.Sign(PaymentProtocol.IntentMessage(vectorIntent), key) == (string)vectors["intentSignature"]);
        var vectorClaim = (Dictionary<string, object>)vectors["claim"];
        string claimMessage = PaymentProtocol.Message("sep-claim-v1", vectorClaim["attemptId"], vectorClaim["bridgeId"], vectorClaim["nonce"], vectorClaim["sentAtUnix"]);
        Check(claimMessage == (string)vectors["claimMessage"] && PaymentProtocol.Sign(claimMessage, key) == (string)vectors["claimSignature"]);
        var vectorResult = (Dictionary<string, object>)vectors["result"];
        string resultMessage = PaymentProtocol.Message("sep-result-v1", vectorResult["attemptId"], vectorResult["bridgeId"], vectorResult["terminalId"], vectorResult["sentAtUnix"], vectorResult["finishedAtUnix"], vectorResult["responseCode"], vectorResult["rrn"], vectorResult["trace"]);
        Check(resultMessage == (string)vectors["resultMessage"] && PaymentProtocol.Sign(resultMessage, key) == (string)vectors["resultSignature"]);
        Console.WriteLine("Three shared HMAC conformance vectors passed.");
        string root = Path.Combine(Path.GetTempPath(), "sep-fake-" + Guid.NewGuid()); Directory.CreateDirectory(root);
        try
        {
            var backend = new Backend(); var worker = new Worker(); var engine = Engine(root, backend, worker); var intent = Intent();
            var tampered = new Dictionary<string, object>(intent); tampered["cardAmount"] = 1001; Throws(delegate { engine.Start(tampered); });
            tampered = new Dictionary<string, object>(intent); tampered["terminalId"] = "31187711"; Throws(delegate { engine.Start(tampered); });
            engine.Start(intent); Check(worker.Started.WaitOne(2000));
            // Duplicate request and status polling cannot dispatch again while the first request runs.
            for (int i = 0; i < 10; i++) { engine.Start(intent); engine.Status(intent); }
            Throws(delegate { engine.Start(Intent()); }); Check(backend.Claims == 1 && worker.Calls == 1);
            worker.Release.Set(); Await(delegate { return backend.Reports >= 1; });
            // Browser refresh / process restart reuses the durable marker, never a new claim or charge.
            var restarted = Engine(root, backend, worker); restarted.Start(intent); restarted.DeliverEvidence();
            Check(backend.Claims == 1 && worker.Calls == 1);
            var evidence = PaymentProtocol.Parse(File.ReadAllText(Path.Combine(root, intent["attemptId"] + ".evidence.json")));
            Check((string)evidence["responseCode"] == "00"); Check((string)restarted.Status(intent)["status"] == "UNKNOWN");
            // A lost claim response never reaches the purchase worker and remains blocked after restart.
            string lostRoot = Path.Combine(root, "lost-claim"); var lostBackend = new Backend { ClaimOk = false }; var lostWorker = new Worker();
            var lost = Engine(lostRoot, lostBackend, lostWorker); var lostIntent = Intent(); lost.Start(lostIntent);
            Await(delegate { return lostBackend.Claims == 1; }); Thread.Sleep(30);
            Engine(lostRoot, lostBackend, lostWorker).Start(lostIntent); Check(lostWorker.Calls == 0 && lostBackend.Claims == 1);
            // Timeout / lost response after approval is only unknown evidence, never a retry.
            string timeoutRoot = Path.Combine(root, "timeout"); var timeoutBackend = new Backend { ReportOk = false }; var timeoutWorker = new Worker { Lost = true }; timeoutWorker.Release.Set();
            var timeout = Engine(timeoutRoot, timeoutBackend, timeoutWorker); var timeoutIntent = Intent(); timeout.Start(timeoutIntent);
            Await(delegate { return timeoutBackend.Reports > 0; });
            var recovered = Engine(timeoutRoot, timeoutBackend, timeoutWorker); recovered.DeliverEvidence(); recovered.Start(timeoutIntent);
            Check(timeoutWorker.Calls == 1 && timeoutBackend.Claims == 1 && timeoutBackend.Reports >= 2);
            var unknown = PaymentProtocol.Parse(File.ReadAllText(Path.Combine(timeoutRoot, timeoutIntent["attemptId"] + ".evidence.json")));
            Check(unknown["responseCode"] == null);
            Console.WriteLine("Payment safety scenarios passed: tamper, terminal mismatch, duplicate, concurrent, polling, refresh, restart, lost claim, timeout, approval loss, evidence retry."); return 0;
        }
        finally { Directory.Delete(root, true); }
    }
}
