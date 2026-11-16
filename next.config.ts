import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,

  // Relatório PDF do fechamento: renderizado no servidor (Node), com a fonte Gelasio
  // lida do disco. As fontes precisam ir junto na função da rota de exportação.
  serverExternalPackages: ["@react-pdf/renderer"],
  outputFileTracingIncludes: {
    "/painel/cmv/fechamento/exportar": ["./lib/cmv/relatorio/fontes/**/*"],
  },

  async rewrites() {
    return {
      // A landing pública é o HTML estático em public/index.html.
      // "/" continua servindo exatamente esse arquivo, sem passar pelo React.
      beforeFiles: [{ source: "/", destination: "/index.html" }],
    };
  },

  async headers() {
    const noindex = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];
    return [
      { source: "/painel/:path*", headers: noindex },
      { source: "/api/:path*", headers: noindex },
    ];
  },
};

export default nextConfig;
