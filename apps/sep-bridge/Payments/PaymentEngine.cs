using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading;

namespace RunCafe.SepBridge.Payments
{
    public interface IPaymentBackend
    {
        bool Report(Dictionary<string, object> evidence);
    }
    public interface ITimingBackend { bool ReportTiming(Dictionary<string, object> evidence); }
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
        public bool IsBusy { get { lock (gate) return running; } }
        public PaymentEngine(string directory, string bridgeId, string terminalId, byte[] key, IPaymentBackend backend, IPurchaseWorker worker)
        {
            this.directory = directory; this.bridgeId = bridgeId; this.terminalId = terminalId; this.key = key;
            this.backend = backend; this.worker = worker; Directory.CreateDirectory(directory);
        }
        public Dictionary<string, object> Start(Dictionary<string, object> intent)
        {
            var acceptWatch = Stopwatch.StartNew();
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
                acceptWatch.Stop();
                long bridgeAcceptMs = acceptWatch.ElapsedMilliseconds;
                try { PaymentProtocol.AppendDiagnostic(path, "BRIDGE_ACCEPT", "TIMED", null, null, bridgeAcceptMs); } catch (Exception) { }
                long queuedAt = Stopwatch.GetTimestamp();
                ThreadPool.QueueUserWorkItem(delegate { Execute(intent, path, bridgeAcceptMs, queuedAt); });
                return new Dictionary<string, object> { { "attemptId", intent["attemptId"] }, { "status", "PENDING" } };
            }
        }
        private void Execute(Dictionary<string, object> intent, string path, long bridgeAcceptMs, long queuedAt)
        {
            long dispatchQueueMs = Math.Max(0, (long)((Stopwatch.GetTimestamp() - queuedAt) * 1000.0 / Stopwatch.Frequency));
            try { PaymentProtocol.AppendDiagnostic(path, "DISPATCH_QUEUE", "TIMED", null, null, dispatchQueueMs); } catch (Exception) { }
            try
            {
                // The isolated worker redeems backend authorization once before loading the SDK.
                PaymentProtocol.AppendDiagnostic(path, "HOST_EXECUTION", "WORKER_STARTING");
                var workerWatch = System.Diagnostics.Stopwatch.StartNew();
                Dictionary<string, object> result = worker.Run(path);
                workerWatch.Stop();
                var timings = new Dictionary<string, object>();
                if (result != null && result.ContainsKey("timingsMs"))
                    foreach (var item in (Dictionary<string, object>)result["timingsMs"]) timings[item.Key] = item.Value;
                foreach (var item in ReadDiagnosticTimings(path)) timings[item.Key] = item.Value;
                timings["bridgeAcceptMs"] = bridgeAcceptMs;
                timings["dispatchQueueMs"] = dispatchQueueMs;
                long workerProcessMs = workerWatch.ElapsedMilliseconds;
                timings["workerProcessMs"] = workerProcessMs;
                try { PaymentProtocol.AppendDiagnostic(path, "WORKER_PROCESS", "TIMED", null, null, workerProcessMs); } catch (Exception) { }
                PaymentProtocol.AppendDiagnostic(path, "HOST_EXECUTION", result == null ? "NO_WORKER_RESULT" : "WORKER_RESULT_RECEIVED");
                var evidence = new Dictionary<string, object> {
                    { "attemptId", intent["attemptId"] }, { "bridgeId", bridgeId }, { "terminalId", terminalId },
                    { "finishedAtUnix", PaymentProtocol.Now() },
                    { "responseCode", result == null ? null : PaymentProtocol.SafeCode(PaymentProtocol.Text(result, "responseCode")) },
                    { "rrn", result == null ? null : PaymentProtocol.SafeReference(PaymentProtocol.Text(result, "rrn")) },
                    { "trace", result == null ? null : PaymentProtocol.SafeReference(PaymentProtocol.Text(result, "trace")) },
                    { "timingsMs", timings }
                };
                // Terminal mismatch / cleanup failure / timeout cannot become verified approval.
                if (result != null && PaymentProtocol.Text(result, "terminalId") != terminalId)
                { evidence["responseCode"] = null; evidence["rrn"] = null; evidence["trace"] = null; }
                PaymentProtocol.DurableCreate(path.Replace(".intent.json", ".evidence.json"), PaymentProtocol.Json.Serialize(evidence));
            }
            catch (Exception)
            {
                try { PaymentProtocol.AppendDiagnostic(path, "HOST_EXECUTION", "EXCEPTION"); } catch (Exception) { }
                /* Persisted dispatch marker keeps this attempt uncertain after any fault. */
            }
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
        private static Dictionary<string, object> ReadDiagnosticTimings(string path)
        {
            var result = new Dictionary<string, object>();
            try
            {
                foreach (string line in File.ReadAllLines(path + ".diagnostics.jsonl"))
                {
                    var record = PaymentProtocol.Parse(line);
                    string phase = PaymentProtocol.Text(record, "phase"); object raw;
                    if (!record.TryGetValue("elapsedMs", out raw) || !(raw is int || raw is long || raw is decimal)) continue;
                    string name = phase == "INTENT_VALIDATION" ? "intentValidationMs" :
                        phase == "DEVICE_MUTEX" ? "deviceMutexMs" : phase == "BACKEND_CLAIM" ? "backendClaimMs" :
                        phase == "SDK_FACTORY" ? "sdkFactoryMs" : phase == "PRE_PURCHASE" ? "prePurchaseMs" : phase == "SDK_HASHES" ? "sdkVerificationMs" : phase == "SET_LAN" ? "setLanMs" :
                        phase == "SDK_INITIALIZATION" ? "sdkInitializationMs" : phase == "CONNECTION_TEST" ? "connectionTestMs" :
                        phase == "PURCHASE_REINITIALIZATION" ? "purchaseReinitializationMs" : phase == "PURCHASE_CALL" ? "purchaseCallMs" :
                        phase == "SDK_CLEANUP" ? "sdkCleanupMs" : phase == "WORKER_TOTAL" ? "workerTotalMs" :
                        phase == "WORKER_PROCESS" ? "workerProcessMs" : phase == "BRIDGE_ACCEPT" ? "bridgeAcceptMs" :
                        phase == "DISPATCH_QUEUE" ? "dispatchQueueMs" : null;
                    if (name == null) continue;
                    long elapsed = Convert.ToInt64(raw, System.Globalization.CultureInfo.InvariantCulture);
                    if (elapsed >= 0 && elapsed <= 86400000) result[name] = elapsed;
                }
            }
            catch (Exception) { /* Local timing collection cannot change purchase handling. */ }
            return result;
        }
        private readonly object deliveryGate = new object();
        public void DeliverEvidence()
        {
            if (!Monitor.TryEnter(deliveryGate)) return;
            try
            {
                foreach (string path in Directory.GetFiles(directory, "*.evidence.json"))
                {
                    try
                    {
                        var result = PaymentProtocol.Parse(File.ReadAllText(path));
                        string intentPath = path.Replace(".evidence.json", ".intent.json");
                        if (!File.Exists(path + ".delivered"))
                        {
                            var watch = Stopwatch.StartNew();
                            bool delivered = backend.Report(result); watch.Stop();
                            try { PaymentProtocol.AppendDiagnostic(intentPath, "EVIDENCE_DELIVERY", delivered ? "ACKNOWLEDGED" : "RETRY_REQUIRED", null, null, watch.ElapsedMilliseconds); } catch (Exception) { }
                            if (delivered) PaymentProtocol.DurableCreate(path + ".delivered", "{}");
                        }
                        var timingBackend = backend as ITimingBackend;
                        if (timingBackend != null && !File.Exists(path + ".timing-delivered"))
                        {
                            var watch = Stopwatch.StartNew();
                            bool delivered = timingBackend.ReportTiming(result); watch.Stop();
                            try { PaymentProtocol.AppendDiagnostic(intentPath, "TIMING_DELIVERY", delivered ? "ACKNOWLEDGED" : "RETRY_REQUIRED", null, null, watch.ElapsedMilliseconds); } catch (Exception) { }
                            if (delivered) PaymentProtocol.DurableCreate(path + ".timing-delivered", "{}");
                        }
                    }
                    catch (Exception) { /* Delivery retry never dispatches a purchase. */ }
                }
            }
            finally { Monitor.Exit(deliveryGate); }
        }
    }
}
