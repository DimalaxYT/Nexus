import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["*.e2b.app"],
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Playwright (captures d'écran du navigateur de NEXUS) : package serveur externe,
  // ne doit PAS être bundlé par Next (binaires + workers dynamiques).
  // imapflow (lecture IMAP réelle de la boîte Gmail connectée) : idem — le
  // bundling casse ses connexions TLS (timeout en dev, testé en réel).
  serverExternalPackages: ["playwright", "imapflow"],
};

export default nextConfig;
