using System;
using System.Collections.Generic;
using System.Threading;
using RunCafe.SepBridge.Payments;
internal static class TerminalMonitorTests
{
    private static void Check(bool ok) { if (!ok) throw new Exception("Monitor assertion failed"); }
    private static Dictionary<string, object> Connected() { return new Dictionary<string, object> { { "status", "connected" }, { "responseCode", "00" } }; }
    private sealed class Purchase : IPurchaseWorker {
        public int Calls;
        public Dictionary<string, object> Run(string path) { Interlocked.Increment(ref Calls); return Connected(); }
    }
    public static int Main() {
        int checks = 0; bool busy = true, idle = true;
        var monitor = new TerminalMonitor(delegate { return busy; }, delegate { return idle; }, delegate { checks++; return Connected(); });
        monitor.Tick(); Check(checks == 0 && (string)monitor.Snapshot()["status"] == "unknown");
        busy = false; idle = false; monitor.Tick(); Check(checks == 0);
        idle = true; monitor.Tick(); Check(checks == 1 && (string)monitor.Snapshot()["status"] == "connected" && monitor.Snapshot()["ageSeconds"] != null);
        var started = new ManualResetEvent(false); var release = new ManualResetEvent(false);
        var concurrent = new TerminalMonitor(delegate { return false; }, delegate { return true; }, delegate { Interlocked.Increment(ref checks); started.Set(); release.WaitOne(); return Connected(); });
        var t = new Thread(concurrent.Tick); t.Start(); Check(started.WaitOne(1000)); concurrent.Tick(); Check(checks == 2); release.Set(); Check(t.Join(2000));
        var failure = new TerminalMonitor(delegate { return false; }, delegate { return true; }, delegate { throw new Exception("Do not expose vendor details"); });
        failure.Tick(); Check((string)failure.Snapshot()["status"] == "unavailable");
        var purchase = new Purchase(); started.Reset(); release.Reset(); busy = false;
        var workers = new DeviceWorkers(purchase, "unused", delegate { started.Set(); release.WaitOne(); return Connected(); });
        var diagnostic = new Thread(delegate() { workers.Check(delegate { return busy; }); }); diagnostic.Start(); Check(started.WaitOne(1000));
        busy = true;
        var payment = new Thread(delegate() { workers.Run("fake"); }); payment.Start();
        Check(purchase.Calls == 0); Check(workers.Check(delegate { return busy; }) == null);
        release.Set(); Check(diagnostic.Join(2000)); Check(payment.Join(2000)); Check(purchase.Calls == 1);
        Check(workers.Check(delegate { return busy; }) == null);
        Console.WriteLine("Terminal monitor passed: idle guard, payment priority, no overlap, errors and status age."); return 0;
    }
}
