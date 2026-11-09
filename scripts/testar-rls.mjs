#!/usr/bin/env node
// Testa as regras de acesso (RLS + triggers) direto no banco, simulando cada papel.
// Tudo roda numa transação que é DESFEITA no fim: nada fica gravado.
//
//   npm run db:test-rls

import { randomUUID } from "node:crypto";
import postgres from "postgres";

if (!process.env.SUPABASE_DB_URL) {
  console.error("SUPABASE_DB_URL não definida.");
  process.exit(1);
}
const sql = postgres(process.env.SUPABASE_DB_URL, { max: 1, onnotice: () => {} });

const U = { admin: randomUUID(), gestor: randomUUID(), inativo: randomUUID(), estranho: randomUUID() };
let ok = 0;
let falhas = 0;

async function comoUsuario(tx, uid) {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: "authenticated" })}, true)`;
  await tx`set local role authenticated`;
}
async function comoAnonimo(tx) {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ role: "anon" })}, true)`;
  await tx`set local role anon`;
}

function registrar(passou, nome, detalhe = "") {
  if (passou) ok++;
  else falhas++;
  console.log(`${passou ? "  ✓" : "  ✗"} ${nome}${detalhe ? `  — ${detalhe}` : ""}`);
}

/** Espera que fn rode sem erro e que verificar(resultado) seja verdadeiro. */
async function deve(tx, nome, fn, verificar = () => true) {
  try {
    let r;
    await tx.savepoint(async (sp) => {
      r = await fn(sp);
      await sp`reset role`; // SET LOCAL sobrevive a um savepoint liberado: volta ao papel do script
    });
    const v = verificar(r);
    registrar(v === true, nome, v === true ? "" : `resultado inesperado: ${JSON.stringify(r)?.slice(0, 160)}`);
  } catch (e) {
    registrar(false, nome, `erro: ${e.message}`);
  }
}

/** Espera que fn falhe (opcionalmente com mensagem contendo `trecho`). */
async function naoDeve(tx, nome, fn, trecho) {
  try {
    await tx.savepoint(async (sp) => {
      await fn(sp);
      await sp`reset role`;
    });
    registrar(false, nome, "deveria ter falhado, mas passou");
  } catch (e) {
    const casa = !trecho || e.message.toLowerCase().includes(trecho.toLowerCase());
    registrar(casa, nome, casa ? `bloqueado: ${e.message}` : `falhou com outra mensagem: ${e.message}`);
  }
}

