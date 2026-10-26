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
                    if (!process.WaitForExit(5000)) throw new IOException();
                    return null; // Killing a worker never proves the bank declined the payment.
                }
                process.WaitForExit();
                lock (outputGate)
                {
                    if (overflow || process.ExitCode != 0 || output.Length == 0) return null;
                    var result = PaymentProtocol.Parse(output.ToString());
                    if (result.Count != 4) return null;
                    return result;
                }
            }
        }
    }
}
