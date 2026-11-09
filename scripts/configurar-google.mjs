#!/usr/bin/env node
// Grava a chave da conta de serviço do Google no .env.local (GOOGLE_SERVICE_ACCOUNT_JSON, em base64)
// sem exibir o conteúdo. Mostra apenas o e-mail da conta, para conferência.
//
//   npm run configurar-google -- "C:\Users\voce\Downloads\chave.json"

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const arquivo = process.argv[2];
if (!arquivo) {
  console.error('Uso: npm run configurar-google -- "caminho\\do\\arquivo.json"');
  process.exit(1);
}
if (!existsSync(arquivo)) {
  console.error(`Arquivo não encontrado: ${arquivo}`);
  process.exit(1);
}

let chave;
try {
  chave = JSON.parse(readFileSync(arquivo, "utf8"));
} catch {
  console.error("O arquivo não é um JSON válido.");
  process.exit(1);
}
if (chave.type !== "service_account" || !chave.client_email || !chave.private_key) {
  console.error("Este JSON não parece ser a chave de uma conta de serviço (faltam type/client_email/private_key).");
  process.exit(1);
}

const envPath = path.resolve(import.meta.dirname, "..", ".env.local");
const linha = `GOOGLE_SERVICE_ACCOUNT_JSON=${Buffer.from(JSON.stringify(chave)).toString("base64")}`;
let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
env = /^GOOGLE_SERVICE_ACCOUNT_JSON=.*$/m.test(env)
  ? env.replace(/^GOOGLE_SERVICE_ACCOUNT_JSON=.*$/m, linha)
  : `${env.replace(/\n?$/, "\n")}${linha}\n`;
writeFileSync(envPath, env);

console.log("✓ Chave gravada em .env.local (GOOGLE_SERVICE_ACCOUNT_JSON).");
console.log(`  Conta de serviço: ${chave.client_email}`);
console.log(`  Projeto Google:   ${chave.project_id ?? "?"}`);
console.log("\n  Recomendado: apague o arquivo baixado agora que a chave está no .env.local.");
