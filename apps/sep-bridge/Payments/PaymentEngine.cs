using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;

namespace RunCafe.SepBridge.Payments
{
    public interface IPaymentBackend
    {
        bool Report(Dictionary<string, object> evidence);
    }
    public interface IPurchaseWorker { Dictionary<string, object> Run(string intentPath); }

    // No SDK reference. All entry points are safe with fakes and an isolated journal.
    public sealed class PaymentEngine
    {
        private readonly object gate = new object();
        private readonly string directory, bridgeId, terminalId;
        private readonly byte[] key;
        private readonly IPaymentBackend backend;
        private readonly IPurchaseWorker worker;
        private bool running;
        public PaymentEngine(string directory, string bridgeId, string terminalId, byte[] key, IPaymentBackend backend, IPurchaseWorker worker)
        {
            this.directory = directory; this.bridgeId = bridgeId; this.terminalId = terminalId; this.key = key;
            this.backend = backend; this.worker = worker; Directory.CreateDirectory(directory);
        }
        public Dictionary<string, object> Start(Dictionary<string, object> intent)
        {
            PaymentProtocol.ValidateIntent(intent, key, bridgeId, terminalId, false);
            string path = Path.Combine(directory, (string)intent["attemptId"] + ".intent.json");
            lock (gate)
            {
                if (File.Exists(path))
                {
                    var prior = PaymentProtocol.Parse(File.ReadAllText(path));
                    if (!PaymentProtocol.Equal(PaymentProtocol.Text(prior, "signature"), PaymentProtocol.Text(intent, "signature"))) throw new InvalidOperationException();
                    return Status(intent);
                }
                PaymentProtocol.ValidateIntent(intent, key, bridgeId, terminalId, true);
                if (running) throw new InvalidOperationException();
                // Persist the never-dispatch-again marker BEFORE redeeming backend authorization.
                PaymentProtocol.DurableCreate(path, PaymentProtocol.Json.Serialize(intent));
                running = true;
                ThreadPool.QueueUserWorkItem(delegate { Execute(intent, path); });
                return new Dictionary<string, object> { { "attemptId", intent["attemptId"] }, { "status", "PENDING" } };
            }
        }
        private void Execute(Dictionary<string, object> intent, string path)
        {
            try
            {
                // The isolated worker redeems backend authorization once before loading the SDK.
                Dictionary<string, object> result = worker.Run(path);
                var evidence = new Dictionary<string, object> {
                    { "attemptId", intent["attemptId"] }, { "bridgeId", bridgeId }, { "terminalId", terminalId },
                    { "finishedAtUnix", PaymentProtocol.Now() },
                    { "responseCode", result == null ? null : PaymentProtocol.SafeCode(PaymentProtocol.Text(result, "responseCode")) },
                    { "rrn", result == null ? null : PaymentProtocol.SafeReference(PaymentProtocol.Text(result, "rrn")) },
                    { "trace", result == null ? null : PaymentProtocol.SafeReference(PaymentProtocol.Text(result, "trace")) }
                };
                // Terminal mismatch / cleanup failure / timeout cannot become verified approval.
                if (result != null && PaymentProtocol.Text(result, "terminalId") != terminalId)
                { evidence["responseCode"] = null; evidence["rrn"] = null; evidence["trace"] = null; }
                PaymentProtocol.DurableCreate(path.Replace(".intent.json", ".evidence.json"), PaymentProtocol.Json.Serialize(evidence));
            }
            catch (Exception) { /* Persisted dispatch marker keeps this attempt uncertain after any fault. */ }
            finally { lock (gate) running = false; }
            DeliverEvidence();
        }
        public Dictionary<string, object> Status(Dictionary<string, object> intent)
        {
            PaymentProtocol.ValidateIntent(intent, key, bridgeId, terminalId, false);
            string path = Path.Combine(directory, (string)intent["attemptId"] + ".intent.json");
            if (!File.Exists(path)) throw new FileNotFoundException();
            var prior = PaymentProtocol.Parse(File.ReadAllText(path));
            if (!PaymentProtocol.Equal(PaymentProtocol.Text(prior, "signature"), PaymentProtocol.Text(intent, "signature"))) throw new InvalidOperationException();
            return new Dictionary<string, object> { { "attemptId", intent["attemptId"] }, { "status", "UNKNOWN" }, { "manualVerificationRequired", true } };
        }
        private readonly object deliveryGate = new object();
        public void DeliverEvidence()
        {
            if (!Monitor.TryEnter(deliveryGate)) return;
            try
            {
                foreach (string path in Directory.GetFiles(directory, "*.evidence.json"))
                {
                    if (File.Exists(path + ".delivered")) continue;
                    try
                    {
                        var result = PaymentProtocol.Parse(File.ReadAllText(path));
                        if (backend.Report(result)) PaymentProtocol.DurableCreate(path + ".delivered", "{}");
                    }
                    catch (Exception) { /* Retry only delivery of evidence, never claim or purchase. */ }
                }
            }
            finally { Monitor.Exit(deliveryGate); }
        }
    }
}