try {
  await sql.begin(async (tx) => {
    // ---------------------------------------------------------------- setup
    for (const [nome, id] of Object.entries(U)) {
      await tx`insert into auth.users (id, email, aud, role) values (${id}, ${`teste-${nome}-${id.slice(0, 8)}@exemplo.invalid`}, 'authenticated', 'authenticated')`;
    }
    await tx`insert into public.perfis (id, nome, papel, ativo) values
      (${U.admin}, 'Teste Admin', 'admin', true),
      (${U.gestor}, 'Teste Gestor', 'gestor', true),
      (${U.inativo}, 'Teste Inativo', 'gestor', false)`;

    const [{ id: frumar, categoria_padrao_id: pescados }] = await tx`select id, categoria_padrao_id from public.fornecedores where nome = 'Frumar'`;
    const [{ id: nov }] = await tx`select id from public.meses where competencia = '2026-11-01'`;
    const notaGestor = randomUUID();

    const novaNota = (sp, extra = {}) =>
      sp`insert into public.notas ${sp({
        id: randomUUID(), data_emissao: "2026-11-08", fornecedor_id: frumar, categoria_id: pescados,
        valor: 100, foto_path: "2026/11/teste.jpg", ...extra,
      })} returning *`;

    console.log("\nAnônimo e usuários sem acesso");
    await naoDeve(tx, "anônimo não lê categorias", async (sp) => { await comoAnonimo(sp); await sp`select * from public.categorias_cmv`; }, "permission denied");
    await deve(tx, "usuário sem perfil não vê nada", async (sp) => { await comoUsuario(sp, U.estranho); return sp`select * from public.categorias_cmv`; }, (r) => r.length === 0);
    await deve(tx, "gestor inativo não vê nada", async (sp) => { await comoUsuario(sp, U.inativo); return sp`select * from public.notas`; }, (r) => r.length === 0);
    await deve(tx, "gestor inativo lê o próprio perfil (para a tela de acesso bloqueado)", async (sp) => { await comoUsuario(sp, U.inativo); return sp`select ativo from public.perfis`; }, (r) => r.length === 1 && r[0].ativo === false);

    console.log("\nGestor: leitura e configuração");
    await deve(tx, "gestor lê as 4 categorias", async (sp) => { await comoUsuario(sp, U.gestor); return sp`select * from public.categorias_cmv`; }, (r) => r.length === 4);
    await deve(tx, "gestor NÃO altera meta do mês (0 linhas afetadas)", async (sp) => { await comoUsuario(sp, U.gestor); return sp`update public.meses set meta_venda = 1 where id = ${nov}`; }, (r) => r.count === 0);
    await naoDeve(tx, "gestor NÃO cria categoria", async (sp) => { await comoUsuario(sp, U.gestor); await sp`insert into public.categorias_cmv (nome, slug, pct_meta) values ('X', 'x', 0.01)`; }, "row-level security");
    await deve(tx, "gestor NÃO se promove a admin (0 linhas)", async (sp) => { await comoUsuario(sp, U.gestor); return sp`update public.perfis set papel = 'admin' where id = ${U.gestor}`; }, (r) => r.count === 0);

    console.log("\nGestor: notas");
    // Cria a nota fora de savepoint para os testes seguintes usarem.
    await comoUsuario(tx, U.gestor);
    const [n] = await tx`insert into public.notas ${tx({
      id: notaGestor, data_emissao: "2026-11-08", fornecedor_id: frumar, categoria_id: pescados,
      valor: 8000, foto_path: "2026/11/x.jpg", conferencia: "conferida",
    })} returning *`;
    await tx`reset role`;
    registrar(n.mes_id === nov && n.conferencia === "pendente" && n.criado_por === U.gestor,
      "gestor lança nota: mês definido pela data, conferência forçada para pendente, criado_por = gestor");

    await naoDeve(tx, "gestor NÃO confere nota", async (sp) => { await comoUsuario(sp, U.gestor); await sp`update public.notas set conferencia = 'conferida' where id = ${notaGestor}`; }, "administrador");
    await naoDeve(tx, "gestor NÃO edita valor sem motivo", async (sp) => { await comoUsuario(sp, U.gestor); await sp`update public.notas set valor = 7000 where id = ${notaGestor}`; }, "motivo");
    await deve(tx, "gestor edita valor com motivo → auditoria registra o motivo", async (sp) => {
      await comoUsuario(sp, U.gestor);
      await sp`update public.notas set valor = 7000, motivo_edicao = 'digitei errado' where id = ${notaGestor}`;
      return sp`select acao, motivo, (antes->>'valor') antes, (depois->>'valor') depois from public.auditoria where registro_id = ${notaGestor} order by id desc limit 1`;
    }, (r) => r[0]?.acao === "update" && r[0]?.motivo === "digitei errado" && Number(r[0].antes) === 8000 && Number(r[0].depois) === 7000);
    await deve(tx, "gestor NÃO apaga nota (0 linhas, nota continua lá)", async (sp) => {
      await comoUsuario(sp, U.gestor);
      const d = await sp`delete from public.notas where id = ${notaGestor}`;
      await sp`reset role`;
      const [c] = await sp`select count(*)::int c from public.notas where id = ${notaGestor}`;
      return { apagadas: d.count, existe: c.c };
    }, (r) => r.apagadas === 0 && r.existe === 1);
    await naoDeve(tx, "nem o banco (postgres) apaga nota", async (sp) => { await sp`delete from public.notas where id = ${notaGestor}`; }, "não podem ser apagadas");
    await naoDeve(tx, "gestor NÃO cancela sem motivo", async (sp) => { await comoUsuario(sp, U.gestor); await sp`update public.notas set status = 'cancelada' where id = ${notaGestor}`; }, "notas_cancelamento_com_motivo");
    await deve(tx, "gestor cancela com motivo → auditoria 'cancel'", async (sp) => {
      await comoUsuario(sp, U.gestor);
      await sp`update public.notas set status = 'cancelada', motivo_cancelamento = 'nota duplicada' where id = ${notaGestor}`;
      return sp`select acao, motivo from public.auditoria where registro_id = ${notaGestor} order by id desc limit 1`;
    }, (r) => r[0]?.acao === "cancel" && r[0]?.motivo === "nota duplicada");
    await naoDeve(tx, "gestor NÃO altera auditoria (sem privilégio)", async (sp) => { await comoUsuario(sp, U.gestor); await sp`update public.auditoria set motivo = 'x'`; }, "permission denied");
    await naoDeve(tx, "nem o banco (postgres) altera auditoria (trigger append-only)", async (sp) => { await sp`update public.auditoria set motivo = 'x'`; }, "append-only");
    await naoDeve(tx, "nem o banco (postgres) apaga auditoria", async (sp) => { await sp`delete from public.auditoria`; }, "append-only");

    console.log("\nGestor: vendas");
    await naoDeve(tx, "gestor NÃO grava venda com fonte 'planilha'", async (sp) => { await comoUsuario(sp, U.gestor); await sp`insert into public.vendas_turno (data, turno, origem, pix, fonte) values ('2026-11-08', 1, 'restaurante', 10, 'planilha')`; }, "row-level security");
    await deve(tx, "gestor grava venda manual; total calculado pelas partes", async (sp) => {
      await comoUsuario(sp, U.gestor);
      return sp`insert into public.vendas_turno (data, turno, origem, dinheiro, pix) values ('2026-11-08', 1, 'restaurante', 100.10, 50.25) returning total_calculado`;
    }, (r) => Number(r[0].total_calculado) === 150.35);
    await naoDeve(tx, "gestor NÃO fecha o mês", async (sp) => { await comoUsuario(sp, U.gestor); await sp`select public.fechar_mes(${nov})`; }, "administrador");

    console.log("\nAdmin");
    await deve(tx, "admin confere nota → conferida_por = admin", async (sp) => {
      await comoUsuario(sp, U.admin);
      const [x] = await novaNota(sp);
      return sp`update public.notas set conferencia = 'conferida' where id = ${x.id} returning conferida_por, conferida_em`;
    }, (r) => r[0].conferida_por === U.admin && r[0].conferida_em !== null);
    await naoDeve(tx, "admin NÃO muda status do mês por UPDATE direto", async (sp) => { await comoUsuario(sp, U.admin); await sp`update public.meses set status = 'fechado', fechado_em = now() where id = ${nov}`; }, "fechar_mes");

    // Fecha novembro (fora de savepoint) para os testes de mês fechado.
    await comoUsuario(tx, U.admin);
    await tx`select public.fechar_mes(${nov})`;
    await tx`reset role`;
    const [m] = await tx`select status, fechado_por from public.meses where id = ${nov}`;
    registrar(m.status === "fechado" && m.fechado_por === U.admin, "admin fecha novembro via fechar_mes()");

    console.log("\nMês fechado (garantido no banco)");
    await naoDeve(tx, "gestor NÃO lança nota em mês fechado", async (sp) => { await comoUsuario(sp, U.gestor); await novaNota(sp); }, "está fechado");
    await naoDeve(tx, "admin NÃO edita nota em mês fechado", async (sp) => { await comoUsuario(sp, U.admin); await sp`update public.notas set observacao = 'x', motivo_edicao = 'teste' where id = ${notaGestor}`; }, "está fechado");
    await naoDeve(tx, "nota NÃO pode ser movida de outro mês para o fechado", async (sp) => {
      await comoUsuario(sp, U.gestor);
      const [x] = await sp`insert into public.notas ${sp({ data_emissao: "2026-12-02", fornecedor_id: frumar, categoria_id: pescados, valor: 10, foto_path: "2026/12/y.jpg" })} returning id`;
      await sp`update public.notas set data_emissao = '2026-11-30', motivo_edicao = 'teste' where id = ${x.id}`;
    }, "está fechado");
    await naoDeve(tx, "admin NÃO grava venda em mês fechado", async (sp) => { await comoUsuario(sp, U.admin); await sp`insert into public.vendas_turno (data, turno, origem, pix) values ('2026-11-09', 2, 'oji_tele', 10)`; }, "está fechado");
    await naoDeve(tx, "sincronização (service_role/postgres) NÃO grava fechamento de turno em mês fechado", async (sp) => { await sp`insert into public.fechamento_turno (data, turno) values ('2026-11-09', 1)`; }, "está fechado");
    await naoDeve(tx, "admin NÃO altera meta de mês fechado", async (sp) => { await comoUsuario(sp, U.admin); await sp`update public.meses set meta_venda = 1 where id = ${nov}`; }, "fechado");
    await naoDeve(tx, "foto NÃO pode ser enviada para pasta de mês fechado", async (sp) => {
      await comoUsuario(sp, U.gestor);
      const [r] = await sp`select interno.caminho_nota_gravavel(${`2026/11/${randomUUID()}.jpg`}) ok`;
      if (!r.ok) throw new Error("caminho bloqueado (mês fechado)");
    }, "bloqueado");
    await deve(tx, "foto pode ser enviada para pasta de mês aberto", async (sp) => {
      await comoUsuario(sp, U.gestor);
      return sp`select interno.caminho_nota_gravavel(${`2026/12/${randomUUID()}.webp`}) ok, interno.caminho_nota_gravavel('2026/12/../x.jpg') ruim`;
    }, (r) => r[0].ok === true && r[0].ruim === false);
    await deve(tx, "nota em dezembro (mês aberto) continua permitida", async (sp) => { await comoUsuario(sp, U.gestor); return novaNota(sp, { data_emissao: "2026-12-01", foto_path: "2026/12/z.jpg" }); }, (r) => r.length === 1);
    await deve(tx, "mês novo é criado automaticamente com meta padrão 90.000", async (sp) => {
      await comoUsuario(sp, U.gestor);
      await novaNota(sp, { data_emissao: "2027-01-05", foto_path: "2027/01/z.jpg" });
      return sp`select meta_venda from public.meses where competencia = '2027-01-01'`;
    }, (r) => Number(r[0]?.meta_venda) === 90000);

    console.log("\nReabertura");
    await naoDeve(tx, "gestor NÃO reabre o mês", async (sp) => { await comoUsuario(sp, U.gestor); await sp`select public.reabrir_mes(${nov}, 'quero')`; }, "administrador");
    await naoDeve(tx, "admin NÃO reabre sem motivo", async (sp) => { await comoUsuario(sp, U.admin); await sp`select public.reabrir_mes(${nov}, '  ')`; }, "motivo");
    await deve(tx, "admin reabre com motivo → auditoria 'reopen'", async (sp) => {
      await comoUsuario(sp, U.admin);
      await sp`select public.reabrir_mes(${nov}, 'nota esquecida da Frumar')`;
      return sp`select a.acao, a.motivo, m.status from public.auditoria a join public.meses m on m.id::text = a.registro_id where a.registro_id = ${nov} order by a.id desc limit 1`;
    }, (r) => r[0]?.acao === "reopen" && r[0]?.motivo === "nota esquecida da Frumar" && r[0]?.status === "aberto");

    console.log("\nSeeds");
    await deve(tx, "categorias somam exatamente 35%", () => tx`select sum(pct_meta) s from public.categorias_cmv`, (r) => r[0].s === "0.3500000000");
    await deve(tx, "pesos de novembro/2026 somam 96.600", () => tx`
      select sum(p.peso) s from generate_series('2026-11-01'::date, '2026-11-30', '1 day') d
      join public.pesos_dia_semana p on p.dia_semana = extract(dow from d)`, (r) => Number(r[0].s) === 96600);

    await tx.rollback(); // desfaz tudo
  });
} catch (e) {
  console.error("\nErro inesperado:", e.message);
  falhas++;
} finally {
  await sql.end({ timeout: 5 });
}

console.log(`\n${ok} ok, ${falhas} falha(s). (Transação desfeita: nada foi gravado.)`);
process.exitCode = falhas ? 1 : 0;
