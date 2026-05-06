import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * Server Actions CSRF fix (Next.js 15+).
   *
   * Next.js 15 validates the `Origin` header against `Host` for every
   * Server Action POST. Mobile in-app browsers (Instagram, Facebook,
   * WhatsApp, banking apps, etc.) and some proxies send Origin headers
   * that don't match the Host, causing "Invalid Server Actions request".
   *
   * List every domain that legitimately serves this app.
   */
  experimental: {
    serverActions: {
      allowedOrigins: [
        "localhost:3000",
        "saturnlub.app",
        "www.saturnlub.app",
        "b9jwg9t4-3000.use2.devtunnels.ms",
        "www.b9jwg9t4-3000.use2.devtunnels.ms",
        // Add Vercel preview domains if applicable:
        // "*.vercel.app",
      ],
    },
  },
};

export default nextConfig;
