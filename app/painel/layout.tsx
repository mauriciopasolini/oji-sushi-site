import type { Metadata, Viewport } from "next";
import "./painel.css";

export const metadata: Metadata = {
  title: { default: "Controladoria Oji", template: "%s · Controladoria Oji" },
  robots: { index: false, follow: false, nocache: true },
  // Ícones do painel (placa com o ponto) e atalho "Controladoria" (decisões 104 e 118).
  // Ficam em public/icones-painel/, fora de /painel, para não passar pelo login do proxy.
  applicationName: "Oji Controladoria",
  appleWebApp: { title: "Controladoria", capable: true },
  manifest: "/icones-painel/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icones-painel/favicon.ico", sizes: "any" },
      { url: "/icones-painel/icon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/icones-painel/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#111111",
};

export default function PainelLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-neutral-50 text-neutral-900 antialiased">{children}</div>;
}
