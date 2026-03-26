import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.jsdelivr.net",
        port: "",
      },
    ],
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  webpack: (config, { isServer }) => {
    // Always exclude native modules from webpack bundling
    config.externals = config.externals || [];
    if (Array.isArray(config.externals)) {
      config.externals.push('@picovoice/eagle-node');
    } else {
      config.externals = [config.externals, '@picovoice/eagle-node'];
    }
    
    // Ignore native modules
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      crypto: false,
    };
    
    return config;
  },
  // Ensure native modules are not bundled
  serverExternalPackages: ['@picovoice/eagle-node'],
};

export default nextConfig;
