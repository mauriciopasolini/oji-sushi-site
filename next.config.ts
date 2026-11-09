import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,

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
