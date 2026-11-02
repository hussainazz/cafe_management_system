using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;

namespace RunCafe.SepBridge.Payments
{
    internal sealed class ProcessPurchaseWorker : IPurchaseWorker
    {
        private readonly string executable;
        public ProcessPurchaseWorker(string executable) { this.executable = executable; }
        public Dictionary<string, object> Run(string path)
        {
            try
            {
                var start = new ProcessStartInfo(executable, "--purchase \"" + path + "\"") {
                    UseShellExecute = false, CreateNoWindow = true,
                    RedirectStandardOutput = true, RedirectStandardError = true,
                    WorkingDirectory = Path.GetDirectoryName(executable)
                };
                using (var process = Process.Start(start))
                {
                    // Worker emits one tiny sanitized result. Drain/discard any unexpected output with a cap.
                    var output = new System.Text.StringBuilder(); object outputGate = new object(); bool overflow = false;
                    process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) {
                        if (e.Data == null) return; lock (outputGate) { if (output.Length + e.Data.Length > 2048) overflow = true; else output.Append(e.Data); }
                    };
                    process.ErrorDataReceived += delegate { }; process.BeginOutputReadLine(); process.BeginErrorReadLine();
                    if (!process.WaitForExit(30000))
                    {
                        try { process.Kill(); } catch (Exception) { }
                        if (!process.WaitForExit(5000)) { Record(path, "WORKER_PROCESS", "DID_NOT_STOP"); throw new IOException(); }
                        Record(path, "WORKER_PROCESS", "TIMEOUT"); // Killing a worker never proves the bank declined the payment.
                        return null;
                    }
                    process.WaitForExit();
                    lock (outputGate)
                    {
                        if (process.ExitCode != 0) { Record(path, "WORKER_PROCESS", "NONZERO_EXIT", process.ExitCode); return null; }
                        if (overflow || output.Length == 0) { Record(path, "WORKER_PROCESS", "OUTPUT_INVALID", process.ExitCode); return null; }
                        Dictionary<string, object> result;
                        try { result = PaymentProtocol.Parse(output.ToString()); }
                        catch (Exception) { Record(path, "WORKER_PROCESS", "OUTPUT_INVALID", process.ExitCode); return null; }
                        object rawTimings;
                        if (result.Count != 5 || PaymentProtocol.Text(result, "terminalId") == null || !result.TryGetValue("timingsMs", out rawTimings) || !(rawTimings is Dictionary<string, object>))
                        { Record(path, "WORKER_PROCESS", "OUTPUT_INVALID", process.ExitCode); return null; }
                        PaymentProtocol.TimingMessage((Dictionary<string, object>)rawTimings);
                        Record(path, "WORKER_PROCESS", "EXITED", process.ExitCode);
                        return result;
                    }
                }
            }
            catch (Exception) { Record(path, "WORKER_PROCESS", "START_OR_HOST_EXCEPTION"); return null; }
        }
        private static void Record(string path, string phase, string outcome, int? exitCode = null)
        {
            try { PaymentProtocol.AppendDiagnostic(path, phase, outcome, exitCode); } catch (Exception) { }
        }
    }
}
