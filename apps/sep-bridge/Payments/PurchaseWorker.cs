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
[assembly: System.Reflection.AssemblyVersion("0.2.0.0")]

namespace RunCafe.SepBridge.Payments
{
    internal static class PurchaseWorker
    {
        private static int Main(string[] args)
        {
            try
            {
                if (args.Length != 2 || args[0] != "--purchase" || ConfigurationManager.AppSettings["PaymentsEnabled"] != "true" ||
                    ConfigurationManager.AppSettings["LogPermission"] != "0" || Environment.OSVersion.Platform != PlatformID.Win32NT || Environment.Is64BitProcess) return 2;
                string root = ConfigurationManager.AppSettings["DataDirectory"];
                root = String.IsNullOrEmpty(root) ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RunCafe", "SepBridge.Payments") : root;
                string journal = Path.Combine(Path.GetFullPath(root), "attempts");
                string path = Path.GetFullPath(args[1]);
                if (Path.GetDirectoryName(path) != journal || !path.EndsWith(".intent.json", StringComparison.Ordinal)) return 2;
                var intent = PaymentProtocol.Parse(File.ReadAllText(path));
                byte[] key = PaymentProtocol.LoadKey(root);
                PaymentProtocol.ValidateIntent(intent, key, ConfigurationManager.AppSettings["BridgeId"], ConfigurationManager.AppSettings["ExpectedTerminalId"], true);
                PaymentProtocol.DurableCreate(path + ".worker-started", "{}");
                using (var gate = new Mutex(false, "Global\\RunCafe.SepDiagnostic." + ConfigurationManager.AppSettings["ExpectedTerminalId"]))
                {
                    bool owns = false;
                    try
                    {
                        try { owns = gate.WaitOne(0); } catch (AbandonedMutexException) { owns = true; }
                        if (!owns) return 3;
                        // Redeem from inside this single-use worker. A lost acknowledgment never reaches SDK construction.
                        var backend = new BackendClient(ConfigurationManager.AppSettings["BackendUrl"], key);
                        if (!backend.Claim(intent)) return 1;
                        return Purchase(intent);
                    }
                    finally { if (owns) gate.ReleaseMutex(); }
                }
            }
            catch (Exception) { return 1; } // Never print vendor objects, exceptions, PAN, or raw protocol.
        }
        [MethodImpl(MethodImplOptions.NoInlining)]
        private static int Purchase(Dictionary<string, object> intent)
        {
            RequireHash(typeof(PcPosFactory).Assembly.Location, "b1785db76f5b7748dc4cc59895f11a41d34542808fc61a317c175f4f0f821ffa");
            RequireHash(typeof(Sep.Logger.Constants).Assembly.Location, "19327d291e42d9adaf6905d80fe6aadfe1d255fb5b8d2e447d420bada5d52aa9");
            if (Sep.Logger.Constants.logPermission != 0) throw new SecurityException();
            Dictionary<string, object> evidence = null;
            var factory = new PcPosFactory();
            try
            {
                if (!factory.SetLan(ConfigurationManager.AppSettings["TerminalIp"])) return 1;
                factory.Initialization(ResponseLanguage.English, 10, AsyncType.Sync);
                IPosResult connection = factory.ConnectionTest();
                string terminal = (string)intent["terminalId"];
                if (connection == null || connection.ResponseCode != "00" || connection.TerminalId != terminal) return 1;
                // Recheck the time after a potentially slow connection test, before purchase initiation.
                if (PaymentProtocol.Number(intent, "expiresAtUnix", 9007199254740991) <= PaymentProtocol.Now()) return 1;
                // Exact managed ten-argument signature. No multi-account, print, purchase-ID or reserve extension.
                IPosResult result = factory.PcStarterPurchase(
                    Convert.ToString(intent["cardAmount"], CultureInfo.InvariantCulture),
                    null, null, null, terminal, null, null, -1, null, -1L);
                if (result != null && result.TerminalId == terminal) evidence = new Dictionary<string, object> {
                    { "terminalId", terminal }, { "responseCode", PaymentProtocol.SafeCode(result.ResponseCode) },
                    { "rrn", PaymentProtocol.SafeReference(result.RRN) }, { "trace", PaymentProtocol.SafeReference(result.TraceNumber) }
                };
            }
            finally { factory.Dispose(); } // May perform network activity. Parent keeps the deadline through cleanup.
            if (evidence == null) return 1;
            Console.WriteLine(PaymentProtocol.Json.Serialize(evidence)); return 0;
        }
        private static void RequireHash(string path, string expected)
        {
            using (var stream = File.OpenRead(path)) using (var hash = SHA256.Create())
                if (BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant() != expected) throw new SecurityException();
        }
    }
}
