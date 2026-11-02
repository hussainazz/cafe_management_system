using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Security;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace RunCafe.SepBridge.Payments
{
    public static class PaymentProtocol
    {
        public static JavaScriptSerializer Json { get { return new JavaScriptSerializer { MaxJsonLength = 16384, RecursionLimit = 16 }; } }
        public static long Now() { return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalSeconds; }
        public static Dictionary<string, object> Parse(string json) { return Json.Deserialize<Dictionary<string, object>>(json); }
        public static string Text(Dictionary<string, object> value, string name) { object item; return value.TryGetValue(name, out item) && item is string ? (string)item : null; }
        public static string Match(string value, string pattern) { return value != null && Regex.IsMatch(value, "\\A(?:" + pattern + ")\\z", RegexOptions.CultureInvariant) ? value : null; }
        public static string Id(Dictionary<string, object> value, string name) { return Match(Text(value, name), "[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}"); }
        public static long Number(Dictionary<string, object> value, string name, long max)
        {
            object item; if (!value.TryGetValue(name, out item) || !(item is int || item is long || item is decimal)) throw new SecurityException();
            decimal number = Convert.ToDecimal(item, CultureInfo.InvariantCulture);
            if (number < 0 || number > max || Decimal.Truncate(number) != number) throw new SecurityException();
            return (long)number;
        }
        public static string Message(string purpose, params object[] fields)
        {
            var values = new List<string> { purpose };
            foreach (object field in fields) values.Add(Convert.ToString(field, CultureInfo.InvariantCulture));
            return String.Join("\n", values);
        }
        public static string Sign(string message, byte[] key)
        {
            using (var hmac = new HMACSHA256(key)) return BitConverter.ToString(hmac.ComputeHash(Encoding.UTF8.GetBytes(message))).Replace("-", "").ToLowerInvariant();
        }
        public static bool Equal(string left, string right)
        {
            if (left == null || right == null || left.Length != right.Length) return false;
            int diff = 0; for (int i = 0; i < left.Length; i++) diff |= left[i] ^ right[i]; return diff == 0;
        }
        public static string IntentMessage(Dictionary<string, object> intent)
        {
            string[] fields = { "attemptId", "bridgeId", "terminalId", "orderId", "orderVersion", "cardAmount", "unit", "checkoutHash", "nonce", "issuedAtUnix", "expiresAtUnix" };
            var values = new List<string> { "sep-intent-v1" };
            foreach (string field in fields) values.Add(Convert.ToString(intent[field], CultureInfo.InvariantCulture));
            return String.Join("\n", values);
        }
        public static void ValidateIntent(Dictionary<string, object> intent, byte[] key, string bridgeId, string terminalId, bool fresh)
        {
            if (intent == null || intent.Count != 12 || Id(intent, "attemptId") == null || Id(intent, "orderId") == null || Id(intent, "nonce") == null ||
                Id(intent, "bridgeId") != bridgeId || Text(intent, "terminalId") != terminalId || Text(intent, "unit") != "TOMAN" ||
                Match(Text(intent, "checkoutHash"), "[a-f0-9]{64}") == null || Match(Text(intent, "signature"), "[a-f0-9]{64}") == null ||
                Number(intent, "cardAmount", Int32.MaxValue) < 1 || Number(intent, "orderVersion", Int32.MaxValue) < 1) throw new SecurityException();
            long issued = Number(intent, "issuedAtUnix", 9007199254740991), expires = Number(intent, "expiresAtUnix", 9007199254740991);
            if (expires <= issued || expires - issued > 120 || (fresh && (issued > Now() + 30 || expires <= Now()))) throw new SecurityException();
            if (!Equal(Sign(IntentMessage(intent), key), Text(intent, "signature"))) throw new SecurityException();
        }
        public static void DurableCreate(string path, string json)
        {
            byte[] data = new UTF8Encoding(false, true).GetBytes(json);
            using (var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read, 4096, FileOptions.WriteThrough))
            { stream.Write(data, 0, data.Length); stream.Flush(true); }
        }
        public static byte[] LoadKey(string dataDirectory)
        {
            byte[] key = ProtectedData.Unprotect(File.ReadAllBytes(Path.Combine(dataDirectory, "pairing.dpapi")), null, DataProtectionScope.CurrentUser);
            if (key.Length != 32) throw new SecurityException(); return key;
        }
        public static string SafeCode(string value) { return Match(value, "[0-9A-Z]{2,3}"); }
        public static string SafeReference(string value) { return Match(value, "[0-9]{1,12}"); }
        public static void AppendDiagnostic(string intentPath, string phase, string outcome, int? exitCode = null, string responseCode = null, long? elapsedMs = null)
        {
            if (String.IsNullOrEmpty(intentPath) || Match(phase, "[A-Z0-9_]{1,48}") == null || Match(outcome, "[A-Z0-9_]{1,48}") == null ||
                (exitCode.HasValue && (exitCode.Value < 0 || exitCode.Value > 255)) || (elapsedMs.HasValue && (elapsedMs.Value < 0 || elapsedMs.Value > 86400000))) throw new SecurityException();
            string fullIntentPath = Path.GetFullPath(intentPath);
            if (!fullIntentPath.EndsWith(".intent.json", StringComparison.Ordinal)) throw new SecurityException();
            var record = new Dictionary<string, object> { { "schemaVersion", 1 }, { "bridgeVersion", "0.2.5" }, { "processId", System.Diagnostics.Process.GetCurrentProcess().Id }, { "timestampUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) }, { "phase", phase }, { "outcome", outcome } };
            if (exitCode.HasValue) record["exitCode"] = exitCode.Value;
            if (elapsedMs.HasValue) record["elapsedMs"] = elapsedMs.Value;
            string code = SafeCode(responseCode);
            if (code != null) record["responseCode"] = code;
            byte[] line = Encoding.UTF8.GetBytes(Json.Serialize(record) + "\n");
            string path = fullIntentPath + ".diagnostics.jsonl";
            using (var stream = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.Read, 4096, FileOptions.None))
            { stream.Write(line, 0, line.Length); }
        }
        public static Dictionary<string, object> FinancialResult(Dictionary<string, object> result, long sentAt)
        {
            var body = new Dictionary<string, object>();
            foreach (string field in new[] { "attemptId", "bridgeId", "terminalId", "finishedAtUnix", "responseCode", "rrn", "trace" }) body[field] = result[field];
            body["sentAtUnix"] = sentAt;
            return body;
        }
        public static string TimingReportMessage(Dictionary<string, object> body)
        {
            return Message("sep-timing-v1", body["attemptId"], body["bridgeId"], body["terminalId"], body["sentAtUnix"]) + "\n" + TimingMessage((Dictionary<string, object>)body["timingsMs"]);
        }
        public static string ResultMessage(Dictionary<string, object> result)
        {
            return Message("sep-result-v1", result["attemptId"], result["bridgeId"], result["terminalId"], result["sentAtUnix"], result["finishedAtUnix"], result["responseCode"], result["rrn"], result["trace"]);
        }
        public static string TimingMessage(Dictionary<string, object> timings)
        {
            if (timings == null) return "";
            string[] allowed = { "sdkFactoryMs", "prePurchaseMs", "diagnosticWriteMs", "backendClaimMs", "bridgeAcceptMs", "connectionTestMs", "deviceMutexMs", "dispatchQueueMs", "intentValidationMs", "purchaseCallMs", "purchaseReinitializationMs", "sdkCleanupMs", "sdkInitializationMs", "sdkVerificationMs", "setLanMs", "workerProcessMs", "workerTotalMs" };
            var values = new SortedDictionary<string, long>(StringComparer.Ordinal);
            foreach (var item in timings)
            {
                if (Array.IndexOf(allowed, item.Key) < 0 || !(item.Value is int || item.Value is long || item.Value is decimal)) throw new SecurityException();
                long duration = Number(timings, item.Key, 86400000);
                if (duration < 0 || duration > 86400000) throw new SecurityException();
                values.Add(item.Key, duration);
            }
            var parts = new List<string>();
            foreach (var item in values) parts.Add(item.Key + ":" + item.Value.ToString(CultureInfo.InvariantCulture));
            return String.Join(",", parts.ToArray());
        }
    }
}
