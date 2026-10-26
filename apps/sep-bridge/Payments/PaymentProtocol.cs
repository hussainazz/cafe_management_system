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
    }
}
