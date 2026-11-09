import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname) },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
    // Igual à Vercel: servidor em UTC. Garante que nada depende do fuso da máquina.
    env: { TZ: "UTC" },
  },
});
