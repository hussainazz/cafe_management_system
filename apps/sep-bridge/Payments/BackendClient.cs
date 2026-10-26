using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;

namespace RunCafe.SepBridge.Payments
{
    internal sealed class BackendClient : IPaymentBackend
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
            result["sentAtUnix"] = PaymentProtocol.Now();
            string message = PaymentProtocol.Message("sep-result-v1", result["attemptId"], result["bridgeId"], result["terminalId"], result["sentAtUnix"], result["finishedAtUnix"], result["responseCode"], result["rrn"], result["trace"]);
            return Post("terminal-payments/result", result, message, false);
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
