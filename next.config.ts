import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  serverExternalPackages: ['node-pty'],
  allowedDevOrigins: [
    '127.0.0.1',
    'localhost',
    '0.0.0.0',
    '21.0.15.126',
  ],
};

export default nextConfig;
