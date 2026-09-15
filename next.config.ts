import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev server is reached through loopback and through forwarded preview
  // hosts. Without these, Next blocks /_next/* as cross-origin and the client
  // bundle never loads, which silently leaves the page server-rendered only.
  allowedDevOrigins: ["127.0.0.1", "localhost", "0.0.0.0", "*.cursor.sh", "*.trycloudflare.com"],
};

export default nextConfig;
