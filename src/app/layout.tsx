import type { Metadata, Viewport } from "next";
import "./globals.css";
// Polices variables bundled localement (@fontsource) : identité visuelle forte
// SANS aucune requête réseau au build ni au runtime (NEXUS reste 100 % local).
import "@fontsource-variable/inter";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "NEXUS — L'agent IA qui vit chez vous",
  description:
    "NEXUS est un agent IA autonome 100 % local : recherche web, génération d'images, scènes 3D, retouche photo et vidéo, atelier de code. Vos données ne quittent jamais votre machine.",
  keywords: ["NEXUS", "Agent IA", "IA locale", "IA autonome", "3D", "génération d'images", "atelier code"],
};

export const viewport: Viewport = {
  themeColor: "#0a0e13",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" className="dark" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
