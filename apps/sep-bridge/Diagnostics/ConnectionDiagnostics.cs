using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text.RegularExpressions;
using System.Threading;

namespace RunCafe.SepBridge.Diagnostics
{
    public enum ConnectionOutcome { Connected, TerminalUnavailable, TerminalMismatch, ProtocolError, Busy }

    // This interface deliberately cannot purchase, poll a payment, print, or refund.
    public interface ISepDiagnosticDevice
    {
        bool SetLan(string ip);
        void InitializeEnglishSync(int timeoutSeconds);
        SepConnectionResponse ConnectionTest();
        void Dispose();
    }

    public sealed class SepConnectionResponse
    {
        public readonly string ResponseCode;
        public readonly string TerminalId;
        public SepConnectionResponse(string code, string terminalId) { ResponseCode = code; TerminalId = terminalId; }
    }

    public sealed class ConnectionDiagnosticResult
    {
        public ConnectionOutcome Outcome { get; internal set; }
        public string ResponseCode { get; internal set; }
        public string TerminalId { get; internal set; }
        public bool CleanupFailed { get; internal set; }
    }

    public sealed class ConnectionDiagnostics
    {
        // Covers all instances in this process, through completion of cleanup.
        private static readonly object DeviceGate = new object();
        private readonly Func<ISepDiagnosticDevice> createDevice;
        private readonly string ip;
        private readonly string terminalId;

        public ConnectionDiagnostics(Func<ISepDiagnosticDevice> createDevice, string ip, string terminalId)
        {
            IPAddress parsed;
            if (createDevice == null) throw new ArgumentNullException("createDevice");
            if (!IPAddress.TryParse(ip, out parsed) || parsed.AddressFamily != AddressFamily.InterNetwork || parsed.ToString() != ip)
                throw new ArgumentException("A canonical IPv4 terminal address is required.");
            if (terminalId == null || !Regex.IsMatch(terminalId, "\\A[0-9]{8}\\z"))
                throw new ArgumentException("An eight-digit expected terminal identity is required.");
            this.createDevice = createDevice;
            this.ip = ip;
            this.terminalId = terminalId;
        }

        public ConnectionDiagnosticResult Run()
        {
            if (!Monitor.TryEnter(DeviceGate)) return new ConnectionDiagnosticResult { Outcome = ConnectionOutcome.Busy };
            ISepDiagnosticDevice device = null;
            var result = new ConnectionDiagnosticResult { Outcome = ConnectionOutcome.ProtocolError };
            try
            {
                device = createDevice();
                if (device != null && device.SetLan(ip))
                {
                    // SetLan must precede Initialization. No retry, alternate IP, or COM fallback.
                    device.InitializeEnglishSync(10);
                    SepConnectionResponse response = device.ConnectionTest();
                    if (response != null)
                    {
                        result.ResponseCode = response.ResponseCode != null && Regex.IsMatch(response.ResponseCode, "\\A[0-9A-Z]{2,3}\\z") ? response.ResponseCode : null;
                        result.TerminalId = response.TerminalId != null && Regex.IsMatch(response.TerminalId, "\\A[0-9]{8}\\z") ? response.TerminalId : null;
                        if (result.ResponseCode == "00" && result.TerminalId != null)
                            result.Outcome = result.TerminalId == terminalId ? ConnectionOutcome.Connected : ConnectionOutcome.TerminalMismatch;
                        else if (result.ResponseCode == "03" || result.ResponseCode == "99")
                            result.Outcome = ConnectionOutcome.TerminalUnavailable;
                    }
                }
            }
            catch (SocketException) { result.Outcome = ConnectionOutcome.TerminalUnavailable; }
            catch (TimeoutException) { result.Outcome = ConnectionOutcome.TerminalUnavailable; }
            catch (IOException) { result.Outcome = ConnectionOutcome.TerminalUnavailable; }
            catch (Exception) { result.Outcome = ConnectionOutcome.ProtocolError; }
            finally
            {
                try
                {
                    if (device != null)
                    {
                        // Official Dispose can reconnect/send. The gate remains owned until it returns.
                        // This lifecycle is for explicit diagnostics only, never uncertain payments.
                        try { device.Dispose(); }
                        catch (Exception) { result.CleanupFailed = true; result.Outcome = ConnectionOutcome.ProtocolError; }
                    }
                }
                finally { Monitor.Exit(DeviceGate); }
            }
            return result;
        }
    }
}
