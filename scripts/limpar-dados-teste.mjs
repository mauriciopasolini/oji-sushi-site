#!/usr/bin/env node
// Limpa os dados de TESTE antes de o módulo entrar em uso. Rodar UMA vez.
//
//   npm run limpar-teste                          1º passo: só mostra o que será apagado e gera um código
//   npm run limpar-teste -- --confirmar ABC123    2º passo: apaga (o código precisa bater com o plano atual)
//
// Opções (usar as mesmas nos dois passos):
//   --vendas                        apaga também TODAS as vendas (vendas_turno e fechamento_turno)
//   --manter-fornecedor "Nome"      não apaga esse fornecedor (pode repetir)
//   --ensaio                        com --confirmar: executa as exclusões no banco e DESFAZ no fim (não toca no Storage)
//
// O que é apagado:
//   * todas as notas e o histórico delas na auditoria
//   * fornecedores que não são do cadastro inicial (Frumar, FEMSA, Fruteira, Mercado)
//   * meses criados automaticamente que ficarem sem uso (nov e dez/2026 são mantidos)
//   * todas as fotos do bucket "notas"
// NÃO apaga: usuários, categorias, metas, pesos, régua, histórico mensal.
// Recusa rodar se existir algum mês FECHADO (sinal de que o sistema já está em uso).

import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const FORNECEDORES_INICIAIS = ["Frumar", "FEMSA", "Fruteira", "Mercado"];
const MESES_INICIAIS = ["2026-11-01", "2026-12-01"];

const { values: a } = parseArgs({
  options: {
    confirmar: { type: "string" },
    vendas: { type: "boolean", default: false },
    "manter-fornecedor": { type: "string", multiple: true, default: [] },
    ensaio: { type: "boolean", default: false },
  },
});

for (const v of ["SUPABASE_DB_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[v]) {
    console.error(`Falta ${v} no .env.local.`);
    process.exit(1);
  }
}

const sql = postgres(process.env.SUPABASE_DB_URL, { max: 1, onnotice: () => {} });
const storage = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
}).storage.from("notas");

const brl = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const projeto = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];

