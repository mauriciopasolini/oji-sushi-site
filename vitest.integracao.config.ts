import path from "node:path";
import { defineConfig } from "vitest/config";

// Testes de integração: usam o Supabase e a planilha REAIS (credenciais do .env.local).
// Rodar com: npm run test:integracao   (não fazem parte do `npm test`)
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
      "server-only": path.resolve(import.meta.dirname, "test/server-only-stub.ts"),
    },
  },
  test: { environment: "node", include: ["lib/**/*.integracao.ts"], testTimeout: 60_000, env: { TZ: "UTC" } },
});
