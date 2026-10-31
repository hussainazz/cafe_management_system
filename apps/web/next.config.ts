import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  agentRules: false,
  headers: () => Promise.resolve([
      {
        source: "/items_pictures/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ]),
  // Allow phone testing from the private LAN ranges commonly used by Wi-Fi routers.
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    "192.168.*.*",
    "10.*.*.*",
    "172.16.*.*",
  ],
  experimental: {
    // The repository uses the stable TypeScript compiler API. This also keeps
    // Next's production type pass aligned with the standalone typecheck script.
    useTypeScriptCli: false,
  },
};

export default nextConfig;