try {
  const fechados = await sql`select to_char(competencia, 'MM/YYYY') m from public.meses where status = 'fechado'`;
  if (fechados.length) {
    console.error(`Recusado: há mês fechado (${fechados.map((x) => x.m).join(", ")}). O sistema já está em uso.`);
    process.exit(1);
  }

  const manter = a["manter-fornecedor"].map((n) => n.trim().toLowerCase());
  const notas = await sql`
    select n.id, n.data_emissao::text data, n.valor, n.status, f.nome fornecedor
    from public.notas n join public.fornecedores f on f.id = n.fornecedor_id
    order by n.data_emissao, n.criado_em`;
  const fornecedores = (await sql`select id, nome, revisado_em from public.fornecedores order by nome`).filter(
    (f) => !FORNECEDORES_INICIAIS.includes(f.nome) && !manter.includes(f.nome.toLowerCase()),
  );
  const fotos = (await sql`select name from storage.objects where bucket_id = 'notas' order by name`).map((o) => o.name);
  const vendas = a.vendas
    ? (
        await sql`select (select count(*) from public.vendas_turno)::int vt, (select count(*) from public.fechamento_turno)::int ft,
                  (select count(distinct data) from public.vendas_turno)::int dias`
      )[0]
    : null;
  // Meses que ficarão sem uso (sem contagens; notas e vendas desta limpeza saem antes)
  const meses = await sql`
    select m.id, to_char(m.competencia, 'MM/YYYY') m from public.meses m
    where m.competencia::text not in ${sql(MESES_INICIAIS)}
      and not exists (select 1 from public.contagens c where c.mes_id = m.id)
      ${a.vendas ? sql`` : sql`and not exists (select 1 from public.vendas_turno v where date_trunc('month', v.data) = m.competencia)
                                and not exists (select 1 from public.fechamento_turno t where date_trunc('month', t.data) = m.competencia)`}
    order by m.competencia`;

  const plano = {
    projeto,
    notas: notas.map((n) => n.id),
    fornecedores: fornecedores.map((f) => f.id),
    meses: meses.map((m) => m.id),
    fotos,
    vendas: vendas ? [vendas.vt, vendas.ft] : null,
  };
  const codigo = createHash("sha256").update(JSON.stringify(plano)).digest("hex").slice(0, 6).toUpperCase();

  console.log(`\nProjeto Supabase: ${projeto}\n`);
  console.log(`Notas a apagar: ${notas.length}`);
  for (const n of notas.slice(0, 30)) console.log(`   ${n.data}  ${n.fornecedor.padEnd(24)} ${brl(n.valor).padStart(14)}  ${n.status}`);
  if (notas.length > 30) console.log(`   … e mais ${notas.length - 30}`);
  console.log(`Fornecedores a apagar: ${fornecedores.length}${fornecedores.length ? ` → ${fornecedores.map((f) => f.nome).join(", ")}` : ""}`);
  console.log(`Meses criados automaticamente a apagar: ${meses.length}${meses.length ? ` → ${meses.map((m) => m.m).join(", ")}` : ""}`);
  console.log(`Fotos no Storage a apagar: ${fotos.length}`);
  if (vendas) console.log(`Vendas a apagar: ${vendas.vt} linha(s) de venda em ${vendas.dias} dia(s) e ${vendas.ft} fechamento(s) de turno`);
  else console.log("Vendas: mantidas (use --vendas para apagar também)");

  const total = notas.length + fornecedores.length + meses.length + fotos.length + (vendas ? vendas.vt + vendas.ft : 0);
  if (total === 0) {
    console.log("\nNada a limpar.");
    process.exit(0);
  }

  if (!a.confirmar) {
    const extras = [a.vendas ? "--vendas" : "", ...a["manter-fornecedor"].map((n) => `--manter-fornecedor "${n}"`)].filter(Boolean).join(" ");
    console.log(`\nNada foi apagado. Para confirmar, rode:\n\n   npm run limpar-teste -- ${extras ? `${extras} ` : ""}--confirmar ${codigo}\n`);
    process.exit(0);
  }
  if (a.confirmar.trim().toUpperCase() !== codigo) {
    console.error(`\nCódigo não confere (esperado para o plano atual: ${codigo}). Os dados mudaram ou as opções são outras. Nada foi apagado.`);
    process.exit(1);
  }

  // ---------------------------------------------------------------- execução
  await sql.begin(async (tx) => {
    // Notas, auditoria e meses são protegidos por trigger contra exclusão.
    // Desliga só durante esta transação (se algo falhar, tudo volta, inclusive os triggers).
    await tx`alter table public.notas disable trigger notas_sem_delete`;
    await tx`alter table public.auditoria disable trigger auditoria_imutavel`;
    await tx`alter table public.meses disable trigger meses_regras`;

    const ids = [...plano.notas, ...plano.fornecedores];
    if (ids.length) await tx`delete from public.auditoria where registro_id in ${tx(ids)}`;
    if (plano.notas.length) await tx`delete from public.notas where id in ${tx(plano.notas)}`;
    if (a.vendas) {
      await tx`delete from public.vendas_turno`;
      await tx`delete from public.fechamento_turno`;
    }
    if (plano.fornecedores.length) await tx`delete from public.fornecedores where id in ${tx(plano.fornecedores)}`;
    if (plano.meses.length) {
      await tx`delete from public.auditoria where tabela = 'meses' and registro_id in ${tx(plano.meses)}`;
      await tx`delete from public.meses where id in ${tx(plano.meses)}`;
    }

    await tx`alter table public.notas enable trigger notas_sem_delete`;
    await tx`alter table public.auditoria enable trigger auditoria_imutavel`;
    await tx`alter table public.meses enable trigger meses_regras`;

    if (a.ensaio) {
      const [r] = await tx`select (select count(*) from public.notas)::int notas, (select count(*) from public.fornecedores)::int fornecedores,
        (select count(*) from public.vendas_turno)::int vendas`;
      console.log(`\nEnsaio: dentro da transação ficariam ${r.notas} nota(s), ${r.fornecedores} fornecedor(es) e ${r.vendas} venda(s).`);
      await tx.rollback();
    }
  });
  if (a.ensaio) {
    console.log("Ensaio concluído: transação DESFEITA, nada foi apagado (Storage não foi tocado).");
    process.exit(0);
  }
  console.log("\n✓ Banco limpo.");

  for (let i = 0; i < fotos.length; i += 100) {
    const { error } = await storage.remove(fotos.slice(i, i + 100));
    if (error) throw new Error(`Storage: ${error.message}`);
  }
  console.log(`✓ ${fotos.length} foto(s) removida(s) do Storage.`);

  const [x] = await sql`select (select count(*) from public.notas)::int notas, (select count(*) from public.fornecedores)::int fornecedores,
    (select count(*) from storage.objects where bucket_id = 'notas')::int fotos,
    (select bool_and(tgenabled = 'O') from pg_trigger where tgname in ('notas_sem_delete', 'auditoria_imutavel', 'meses_regras')) protecoes_ativas`;
  console.log(`\nDepois da limpeza: ${x.notas} nota(s), ${x.fornecedores} fornecedor(es), ${x.fotos} foto(s). Proteções reativadas: ${x.protecoes_ativas ? "sim" : "NÃO, verificar!"}`);
} catch (e) {
  console.error("\nFALHOU:", e.message, "\n(Se a falha foi no banco, nada foi apagado.)");
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
