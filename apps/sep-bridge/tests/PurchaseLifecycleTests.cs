using System;
using System.Collections.Generic;
using RunCafe.SepBridge.Payments;

internal static class PurchaseLifecycleTests
{
    private sealed class FakeDevice : ISepPurchaseDevice
    {
        public readonly List<string> Calls = new List<string>();
        public bool Connected;
        public int RejectSetLanCall;
        private int setLanCalls;
        public SepSdkResult Connection = new SepSdkResult { ResponseCode = "00", TerminalId = "31187710" };
        public SepSdkResult PurchaseResult = new SepSdkResult { ResponseCode = "00", TerminalId = "31187710", Rrn = "123456789012", Trace = "123456" };

        public bool SetLan(string ip) { Calls.Add("SetLan:" + ip); setLanCalls++; bool accepted = RejectSetLanCall != setLanCalls; if (accepted) Connected = false; return accepted; }
        public void Initialize() { Calls.Add("Initialization"); Connected = true; }
        public SepSdkResult ConnectionTest() { Calls.Add("ConnectionTest"); Connected = false; return Connection; }
        public SepSdkResult Purchase(string amount, string terminalId)
        {
            Calls.Add("PcStarterPurchase");
            if (!Connected) throw new Exception("purchase attempted without reinitialized channel");
            if (amount != "350000" || terminalId != "31187710") throw new Exception("purchase arguments changed");
            return PurchaseResult;
        }
        public void Dispose() { Calls.Add("Dispose"); Connected = false; }
    }

    private static void Check(bool value) { if (!value) throw new Exception("Purchase lifecycle assertion failed"); }
    private static SepSdkResult Run(FakeDevice device, bool current, List<string> diagnostics)
    {
        return PurchaseLifecycle.Execute(device, "192.168.1.101", "31187710", "350000", delegate { return current; },
            delegate(string phase, string outcome, int? exitCode, string code) { diagnostics.Add(phase + ":" + outcome); },
            delegate(string phase, long elapsedMs) { diagnostics.Add("TIMING:" + phase + ":" + elapsedMs); });
    }

    private static int Main()
    {
        var success = new FakeDevice(); var diagnostics = new List<string>();
        SepSdkResult result = Run(success, true, diagnostics);
        Check(result != null && result.ResponseCode == "00");
        Check(String.Join(",", success.Calls.ToArray()) == "SetLan:192.168.1.101,Initialization,PcStarterPurchase,Dispose");
        Check(!success.Calls.Contains("ConnectionTest") && diagnostics.Contains("PURCHASE_CALL:RETURNED_RESULT"));

        var wrongTerminal = new FakeDevice { PurchaseResult = new SepSdkResult { ResponseCode = "00", TerminalId = "31187711" } };
        diagnostics.Clear(); Check(Run(wrongTerminal, true, diagnostics) == null);
        Check(wrongTerminal.Calls.Contains("PcStarterPurchase") && wrongTerminal.Calls[wrongTerminal.Calls.Count - 1] == "Dispose");

        var offline = new FakeDevice { PurchaseResult = new SepSdkResult { ResponseCode = "03", TerminalId = "31187710" } };
        diagnostics.Clear(); Check(Run(offline, true, diagnostics).ResponseCode == "03");
        Check(!offline.Calls.Contains("ConnectionTest") && diagnostics.Contains("PURCHASE_CALL:RETURNED_RESULT"));

        var expired = new FakeDevice(); diagnostics.Clear(); Check(Run(expired, false, diagnostics) == null);
        Check(!expired.Calls.Contains("PcStarterPurchase") && diagnostics.Contains("INTENT_EXPIRY:EXPIRED_BEFORE_PURCHASE"));

        var reconnectFailure = new FakeDevice { RejectSetLanCall = 1 }; diagnostics.Clear(); Check(Run(reconnectFailure, true, diagnostics) == null);
        Check(!reconnectFailure.Calls.Contains("PcStarterPurchase") && diagnostics.Contains("SET_LAN:REJECTED"));
        Console.WriteLine("Purchase SDK lifecycle passed: direct purchase without connection test, terminal mismatch, offline response, expired intent, setup failure.");
        return 0;
    }
}
