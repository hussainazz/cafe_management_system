using System;
using System.Collections.Generic;
using System.Diagnostics;

namespace RunCafe.SepBridge.Payments
{
    internal sealed class SepSdkResult
    {
        public string ResponseCode;
        public string TerminalId;
        public string Rrn;
        public string Trace;
    }

    internal interface ISepPurchaseDevice : IDisposable
    {
        bool SetLan(string ip);
        void Initialize();
        SepSdkResult Purchase(string amount, string terminalId);
    }

    internal delegate void PurchaseDiagnostic(string phase, string outcome, int? exitCode, string responseCode);

    internal static class PurchaseLifecycle
    {
        public static SepSdkResult Execute(ISepPurchaseDevice device, string terminalIp, string terminalId,
            string amount, Func<bool> intentIsCurrent, PurchaseDiagnostic diagnostic, Action<string, long> timing)
        {
            if (device == null || intentIsCurrent == null || diagnostic == null || timing == null) throw new ArgumentNullException();
            try
            {
                diagnostic("SET_LAN", "CALLING", null, null);
                bool setLan = Measure("setLanMs", delegate { return device.SetLan(terminalIp); }, timing);
                if (!setLan) { diagnostic("SET_LAN", "REJECTED", 1, null); return null; }
                diagnostic("SET_LAN", "PASSED", null, null);

                diagnostic("SDK_INITIALIZATION", "CALLING", null, null);
                Measure("sdkInitializationMs", delegate { device.Initialize(); return true; }, timing);
                diagnostic("SDK_INITIALIZATION", "PASSED", null, null);

                if (!intentIsCurrent()) { diagnostic("INTENT_EXPIRY", "EXPIRED_BEFORE_PURCHASE", 1, null); return null; }

                diagnostic("PURCHASE_CALL", "ENTERING", null, null);
                SepSdkResult result = Measure("purchaseCallMs", delegate { timing("prePurchaseMs", 0); return device.Purchase(amount, terminalId); }, timing);
                if (result == null) { diagnostic("PURCHASE_CALL", "RETURNED_NO_RESULT", 1, null); return null; }
                if (result.TerminalId != terminalId) { diagnostic("PURCHASE_CALL", "RETURNED_TERMINAL_MISMATCH", 1, null); return null; }
                string purchaseCode = PaymentProtocol.SafeCode(result.ResponseCode);
                diagnostic("PURCHASE_CALL", "RETURNED_RESULT", null, purchaseCode);
                return result;
            }
            finally
            {
                try { diagnostic("SDK_CLEANUP", "CALLING", null, null); } catch (Exception) { }
                Measure("sdkCleanupMs", delegate { device.Dispose(); return true; }, timing);
                try { diagnostic("SDK_CLEANUP", "PASSED", null, null); } catch (Exception) { }
            }
        }
        private static T Measure<T>(string name, Func<T> action, Action<string, long> timing)
        {
            var watch = Stopwatch.StartNew();
            try { return action(); }
            finally { watch.Stop(); timing(name, watch.ElapsedMilliseconds); }
        }
    }
}
