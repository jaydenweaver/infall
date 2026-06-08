import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  webpack(config) {
    // Enable async WebAssembly — required for wasm-pack bundler-target output
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };
    return config;
  },
};

export default nextConfig;
