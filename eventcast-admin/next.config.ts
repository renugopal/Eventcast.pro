import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  productionBrowserSourceMaps: false,
  // eslint and typescript options suppress build warnings
  ...(({ eslint: { ignoreDuringBuilds: true }, typescript: { ignoreBuildErrors: true } }) as any),
};

export default nextConfig;
