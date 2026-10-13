import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";

// Polices 100 % LOCALES (pile système) : NEXUS se construit et se lance sans
// aucun accès à Internet. Aucun téléchargement depuis Google Fonts au build.

export const metadata: Metadata = {
  title: "NEXUS — Votre Agent IA tout-en-un",
  description:
    "NEXUS est un agent IA autonome : recherche web, génération d'images, scènes 3D, retouche photo et vidéo, et atelier de code. Tout-en-un, dans tous les domaines.",
  keywords: ["NEXUS", "Agent IA", "IA autonome", "3D", "génération d'images", "retouche vidéo", "atelier code"],
};

export const viewport: Viewport = {
  themeColor: "#09090b",
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
