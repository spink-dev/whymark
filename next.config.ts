import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev server is reached through loopback and through forwarded preview
  // hosts. Without these, Next blocks /_next/* as cross-origin and the client
  // bundle never loads, which silently leaves the page server-rendered only.
  allowedDevOrigins: ["127.0.0.1", "localhost", "0.0.0.0", "*.cursor.sh", "*.trycloudflare.com"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
