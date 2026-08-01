import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['@huggingface/transformers'],
  allowedDevOrigins: ['*.trycloudflare.com', '192.168.1.200'],
};

export default nextConfig;