using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;

namespace RunCafe.SepBridge.Payments
{
    internal sealed class BackendClient : IPaymentBackend, ITimingBackend
    {
        private readonly Uri endpoint;
        private readonly byte[] key;
        public BackendClient(string endpoint, byte[] key)
        {
            this.endpoint = new Uri(endpoint);
            if (this.endpoint.AbsoluteUri != "https://runncafe.ir/pos/api/v1/") throw new InvalidOperationException();
            this.key = key;
        }
        public bool Claim(Dictionary<string, object> intent)
        {
            long now = PaymentProtocol.Now();
            var body = new Dictionary<string, object> { { "attemptId", intent["attemptId"] }, { "bridgeId", intent["bridgeId"] }, { "nonce", intent["nonce"] }, { "sentAtUnix", now } };
            string message = PaymentProtocol.Message("sep-claim-v1", body["attemptId"], body["bridgeId"], body["nonce"], now);
            return Post("terminal-payments/claim", body, message, true);
        }
        public bool Report(Dictionary<string, object> result)
        {
            // Financial wire format stays byte-for-byte compatible with 0.2.4.
            var body = PaymentProtocol.FinancialResult(result, PaymentProtocol.Now());
            return Post("terminal-payments/result", body, PaymentProtocol.ResultMessage(body), false);
        }
        public bool ReportTiming(Dictionary<string, object> result)
        {
            object timings;
            if (!result.TryGetValue("timingsMs", out timings)) return true; // Legacy journal has no telemetry.
            var body = new Dictionary<string, object> { { "attemptId", result["attemptId"] }, { "bridgeId", result["bridgeId"] },
                { "terminalId", result["terminalId"] }, { "sentAtUnix", PaymentProtocol.Now() }, { "timingsMs", timings } };
            string message = PaymentProtocol.TimingReportMessage(body);
            return Post("terminal-payments/timing", body, message, false);
        }
        private bool Post(string path, Dictionary<string, object> body, string message, bool claim)
        {
            try
            {
                var request = (HttpWebRequest)WebRequest.Create(new Uri(endpoint, path));
                request.Method = "POST"; request.ContentType = "application/json";
                request.Proxy = null; request.AllowAutoRedirect = false; request.Timeout = 8000; request.ReadWriteTimeout = 8000;
                request.KeepAlive = false; request.Headers["x-sep-signature"] = PaymentProtocol.Sign(message, key);
                byte[] bytes = Encoding.UTF8.GetBytes(PaymentProtocol.Json.Serialize(body)); request.ContentLength = bytes.Length;
                using (var stream = request.GetRequestStream()) stream.Write(bytes, 0, bytes.Length);
                using (var response = (HttpWebResponse)request.GetResponse())
                using (var stream = response.GetResponseStream())
                {
                    if (response.StatusCode != HttpStatusCode.OK) return false;
                    var buffer = new byte[16385]; int count = 0, read;
                    while ((read = stream.Read(buffer, count, buffer.Length - count)) > 0) { count += read; if (count == buffer.Length) return false; }
                    var envelope = PaymentProtocol.Parse(Encoding.UTF8.GetString(buffer, 0, count));
                    object value; if (!envelope.TryGetValue("data", out value)) return false;
                    var attempt = value as Dictionary<string, object>;
                    if (attempt == null || PaymentProtocol.Text(attempt, "id") != (string)body["attemptId"] || PaymentProtocol.Text(attempt, "bridgeId") != (string)body["bridgeId"]) return false;
                    if (claim && (PaymentProtocol.Text(attempt, "status") != "PENDING" || PaymentProtocol.Text(attempt, "dispatchedAt") == null ||
                        PaymentProtocol.Text(attempt, "terminalId") == null)) return false;
                    return true;
                }
            }
            catch (Exception) { return false; }
        }
    }
}
