/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    // Handle worker files - use Next.js built-in worker support
    if (!isServer) {
      config.module.rules.push({
        test: /\.worker\.(js|ts)$/,
        type: 'asset/resource',
        generator: {
          filename: 'static/worker/[hash].worker.js',
        },
      });
    }
    
    return config;
  },
  experimental: {
    webpackBuildWorker: true,
  },
};

module.exports = nextConfig;