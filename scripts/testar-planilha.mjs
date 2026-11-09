#!/usr/bin/env node
// Script de teste do leitor da planilha de fechamento de caixa. SÓ LÊ: não grava nada no banco.
//
//   npm run testar-planilha -- --planilha "<link>" --aba 08/11          lê uma aba e mostra o que encontrou
//   npm run testar-planilha -- --planilha "<link>" --aba 08/11 --json   imprime o JSON completo
//   npm run testar-planilha -- --planilha "<link>" --aba 08/11 --grade  mostra também as células brutas
//   npm run testar-planilha -- --planilha "<link>" --resumo --mes 11 [--ate 08]   total por dia das abas do mês

import { parseArgs } from "node:util";
import { auth, sheets } from "@googleapis/sheets";
import { dataDaAba, idDaPlanilha, lerAbaDiaria } from "../lib/cmv/planilha/parser.ts";

const { values: a } = parseArgs({
  options: {
    planilha: { type: "string" },
    aba: { type: "string", default: "08/11" },
    ano: { type: "string", default: "2026" },
    json: { type: "boolean", default: false },
    grade: { type: "boolean", default: false },
    resumo: { type: "boolean", default: false },
    mes: { type: "string", default: "11" },
    ate: { type: "string" },
  },
});

const id = idDaPlanilha(a.planilha ?? "");
if (!id) {
  console.error('Informe --planilha "<link da planilha>".');
  process.exit(1);
}
if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  console.error("GOOGLE_SERVICE_ACCOUNT_JSON não está no .env.local (rode npm run configurar-google).");
  process.exit(1);
}

const chave = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON, "base64").toString("utf8"));
const api = sheets({
  version: "v4",
  auth: new auth.JWT({ email: chave.client_email, key: chave.private_key, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] }),
});
const brl = (c) => (c === null || c === undefined ? "—" : (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const ano = Number(a.ano);

async function lerAbas(titulos) {
  const r = await api.spreadsheets.values.batchGet({
    spreadsheetId: id,
    ranges: titulos.map((t) => `'${t.replace(/'/g, "''")}'`),
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  return (r.data.valueRanges ?? []).map((vr) => vr.values ?? []);
}

function col(n) {
  let s = "";
  for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

try {
  const meta = await api.spreadsheets.get({ spreadsheetId: id, fields: "properties.title,sheets.properties.title" });
  const abas = (meta.data.sheets ?? []).map((s) => s.properties.title);
  const diarias = abas.filter((t) => dataDaAba(t, ano));
  console.log(`Planilha: ${meta.data.properties.title}`);
  console.log(`Abas: ${abas.length} (${diarias.length} diárias; ignoradas: ${abas.filter((t) => !dataDaAba(t, ano)).join(", ") || "nenhuma"})\n`);

  if (a.resumo) {
    const mesNum = Number(a.mes);
    const doMes = diarias.filter((t) => Number(dataDaAba(t, ano).slice(5, 7)) === mesNum && (!a.ate || Number(dataDaAba(t, ano).slice(8, 10)) <= Number(a.ate)));
    const grades = await lerAbas(doMes);
    let acumulado = 0;
    const linhas = doMes.map((t, i) => ({ t, data: dataDaAba(t, ano), aba: lerAbaDiaria(grades[i]) })).sort((x, y) => x.data.localeCompare(y.data));
    for (const { t, aba } of linhas) {
      const total = aba.turnos.reduce((s, x) => s + x.somaOrigens, 0);
      acumulado += total;
      const div = aba.turnos.flatMap((x) => Object.entries(x.origens).filter(([, o]) => o.divergencia).map(([k, o]) => `T${x.turno} ${k} ${brl(o.divergencia)}`));
      console.log(`${t.padEnd(6)} ${aba.vazia ? "VAZIA".padStart(14) : brl(total).padStart(14)}   acumulado ${brl(acumulado).padStart(14)}${div.length ? `   divergências: ${div.join("; ")}` : ""}${aba.avisos.length ? `   avisos: ${aba.avisos.length}` : ""}`);
    }
    process.exit(0);
  }

  if (!abas.includes(a.aba)) {
    console.error(`Aba "${a.aba}" não encontrada.`);
    process.exit(1);
  }
  const [grade] = await lerAbas([a.aba]);

  if (a.grade) {
    console.log("Células não vazias:");
    grade.forEach((linha, l) => {
      const cel = linha.map((v, c) => (v === "" || v === null || v === undefined ? null : `${col(c)}${l + 1}=${JSON.stringify(v)}`)).filter(Boolean);
      if (cel.length) console.log("  " + cel.join("  "));
    });
    console.log();
  }

  const lido = lerAbaDiaria(grade);
  if (a.json) {
    console.log(JSON.stringify(lido, null, 2));
    process.exit(0);
  }

  for (const t of lido.turnos) {
    console.log(`TURNO ${t.turno}`);
    for (const [k, o] of Object.entries(t.origens)) {
      const partes = Object.entries(o.campos).filter(([, v]) => v).map(([c, v]) => `${c} ${brl(v)}`).join(", ");
      console.log(`  ${k.padEnd(12)} ${brl(o.totalCalculado).padStart(12)}   (planilha: ${brl(o.totalPlanilha)}${o.divergencia ? `, DIVERGÊNCIA ${brl(o.divergencia)}` : ""})${o.qtdPedidos !== null ? `  pedidos ${o.qtdPedidos}` : ""}  [${partes}]`);
    }
    console.log(`  despesas     mercado ${brl(t.despesas.mercado)} · motoboy ${brl(t.despesas.motoboy)} · outros ${brl(t.despesas.outros)} · total ${brl(t.despesas.total)}`);
    console.log(`  soma origens ${brl(t.somaOrigens)} × Total do Dia ${brl(t.totalDia)}${t.divergenciaTotalDia ? `  DIVERGÊNCIA ${brl(t.divergenciaTotalDia)}` : ""}`);
    console.log(`  total pedidos ${t.totalPedidos ?? "—"} · dinheiro em caixa ${brl(t.dinheiroEmCaixa)}\n`);
  }
  console.log(`DIA: ${brl(lido.turnos.reduce((s, x) => s + x.somaOrigens, 0))}${lido.vazia ? "  (aba vazia)" : ""}`);
  if (lido.avisos.length) console.log(`\nAvisos:\n  - ${lido.avisos.join("\n  - ")}`);
} catch (e) {
  const msg = e?.response?.data?.error?.message ?? e.message;
  console.error("Erro ao ler a planilha:", msg);
  if (/permission|not have permission|403/i.test(msg)) console.error(`→ Compartilhe a planilha (Leitor) com ${chave.client_email}`);
  process.exit(1);
}
