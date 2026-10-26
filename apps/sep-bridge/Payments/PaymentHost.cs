using System;
using System.Collections.Generic;
using System.Configuration;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.Versioning;
using System.Text;
using System.Threading;

[assembly: TargetFramework(".NETFramework,Version=v4.8")]
[assembly: System.Reflection.AssemblyVersion("0.2.0.0")]

namespace RunCafe.SepBridge.Payments
{
    // SDK-free loopback host. Purchase execution is isolated in a separate worker.
    internal static class PaymentHost
    {
        private static PaymentEngine engine;
        private static bool paymentEnabled;
        private static string Health { get { return "{\"service\":\"run-cafe-sep-bridge\",\"version\":\"0.2.0\",\"mode\":\"payments\",\"paymentEnabled\":" + (paymentEnabled ? "true" : "false") + ",\"manualVerificationRequired\":true}"; } }
        private static readonly object LogLock = new object();
        private static readonly Semaphore Slots = new Semaphore(8, 8);
        private static string dataDirectory;
        private static string allowedOrigin;
        private static string expectedHost;
        private static TcpListener listener;
        private static volatile bool stopping;

        private static int Main()
        {
            try
            {
                int port;
                if (!Int32.TryParse(ConfigurationManager.AppSettings["Port"], out port) || port < 1024 || port > 65535)
                    return 2;
                allowedOrigin = ConfigurationManager.AppSettings["AllowedOrigin"];
                Uri origin;
                if (!Uri.TryCreate(allowedOrigin, UriKind.Absolute, out origin) || origin.Scheme != "https" ||
                    origin.GetLeftPart(UriPartial.Authority) != allowedOrigin || !String.IsNullOrEmpty(origin.UserInfo))
                    return 2;
                dataDirectory = ConfigurationManager.AppSettings["DataDirectory"];
                if (String.IsNullOrWhiteSpace(dataDirectory))
                    dataDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RunCafe", "SepBridge.Payments");
                dataDirectory = Path.GetFullPath(dataDirectory);
                Directory.CreateDirectory(dataDirectory);
                ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
                paymentEnabled = ConfigurationManager.AppSettings["PaymentsEnabled"] == "true";
                if (paymentEnabled)
                {
                    if (Environment.OSVersion.Platform != PlatformID.Win32NT || Environment.Is64BitProcess || ConfigurationManager.AppSettings["LogPermission"] != "0") return 2;
                    byte[] key = PaymentProtocol.LoadKey(dataDirectory);
                    engine = new PaymentEngine(Path.Combine(dataDirectory, "attempts"), ConfigurationManager.AppSettings["BridgeId"],
                        ConfigurationManager.AppSettings["ExpectedTerminalId"], key,
                        new BackendClient(ConfigurationManager.AppSettings["BackendUrl"], key),
                        new ProcessPurchaseWorker(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "RunCafe.SepBridge.PurchaseWorker.exe")));
                }
                using (var instance = new Mutex(false, "Global\\RunCafe.SepBridge.Payments.Host"))
                {
                    bool owns;
                    try { owns = instance.WaitOne(0); } catch (AbandonedMutexException) { owns = true; }
                    if (!owns) return 3;
                    try { return Serve(port); } finally { instance.ReleaseMutex(); }
                }
            }
            catch (Exception) { Log("startup_failed", 0); return 1; }
        }

