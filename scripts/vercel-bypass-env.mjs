// Grava no .env.local o segredo "Protection Bypass for Automation" do projeto na Vercel
// (VERCEL_AUTOMATION_BYPASS_SECRET), lido pela CLI logada. O valor nunca é impresso.
// Uso: npm run vercel:bypass-env      (decisão 105)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const projeto = JSON.parse(readFileSync(".vercel/project.json", "utf8")).projectId;
const json = execFileSync("vercel", ["api", `/v9/projects/${projeto}`], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
  shell: process.platform === "win32",
  env: { ...process.env, MSYS_NO_PATHCONV: "1" },
});
const bypass = JSON.parse(json).protectionBypass ?? {};
const segredos = Object.entries(bypass).filter(([, v]) => v.scope === "automation-bypass").map(([k]) => k);
if (segredos.length === 0) {
  console.error("Nenhum segredo de automação no projeto. Crie em Settings → Deployment Protection → Protection Bypass for Automation.");
  process.exit(1);
}
const chave = "VERCEL_AUTOMATION_BYPASS_SECRET";
const atual = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "";
const linhas = atual.split(/\r?\n/).filter((l) => !l.startsWith(`${chave}=`));
while (linhas.length && linhas[linhas.length - 1] === "") linhas.pop();
linhas.push(`${chave}=${segredos[0]}`, "");
writeFileSync(".env.local", linhas.join("\n"));
console.log(`${chave} gravado no .env.local (${segredos.length} segredo(s) de automação no projeto).`);
