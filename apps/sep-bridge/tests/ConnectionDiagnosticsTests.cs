using System;
using System.Collections.Generic;
using System.Net.Sockets;
using System.Threading;
using RunCafe.SepBridge.Diagnostics;

internal static class ConnectionDiagnosticsTests
{
    private static int failures;
    private static int count;
    private sealed class Fake : ISepDiagnosticDevice
    {
        internal readonly List<string> Calls = new List<string>();
        internal bool Lan = true;
        internal SepConnectionResponse Response = new SepConnectionResponse("00", "31187710");
        internal Action DuringTest;
        internal Action DuringCleanup;
        internal bool FailInitialize;
        public bool SetLan(string ip) { Check(ip == "192.168.1.101"); Calls.Add("lan"); return Lan; }
        public void InitializeEnglishSync(int seconds) { Check(seconds == 10); Calls.Add("init"); if (FailInitialize) throw new InvalidOperationException(); }
        public SepConnectionResponse ConnectionTest() { Calls.Add("test"); if (DuringTest != null) DuringTest(); return Response; }
        public void Dispose() { Calls.Add("dispose"); if (DuringCleanup != null) DuringCleanup(); }
    }
    private static void Check(bool condition) { if (!condition) throw new Exception("Assertion failed"); }
    private static ConnectionDiagnostics Service(Fake fake)
    {
        return new ConnectionDiagnostics(delegate { fake.Calls.Add("create"); return fake; }, "192.168.1.101", "31187710");
    }
    private static void Run(string name, Action action)
    {
        count++;
        try { action(); Console.WriteLine("PASS " + name); }
        catch (Exception error) { failures++; Console.WriteLine("FAIL " + name + " (" + error.GetType().Name + ")"); }
    }
    private static void ConcurrentGate(bool duringCleanup)
    {
        using (var entered = new ManualResetEvent(false))
        using (var release = new ManualResetEvent(false))
        {
            var first = new Fake();
            Action block = delegate { entered.Set(); if (!release.WaitOne(3000)) throw new Exception("Test synchronization timed out"); };
            if (duringCleanup) first.DuringCleanup = block; else first.DuringTest = block;
            ConnectionDiagnosticResult initial = null;
            var thread = new Thread(delegate() { initial = Service(first).Run(); });
            thread.Start();
            try
            {
                Check(entered.WaitOne(2000));
                var other = new Fake();
                Check(Service(other).Run().Outcome == ConnectionOutcome.Busy);
                Check(other.Calls.Count == 0); // no constructor or extra terminal request
            }
            finally { release.Set(); Check(thread.Join(4000)); }
            Check(initial != null && initial.Outcome == ConnectionOutcome.Connected);
            Check(Service(new Fake()).Run().Outcome == ConnectionOutcome.Connected);
        }
    }
    private static int Main()
    {
        Run("success validates identity and exact initialization order", delegate {
            var fake = new Fake(); var result = Service(fake).Run();
            Check(result.Outcome == ConnectionOutcome.Connected && result.ResponseCode == "00" && result.TerminalId == "31187710" && !result.CleanupFailed);
            Check(String.Join(",", fake.Calls) == "create,lan,init,test,dispose");
        });
        Run("incorrect terminal identity", delegate {
            var fake = new Fake { Response = new SepConnectionResponse("00", "12345678") };
            Check(Service(fake).Run().Outcome == ConnectionOutcome.TerminalMismatch);
        });
        Run("no connection response", delegate {
            var fake = new Fake { Response = new SepConnectionResponse("03", null) };
            Check(Service(fake).Run().Outcome == ConnectionOutcome.TerminalUnavailable);
        });
        Run("diagnostic timeout response", delegate {
            var fake = new Fake { Response = new SepConnectionResponse("99", null) };
            Check(Service(fake).Run().Outcome == ConnectionOutcome.TerminalUnavailable);
        });
        Run("offline socket exception", delegate {
            var fake = new Fake { DuringTest = delegate { throw new SocketException(); } };
            Check(Service(fake).Run().Outcome == ConnectionOutcome.TerminalUnavailable);
            Check(fake.Calls.FindAll(x => x == "test").Count == 1);
        });
        Run("timeout exception does not retry", delegate {
            var fake = new Fake { DuringTest = delegate { throw new TimeoutException(); } };
            Check(Service(fake).Run().Outcome == ConnectionOutcome.TerminalUnavailable);
            Check(fake.Calls.FindAll(x => x == "test").Count == 1);
        });
        Run("unrecognized response is protocol failure", delegate {
            var fake = new Fake { Response = new SepConnectionResponse("XX", "31187710") };
            Check(Service(fake).Run().Outcome == ConnectionOutcome.ProtocolError);
        });
        Run("null response is protocol failure", delegate {
            Check(Service(new Fake { Response = null }).Run().Outcome == ConnectionOutcome.ProtocolError);
        });
        Run("success code without identity is not connected", delegate {
            Check(Service(new Fake { Response = new SepConnectionResponse("00", null) }).Run().Outcome == ConnectionOutcome.ProtocolError);
        });
        Run("raw malformed fields and exception text are not returned", delegate {
            var result = Service(new Fake { Response = new SepConnectionResponse(new String('1', 16), new String('2', 16)) }).Run();
            Check(result.Outcome == ConnectionOutcome.ProtocolError && result.ResponseCode == null && result.TerminalId == null);
            result = Service(new Fake { DuringTest = delegate { throw new Exception("DO_NOT_RETURN_RAW_EXCEPTION"); } }).Run();
            Check(result.Outcome == ConnectionOutcome.ProtocolError && result.ResponseCode == null && result.TerminalId == null);
        });
        Run("failed LAN selection cannot initialize or request", delegate {
            var fake = new Fake { Lan = false };
            Check(Service(fake).Run().Outcome == ConnectionOutcome.ProtocolError);
            Check(String.Join(",", fake.Calls) == "create,lan,dispose");
        });
        Run("initialization error cleans up without a connection request", delegate {
            var fake = new Fake { FailInitialize = true };
            Check(Service(fake).Run().Outcome == ConnectionOutcome.ProtocolError);
            Check(String.Join(",", fake.Calls) == "create,lan,init,dispose");
        });
        Run("factory error releases the gate", delegate {
            var service = new ConnectionDiagnostics(delegate { throw new Exception(); }, "192.168.1.101", "31187710");
            Check(service.Run().Outcome == ConnectionOutcome.ProtocolError);
            Check(Service(new Fake()).Run().Outcome == ConnectionOutcome.Connected);
        });
        Run("cleanup failure prevents a successful diagnostic result", delegate {
            var fake = new Fake { DuringCleanup = delegate { throw new Exception(); } };
            var result = Service(fake).Run();
            Check(result.Outcome == ConnectionOutcome.ProtocolError && result.CleanupFailed);
            Check(Service(new Fake()).Run().Outcome == ConnectionOutcome.Connected);
        });
        Run("concurrent request is rejected before factory creation", delegate { ConcurrentGate(false); });
        Run("concurrent request is rejected during cleanup", delegate { ConcurrentGate(true); });
        Run("invalid configuration creates no device", delegate {
            foreach (string ip in new[] { "localhost", "192.168.1.101:1197", "123", "::1" })
            {
                bool rejected = false;
                try { new ConnectionDiagnostics(delegate { throw new Exception(); }, ip, "31187710"); }
                catch (ArgumentException) { rejected = true; }
                Check(rejected);
            }
            bool badIdentity = false;
            try { new ConnectionDiagnostics(delegate { throw new Exception(); }, "192.168.1.101", "123"); }
            catch (ArgumentException) { badIdentity = true; }
            Check(badIdentity);
        });
        Console.WriteLine((count - failures) + "/" + count + " diagnostic tests passed; fake devices only");
        return failures == 0 ? 0 : 1;
    }
}
