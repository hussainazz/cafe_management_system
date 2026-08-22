import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  agentRules: false,
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    // The repository uses the stable TypeScript compiler API. This also keeps
    // Next's production type pass aligned with the standalone typecheck script.
    useTypeScriptCli: false,
  },
};

export default nextConfig;
