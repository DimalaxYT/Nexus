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
    "NEXUS est un agent IA autonome 100 % local : recherche web, génération d'images, scènes 3D, retouche photo et vidéo, atelier de code. Votre agent IA, vos données, votre contrôle.",
  keywords: ["NEXUS", "Agent IA", "IA locale", "IA autonome", "3D", "génération d'images", "atelier code"],
};

export const viewport: Viewport = {
  // Chrome mobile suit le mode réellement affiché.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9f9fa" },
    { media: "(prefers-color-scheme: dark)", color: "#16181b" },
  ],
};

// Applique la palette et l'accent mémorisés AVANT le premier rendu : évite
// qu'un utilisateur « chaud + émeraude » voie un flash neutre/ardoise.
const appearanceScript = `(function(){try{var d=document.documentElement;var a=localStorage.getItem("nexus-accent");if(a)d.setAttribute("data-accent",a);var p=localStorage.getItem("nexus-palette");if(p)d.setAttribute("data-palette",p);}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: appearanceScript }} />
      </head>
      <body className="antialiased bg-background text-foreground">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
