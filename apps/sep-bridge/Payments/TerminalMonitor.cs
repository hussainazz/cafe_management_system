using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading;

namespace RunCafe.SepBridge.Payments
{
    // Scheduling and status only. Never loads the bank SDK or starts a purchase.
    public sealed class TerminalMonitor
    {
        private readonly Func<bool> paymentBusy, backendIdle;
        private readonly Func<Dictionary<string, object>> check;
        private readonly object gate = new object();
        private int checking;
        private long completedTick;
        private Dictionary<string, object> last = new Dictionary<string, object> {
            { "status", "unknown" }, { "checkedAtUtc", null }, { "elapsedMs", null }, { "responseCode", null }
        };
        public TerminalMonitor(Func<bool> paymentBusy, Func<bool> backendIdle, Func<Dictionary<string, object>> check)
        { this.paymentBusy = paymentBusy; this.backendIdle = backendIdle; this.check = check; }
        public void Tick()
        {
            if (Interlocked.CompareExchange(ref checking, 1, 0) != 0) return;
            try
            {
                if (paymentBusy() || !backendIdle() || paymentBusy()) return;
                var watch = Stopwatch.StartNew();
                var result = check();
                if (result == null) return; // Payment took priority, or another device operation owns the mutex.
                watch.Stop();
                result["elapsedMs"] = watch.ElapsedMilliseconds;
                result["checkedAtUtc"] = DateTime.UtcNow.ToString("o");
                lock (gate) { last = result; completedTick = Stopwatch.GetTimestamp(); }
            }
            catch
            {
                lock (gate) {
                    last = new Dictionary<string, object> { { "status", "unavailable" }, { "checkedAtUtc", DateTime.UtcNow.ToString("o") }, { "elapsedMs", null }, { "responseCode", null } };
                    completedTick = Stopwatch.GetTimestamp();
                }
            }
            finally { Interlocked.Exchange(ref checking, 0); }
        }
        public Dictionary<string, object> Snapshot()
        {
            lock (gate) {
                var snapshot = new Dictionary<string, object>(last);
                snapshot["ageSeconds"] = completedTick == 0 ? (object)null : Math.Max(0L, (Stopwatch.GetTimestamp() - completedTick) / Stopwatch.Frequency);
                snapshot["checking"] = Interlocked.CompareExchange(ref checking, 0, 0) != 0;
                return snapshot;
            }
        }
    }

    // Serialize process startup as well as SDK access. A pending payment sets
    // engine.IsBusy before waiting here; subsequent monitor ticks then skip it.
    internal sealed class DeviceWorkers : IPurchaseWorker
    {
        private readonly object deviceGate = new object();
        private readonly IPurchaseWorker purchase;
        private readonly string connectionExecutable;
        private readonly Func<Dictionary<string, object>> connectionProbe;
        public DeviceWorkers(IPurchaseWorker purchase, string connectionExecutable, Func<Dictionary<string, object>> connectionProbe = null)
        { this.purchase = purchase; this.connectionExecutable = connectionExecutable; this.connectionProbe = connectionProbe; }
        public Dictionary<string, object> Run(string intentPath)
        { lock (deviceGate) return purchase.Run(intentPath); }
        public Dictionary<string, object> Check(Func<bool> paymentBusy)
        {
            if (!Monitor.TryEnter(deviceGate)) return null;
            try
            {
                if (paymentBusy()) return null;
                return connectionProbe == null ? CheckProcess() : connectionProbe();
            }
            finally { Monitor.Exit(deviceGate); }
        }
        private Dictionary<string, object> CheckProcess()
        {
                var start = new ProcessStartInfo(connectionExecutable, "--connection-test") {
                    UseShellExecute = false, CreateNoWindow = true,
                    RedirectStandardOutput = true, RedirectStandardError = true,
                    WorkingDirectory = Path.GetDirectoryName(connectionExecutable)
                };
                using (var process = Process.Start(start))
                {
                    var output = new System.Text.StringBuilder(); object outputGate = new object(); bool overflow = false;
                    process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) {
                        if (e.Data == null) return;
                        lock (outputGate) { if (output.Length + e.Data.Length > 2048) overflow = true; else output.Append(e.Data); }
                    };
                    process.ErrorDataReceived += delegate { };
                    process.BeginOutputReadLine(); process.BeginErrorReadLine();
                    if (!process.WaitForExit(30000)) {
                        process.Kill();
                        if (!process.WaitForExit(5000)) throw new IOException();
                        throw new TimeoutException();
                    }
                    process.WaitForExit();
                    lock (outputGate) {
                        if (overflow) throw new IOException();
                        var result = PaymentProtocol.Parse(output.ToString());
                        if (PaymentProtocol.Text(result, "mode") != "connection-diagnostic-only") throw new IOException();
                        string status = PaymentProtocol.Text(result, "status");
                        if (status == "Busy") return null;
                        object cleanup;
                        bool connected = process.ExitCode == 0 && status == "Connected" &&
                            result.TryGetValue("cleanupFailed", out cleanup) && cleanup is bool && !(bool)cleanup;
                        return new Dictionary<string, object> {
                            { "status", connected ? "connected" : "unavailable" },
                            { "responseCode", PaymentProtocol.SafeCode(PaymentProtocol.Text(result, "responseCode")) }
                        };
                    }
                }
        }
    }
}
