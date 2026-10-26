using System;
using System.Configuration;
using System.IO;
using System.Runtime.CompilerServices;
using System.Security;
using System.Security.Cryptography;
using SSP1126.PcPos.BaseClasses;
using SSP1126.PcPos.Infrastructure;

namespace RunCafe.SepBridge.Diagnostics
{
    // Compile-only until a separately approved, isolated diagnostic host exists.
    // This file is not part of the installed health executable/project/package.
    public sealed class OfficialSepDiagnosticDevice : ISepDiagnosticDevice
    {
        private readonly PcPosFactory factory;
        private OfficialSepDiagnosticDevice() { factory = new PcPosFactory(); }

        public static ISepDiagnosticDevice Create()
        {
            if (ConfigurationManager.AppSettings["SepDiagnosticsEnabled"] != "true" ||
                ConfigurationManager.AppSettings["LogPermission"] != "0")
                throw new SecurityException("Explicit diagnostics enablement and disabled vendor logging are required.");
            if (Environment.OSVersion.Platform != PlatformID.Win32NT || Environment.Is64BitProcess)
                throw new PlatformNotSupportedException("The diagnostic host must run as Windows x86.");
            return CreateVerified();
        }

        [MethodImpl(MethodImplOptions.NoInlining)]
        private static ISepDiagnosticDevice CreateVerified()
        {
            // Check actual resolved assemblies, including GAC/probing outcomes, before constructing SDK objects.
            RequireHash(typeof(PcPosFactory).Assembly.Location, "b1785db76f5b7748dc4cc59895f11a41d34542808fc61a317c175f4f0f821ffa");
            RequireHash(typeof(Sep.Logger.Constants).Assembly.Location, "19327d291e42d9adaf6905d80fe6aadfe1d255fb5b8d2e447d420bada5d52aa9");
            if (Sep.Logger.Constants.logPermission != 0)
                throw new SecurityException("Vendor logging did not honor the disabled setting.");
            return new OfficialSepDiagnosticDevice();
        }

        private static void RequireHash(string path, string expected)
        {
            using (var stream = File.OpenRead(path))
            using (var hash = SHA256.Create())
            {
                string actual = BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
                if (actual != expected) throw new SecurityException("SEP package checksum mismatch.");
            }
        }

        public bool SetLan(string ip) { return factory.SetLan(ip); }
        public void InitializeEnglishSync(int timeoutSeconds)
        {
            factory.Initialization(ResponseLanguage.English, timeoutSeconds, AsyncType.Sync);
        }
        public SepConnectionResponse ConnectionTest()
        {
            IPosResult result = factory.ConnectionTest();
            // Never call ToString/serialize the vendor result, description, or exception.
            return result == null ? null : new SepConnectionResponse(result.ResponseCode, result.TerminalId);
        }
        public void Dispose() { factory.Dispose(); }
    }
}
