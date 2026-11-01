using System;
using System.Collections.Generic;
using System.Configuration;
using System.Globalization;
using System.IO;
using System.Runtime.CompilerServices;
using System.Security;
using System.Security.Cryptography;
using System.Threading;
using SSP1126.PcPos.BaseClasses;
using SSP1126.PcPos.Infrastructure;

[assembly: System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.8")]
[assembly: System.Reflection.AssemblyVersion("0.2.4.0")]

namespace RunCafe.SepBridge.Payments
{
    internal static class PurchaseWorker
    {
        private static string currentPhase = "WORKER_START";
        private static int Main(string[] args)
        {
            string path = null;
            try
            {
                if (args.Length != 2 || args[0] != "--purchase") return 2;
                string root = ConfigurationManager.AppSettings["DataDirectory"];
                root = String.IsNullOrEmpty(root) ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RunCafe", "SepBridge.Payments") : root;
                string journal = Path.Combine(Path.GetFullPath(root), "attempts");
                path = Path.GetFullPath(args[1]);
                if (Path.GetDirectoryName(path) != journal || !path.EndsWith(".intent.json", StringComparison.Ordinal)) return 2;
                if (ConfigurationManager.AppSettings["PaymentsEnabled"] != "true" ||
                    ConfigurationManager.AppSettings["LogPermission"] != "0" || Environment.OSVersion.Platform != PlatformID.Win32NT || Environment.Is64BitProcess)
                { Record(path, "WORKER_GUARD", "REJECTED", 2); return 2; }
                Record(path, "INTENT_VALIDATION", "STARTED");
                var intent = PaymentProtocol.Parse(File.ReadAllText(path));
                byte[] key = PaymentProtocol.LoadKey(root);
                PaymentProtocol.ValidateIntent(intent, key, ConfigurationManager.AppSettings["BridgeId"], ConfigurationManager.AppSettings["ExpectedTerminalId"], true);
                Record(path, "INTENT_VALIDATION", "PASSED");
                PaymentProtocol.DurableCreate(path + ".worker-started", "{}");
                using (var gate = new Mutex(false, "Global\\RunCafe.SepDiagnostic." + ConfigurationManager.AppSettings["ExpectedTerminalId"]))
                {
                    bool owns = false;
                    try
                    {
                        Record(path, "DEVICE_MUTEX", "WAITING");
                        try { owns = gate.WaitOne(0); } catch (AbandonedMutexException) { owns = true; }
                        if (!owns) { Record(path, "DEVICE_MUTEX", "BUSY", 3); return 3; }
                        Record(path, "DEVICE_MUTEX", "ACQUIRED");
                        // Redeem from inside this single-use worker. A lost acknowledgment never reaches SDK construction.
                        Record(path, "BACKEND_CLAIM", "REQUESTED");
                        var backend = new BackendClient(ConfigurationManager.AppSettings["BackendUrl"], key);
                        if (!backend.Claim(intent)) { Record(path, "BACKEND_CLAIM", "REJECTED", 1); return 1; }
                        Record(path, "BACKEND_CLAIM", "ACCEPTED");
                        return Purchase(intent, path);
                    }
                    finally { if (owns) gate.ReleaseMutex(); }
                }
            }
            catch (Exception)
            {
                if (path != null) { try { Record(path, currentPhase, "EXCEPTION", 1); } catch (Exception) { } }
                return 1; // Never print vendor objects, exception messages, PAN, or raw protocol.
            }
        }
        [MethodImpl(MethodImplOptions.NoInlining)]
        private static int Purchase(Dictionary<string, object> intent, string path)
        {
            Record(path, "SDK_HASHES", "CHECKING");
            RequireHash(typeof(PcPosFactory).Assembly.Location, "b1785db76f5b7748dc4cc59895f11a41d34542808fc61a317c175f4f0f821ffa");
            RequireHash(typeof(Sep.Logger.Constants).Assembly.Location, "19327d291e42d9adaf6905d80fe6aadfe1d255fb5b8d2e447d420bada5d52aa9");
            Record(path, "SDK_HASHES", "PASSED");
            if (Sep.Logger.Constants.logPermission != 0) { Record(path, "VENDOR_LOGGING", "ENABLED", 1); return 1; }
            Record(path, "SDK_FACTORY", "CREATING");
            var result = PurchaseLifecycle.Execute(new OfficialSepPurchaseDevice(),
                ConfigurationManager.AppSettings["TerminalIp"], (string)intent["terminalId"],
                SepAmount.TomanToRial(PaymentProtocol.Number(intent, "cardAmount", Int32.MaxValue)),
                delegate { return PaymentProtocol.Number(intent, "expiresAtUnix", 9007199254740991) > PaymentProtocol.Now(); },
                delegate(string phase, string outcome, int? exitCode, string responseCode) { Record(path, phase, outcome, exitCode, responseCode); });
            if (result == null) return 1;
            Dictionary<string, object> evidence = new Dictionary<string, object> {
                { "terminalId", result.TerminalId }, { "responseCode", PaymentProtocol.SafeCode(result.ResponseCode) },
                { "rrn", PaymentProtocol.SafeReference(result.Rrn) }, { "trace", PaymentProtocol.SafeReference(result.Trace) }
            };
            Record(path, "WORKER_RESULT", "EMITTED");
            Console.WriteLine(PaymentProtocol.Json.Serialize(evidence)); return 0;
        }
        private static void Record(string path, string phase, string outcome, int? exitCode = null, string responseCode = null)
        {
            currentPhase = phase;
            PaymentProtocol.AppendDiagnostic(path, phase, outcome, exitCode, responseCode);
        }
        private static void RequireHash(string path, string expected)
        {
            using (var stream = File.OpenRead(path)) using (var hash = SHA256.Create())
                if (BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant() != expected) throw new SecurityException();
        }

        private sealed class OfficialSepPurchaseDevice : ISepPurchaseDevice
        {
            private readonly PcPosFactory factory = new PcPosFactory();
            public bool SetLan(string ip) { return factory.SetLan(ip); }
            public void Initialize() { factory.Initialization(ResponseLanguage.English, 10, AsyncType.Sync); }
            public SepSdkResult ConnectionTest() { return Convert(factory.ConnectionTest()); }
            public SepSdkResult Purchase(string amount, string terminalId)
            {
                // Exact managed ten-argument signature; unused extensions stay at their verified defaults.
                return Convert(factory.PcStarterPurchase(amount, null, null, null, terminalId, null, null, -1, null, -1L));
            }
            public void Dispose() { factory.Dispose(); } // SDK cleanup can perform network activity.
            private static SepSdkResult Convert(IPosResult result)
            {
                if (result == null) return null;
                return new SepSdkResult { ResponseCode = result.ResponseCode, TerminalId = result.TerminalId, Rrn = result.RRN, Trace = result.TraceNumber };
            }
        }
    }
}
