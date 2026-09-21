import type { NextConfig } from "next";

const apiBaseUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:3001";
const releaseId = process.env.POS_RELEASE_ID?.trim() || "development";

const nextConfig: NextConfig = {
  output: "standalone",
  basePath: "/pos",
  poweredByHeader: false,
  agentRules: false,
  env: {
    NEXT_PUBLIC_POS_RELEASE_ID: releaseId,
  },
  generateBuildId: async () => releaseId,
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.*", "10.*", "172.16.*"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiBaseUrl}/api/:path*`,
      },
    ];
  },
  experimental: {
    useTypeScriptCli: false,
  },
};

export default nextConfig;