        private static int Serve(int port)
        {
            try
            {
                expectedHost = "127.0.0.1:" + port.ToString(CultureInfo.InvariantCulture);
                // Socket-level binding, no HTTP.sys wildcard or global URL ACL.
                listener = new TcpListener(IPAddress.Loopback, port);
                listener.ExclusiveAddressUse = true;
                listener.Start(8);
                string stopFile = Path.Combine(dataDirectory, "stop.request");
                if (File.Exists(stopFile)) File.Delete(stopFile);
                using (var timer = new Timer(delegate
                {
                    if (!File.Exists(stopFile)) return;
                    stopping = true;
                    listener.Stop();
                }, null, 500, 500))
                {
                    Log("started", 0);
                    using (var delivery = new Timer(delegate { if (engine != null) engine.DeliverEvidence(); }, null, 1000, 15000))
                    {
                    while (!stopping)
                    {
                        TcpClient client;
                        try { client = listener.AcceptTcpClient(); }
                        catch (SocketException) { if (stopping) break; throw; }
                        catch (ObjectDisposedException) { if (stopping) break; throw; }
                        if (!Slots.WaitOne(0)) { client.Close(); continue; }
                        ThreadPool.QueueUserWorkItem(delegate
                        {
                            try { Handle(client); }
                            finally { client.Close(); Slots.Release(); }
                        });
                    }
                }
                }
                Log("stopped", 0);
                return 0;
            }
            catch (Exception)
            {
                // Never serialize arbitrary exception messages, request data, or SDK results.
                Log("startup_failed", 0);
                return 1;
            }
            finally { if (listener != null) listener.Stop(); }
        }

        private static void Handle(TcpClient client)
        {
            using (client)
            {
                try
                {
                    client.ReceiveTimeout = 2000;
                    client.SendTimeout = 2000;
                    var stream = client.GetStream();
                    // A fixed total deadline also bounds slow clients sending one byte at a time.
                    using (var deadline = new Timer(delegate { client.Close(); }, null, 4000, Timeout.Infinite))
                    {
                        int count = 0;
                        string first = Line(stream, ref count);
                        string[] request = first.Split(' ');
                        if (request.Length != 3 || request[2] != "HTTP/1.1") { Reply(stream, 400, false, false); return; }
                        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                        string line;
                        while ((line = Line(stream, ref count)).Length > 0)
                        {
                            int colon = line.IndexOf(':');
                            if (colon < 1 || headers.Count >= 32) { Reply(stream, 400, false, false); return; }
                            string name = line.Substring(0, colon);
                            foreach (char c in name)
                                if (!(Char.IsLetterOrDigit(c) || "!#$%&'*+-.^_`|~".IndexOf(c) >= 0))
                                { Reply(stream, 400, false, false); return; }
                            if (headers.ContainsKey(name)) { Reply(stream, 400, false, false); return; }
                            headers.Add(name, line.Substring(colon + 1).Trim());
                        }
                        string host, origin, length;
                        if (!headers.TryGetValue("Host", out host) || host != expectedHost ||
                            headers.ContainsKey("Transfer-Encoding") || headers.ContainsKey("Expect"))
                        { Reply(stream, 400, false, false); return; }
                        bool hasOrigin = headers.TryGetValue("Origin", out origin);
                        bool allowed = hasOrigin && origin == allowedOrigin;
                        if (hasOrigin && !allowed) { Reply(stream, 403, false, false); return; }
                        bool paymentRoute = request[1] == "/payments" || request[1] == "/status";
                        if (request[1] != "/health" && !paymentRoute) { Reply(stream, 404, allowed, false); return; }
                        if (request[0] == "OPTIONS")
                        {
                            string method, requestedHeaders;
                            if (!allowed || !headers.TryGetValue("Access-Control-Request-Method", out method) || (paymentRoute ? method != "POST" : method != "GET"))
                            { Reply(stream, 403, false, false); return; }
                            if (headers.TryGetValue("Access-Control-Request-Headers", out requestedHeaders) &&
                                !String.Equals(requestedHeaders.Trim(), paymentRoute ? "content-type" : "x-run-cafe-diagnostic", StringComparison.OrdinalIgnoreCase))
                            { Reply(stream, 403, false, false); return; }
                            Reply(stream, 204, true, true);
                        }
                        else if (paymentRoute)
                        {
                            string contentType; int bodyLength;
                            if (!allowed) { Reply(stream, 403, false, false); return; }
                            if (request[0] != "POST") { Reply(stream, 405, allowed, false); return; }
                            if (!headers.TryGetValue("Content-Type", out contentType) || contentType != "application/json" ||
                                !headers.TryGetValue("Content-Length", out length) || !Int32.TryParse(length, out bodyLength) || bodyLength < 1 || bodyLength > 4096)
                            { Reply(stream, 400, allowed, false); return; }
                            if (engine == null) { Reply(stream, 503, allowed, false); return; }
                            var bytes = new byte[bodyLength]; int offset = 0;
                            while (offset < bodyLength) { int read = stream.Read(bytes, offset, bodyLength - offset); if (read < 1) throw new IOException(); offset += read; }
                            try
                            {
                                var intent = PaymentProtocol.Parse(new UTF8Encoding(false, true).GetString(bytes));
                                var result = request[1] == "/payments" ? engine.Start(intent) : engine.Status(intent);
                                Reply(stream, 200, allowed, false, PaymentProtocol.Json.Serialize(result));
                            }
                            catch (System.Security.SecurityException) { Reply(stream, 403, allowed, false); }
                            catch (InvalidOperationException) { Reply(stream, 409, allowed, false); }
                            catch (FileNotFoundException) { Reply(stream, 404, allowed, false); }
                            catch (Exception) { Reply(stream, 400, allowed, false); }
                        }
                        else if (headers.TryGetValue("Content-Length", out length) && length != "0") Reply(stream, 400, allowed, false);
                        else if (request[0] == "GET") Reply(stream, 200, allowed, false);
                        else Reply(stream, 405, allowed, false);
                    }
                }
                catch (Exception) { Log("request_incomplete", 0); }
            }
        }

