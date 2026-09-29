import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["*.e2b.app"],
  reactStrictMode: false,
  // Playwright (captures d'écran du navigateur de NEXUS) : package serveur externe,
  // ne doit PAS être bundlé par Next (binaires + workers dynamiques).
  // imapflow (lecture IMAP réelle de la boîte Gmail connectée) : idem — le
  // bundling casse ses connexions TLS (timeout en dev, testé en réel).
  serverExternalPackages: ["playwright", "imapflow"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
