using System;
using System.Configuration;
using System.Runtime.CompilerServices;
using System.Runtime.Versioning;
using System.Threading;

[assembly: TargetFramework(".NETFramework,Version=v4.8")]
[assembly: System.Reflection.AssemblyVersion("0.1.0.0")]

namespace RunCafe.SepBridge.Diagnostics
{
    // One explicitly authorized diagnostic per process. No payment entry point.
    internal static class DiagnosticWorker
    {
        private static int Main(string[] args)
        {
            try
            {
                if (args.Length != 1 || args[0] != "--connection-test") return Write("authorization-required", null, null, false, 2);
                if (ConfigurationManager.AppSettings["SepDiagnosticsEnabled"] != "true" || ConfigurationManager.AppSettings["LogPermission"] != "0")
                    return Write("disabled", null, null, false, 2);
                return RunDiagnostic();
            }
            catch (Exception) { return Write("configuration-or-worker-error", null, null, false, 1); }
        }

        [MethodImpl(MethodImplOptions.NoInlining)]
        private static int RunDiagnostic()
        {
            string identity = ConfigurationManager.AppSettings["ExpectedTerminalId"];
            var service = new ConnectionDiagnostics(OfficialSepDiagnosticDevice.Create,
                ConfigurationManager.AppSettings["TerminalIp"], identity);
            // The worker itself owns the cross-process lock, including all SDK cleanup.
            // A dead launcher cannot leave another worker free to overlap this one.
            using (var gate = new Mutex(false, "Global\\RunCafe.SepDiagnostic." + identity))
            {
                bool owns = false;
                try
                {
                    try { owns = gate.WaitOne(0); }
                    catch (AbandonedMutexException) { owns = true; }
                    if (!owns) return Write("Busy", null, null, false, 3);
                    ConnectionDiagnosticResult result = service.Run();
                    return Write(result.Outcome.ToString(), result.ResponseCode, result.TerminalId,
                        result.CleanupFailed, result.Outcome == ConnectionOutcome.Connected ? 0 : 1);
                }
                finally { if (owns) gate.ReleaseMutex(); }
            }
        }

        private static int Write(string status, string code, string identity, bool cleanupFailed, int exitCode)
        {
            // Only fixed status names and already-allowlisted SDK fields reach stdout.
            Console.WriteLine("{\"mode\":\"connection-diagnostic-only\",\"status\":\"" + status +
                "\",\"responseCode\":" + (code == null ? "null" : "\"" + code + "\"") +
                ",\"terminalId\":" + (identity == null ? "null" : "\"" + identity + "\"") +
                ",\"cleanupFailed\":" + (cleanupFailed ? "true" : "false") + ",\"paymentEnabled\":false}");
            return exitCode;
        }
    }
}
