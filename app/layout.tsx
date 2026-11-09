import type { Metadata } from "next";

// Layout raiz das rotas do app (apenas /painel e /api).
// A landing pública NÃO passa por aqui: é servida de public/index.html.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
