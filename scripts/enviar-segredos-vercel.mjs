#!/usr/bin/env node
// Envia para a Vercel (Production e Preview) as variáveis SÓ DE SERVIDOR que estão no .env.local,
// marcadas como "sensitive". Não exibe os valores.
//
//   npm run vercel:segredos
//
// Requer a CLI da Vercel logada e a pasta ligada ao projeto (vercel link).

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const NOMES = ["SUPABASE_SERVICE_ROLE_KEY", "GOOGLE_SERVICE_ACCOUNT_JSON", "CRON_SECRET"];
const AMBIENTES = ["production", "preview"];

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .map((l) => /^([A-Z_]+)=(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);

// Comandos montados só com nomes fixos (sem entrada do usuário); o valor vai pelo stdin, nunca na linha de comando.
const vercel = (args, input) => spawnSync(`vercel ${args}`, { shell: true, input, encoding: "utf8" });
const existentes = vercel("env ls").stdout ?? "";
let falhas = 0;

for (const nome of NOMES) {
  const valor = env[nome];
  if (!valor) {
    console.log(`✗ ${nome}: vazio no .env.local — pulei`);
    falhas++;
    continue;
  }
  for (const amb of AMBIENTES) {
    const jaExiste = new RegExp(`^\\s*${nome}\\s.*\\b${amb === "production" ? "Production" : "Preview"}\\b`, "mi").test(existentes);
    if (jaExiste) {
      console.log(`• ${nome} (${amb}): já existe — mantido (para trocar: vercel env rm ${nome} ${amb})`);
      continue;
    }
    const r = vercel(`env add ${nome} ${amb} --sensitive`, valor);
    const ok = r.status === 0;
    if (!ok) falhas++;
    console.log(`${ok ? "✓" : "✗"} ${nome} (${amb})${ok ? "" : `: ${(r.stderr || r.stdout).split("\n").find((l) => /error/i.test(l)) ?? "falhou"}`}`);
  }
}
console.log(falhas ? `\n${falhas} problema(s).` : "\nPronto. Faça um novo deploy (push) para as variáveis valerem.");
