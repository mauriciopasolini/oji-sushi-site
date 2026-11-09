import type { Metadata, Viewport } from "next";
import "./painel.css";

export const metadata: Metadata = {
  title: { default: "Painel · Oji", template: "%s · Painel Oji" },
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#111111",
};

export default function PainelLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-neutral-50 text-neutral-900 antialiased">{children}</div>;
}