        // Bounded HTTP subset, one request per connection, no chunking or raw input logs.
        private static string Line(Stream stream, ref int count)
        {
            var line = new StringBuilder();
            while (true)
            {
                int value = stream.ReadByte();
                if (++count > 8192 || value < 0) throw new IOException();
                if (value == 13)
                {
                    if (++count > 8192 || stream.ReadByte() != 10) throw new IOException();
                    return line.ToString();
                }
                if (value < 32 || value > 126) throw new IOException();
                line.Append((char)value);
            }
        }

        private static void Reply(Stream stream, int status, bool cors, bool preflight, string responseBody = null)
        {
            string reason = status == 200 ? "OK" : status == 204 ? "No Content" : status == 400 ? "Bad Request" :
                status == 403 ? "Forbidden" : status == 404 ? "Not Found" : "Method Not Allowed";
            string body = responseBody ?? (status == 200 ? Health : status == 204 ? "" : "{\"error\":\"request_rejected\"}");
            var response = new StringBuilder("HTTP/1.1 " + status + " " + reason + "\r\n");
            response.Append("Connection: close\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n");
            response.Append("Vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers\r\n");
            if (cors) response.Append("Access-Control-Allow-Origin: " + allowedOrigin + "\r\n");
            if (preflight) response.Append("Access-Control-Allow-Methods: GET, POST\r\nAccess-Control-Allow-Headers: content-type, x-run-cafe-diagnostic\r\nAccess-Control-Max-Age: 0\r\n");
            if (status == 405) response.Append("Allow: GET, POST, OPTIONS\r\n");
            response.Append("Content-Length: " + Encoding.UTF8.GetByteCount(body) + "\r\n\r\n" + body);
            byte[] bytes = Encoding.UTF8.GetBytes(response.ToString());
            stream.Write(bytes, 0, bytes.Length);
            Log("http_response", status);
        }

        private static void Log(string name, int status)
        {
            if (dataDirectory == null) return;
            lock (LogLock)
            {
                try
                {
                    string path = Path.Combine(dataDirectory, "bridge.jsonl");
                    if (File.Exists(path) && new FileInfo(path).Length >= 262144)
                    {
                        if (File.Exists(path + ".2")) File.Delete(path + ".2");
                        if (File.Exists(path + ".1")) File.Move(path + ".1", path + ".2");
                        File.Move(path, path + ".1");
                    }
                    File.AppendAllText(path, "{\"utc\":\"" + DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) +
                        "\",\"event\":\"" + name + "\",\"status\":" + status.ToString(CultureInfo.InvariantCulture) + "}\n");
                }
                catch (Exception) { /* Health remains available if diagnostic logging fails. */ }
            }
        }
    }
}
