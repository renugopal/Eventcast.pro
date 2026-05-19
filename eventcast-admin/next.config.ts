import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  productionBrowserSourceMaps: false,
  // 🚀 Tree-shake heavy libraries like lucide-react to massively reduce Cloudflare Worker size
  experimental: {
    optimizePackageImports: ["lucide-react"]
  },
  // eslint and typescript options suppress build warnings
  ...(({ eslint: { ignoreDuringBuilds: true }, typescript: { ignoreBuildErrors: true } }) as any),
};

export default nextConfig;
