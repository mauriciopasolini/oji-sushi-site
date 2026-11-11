#!/usr/bin/env node
// Testa as regras de acesso (RLS + triggers) direto no banco, simulando cada papel.
// Tudo roda numa transação que é DESFEITA no fim: nada fica gravado.
//
//   npm run db:test-rls
//   npm run db:test-rls -- --com-migracao supabase/migrations/<arquivo>.sql
//     (aplica uma migração ainda pendente dentro da mesma transação desfeita: ensaio antes do db:migrate)

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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
    const iMig = process.argv.indexOf("--com-migracao");
    if (iMig > 0) {
      const arquivo = process.argv[iMig + 1];
      await tx.unsafe(readFileSync(arquivo, "utf8"));
      console.log(`(migração ${arquivo} aplicada só dentro desta transação)`);
    }
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
    // data sem vendas reais (o banco já tem as vendas sincronizadas de novembro)
    await deve(tx, "gestor grava venda manual; total calculado pelas partes", async (sp) => {
      await comoUsuario(sp, U.gestor);
      return sp`insert into public.vendas_turno (data, turno, origem, dinheiro, pix) values ('2027-06-15', 1, 'restaurante', 100.10, 50.25) returning total_calculado`;
    }, (r) => Number(r[0].total_calculado) === 150.35);
    await naoDeve(tx, "gestor NÃO fecha o mês", async (sp) => { await comoUsuario(sp, U.gestor); await sp`select public.fechar_mes(${nov})`; }, "administrador");

    console.log("\nAdmin");
    await deve(tx, "admin confere nota → conferida_por = admin", async (sp) => {
      await comoUsuario(sp, U.admin);
      const [x] = await novaNota(sp);
      return sp`update public.notas set conferencia = 'conferida' where id = ${x.id} returning conferida_por, conferida_em`;
    }, (r) => r[0].conferida_por === U.admin && r[0].conferida_em !== null);
    await naoDeve(tx, "admin NÃO muda status do mês por UPDATE direto", async (sp) => { await comoUsuario(sp, U.admin); await sp`update public.meses set status = 'fechado', fechado_em = now() where id = ${nov}`; }, "fechar_mes");

    console.log("\nCompra sem nota (aguardando nota fiscal)");
    await naoDeve(tx, "gestor NÃO lança 'sem nota' sem observação", async (sp) => { await comoUsuario(sp, U.gestor); await novaNota(sp, { tipo: "sem_nota" }); }, "notas_sem_nota_com_observacao");
    await naoDeve(tx, "gestor NÃO justifica pendência (só admin)", async (sp) => {
      await comoUsuario(sp, U.gestor);
      await novaNota(sp, { tipo: "sem_nota", observacao: "chegou com romaneio", pendencia_justificativa: "x" });
    }, "administrador");
    // Pendente criada fora de savepoint: usada pelos testes de fechamento abaixo.
    const pendente = randomUUID();
    await comoUsuario(tx, U.gestor);
    await tx`insert into public.notas ${tx({ id: pendente, data_emissao: "2026-11-08", fornecedor_id: frumar, categoria_id: pescados, valor: 500, foto_path: "2026/11/romaneio.jpg", tipo: "sem_nota", observacao: "salmão com romaneio; NF amanhã" })}`;
    await tx`reset role`;
    await deve(tx, "compra sem nota entra ativa (conta no orçamento pela data de chegada)", async (sp) => sp`select status, tipo, mes_id from public.notas where id = ${pendente}`, (r) => r[0].status === "ativa" && r[0].tipo === "sem_nota" && r[0].mes_id === nov);
    // Pendências reais de novembro (se houver) recebem justificativa só dentro desta transação desfeita.
    await tx`update public.notas set pendencia_justificativa = 'teste rls' where mes_id = ${nov} and tipo = 'sem_nota' and status = 'ativa' and id <> ${pendente} and pendencia_justificativa is null`;
    await naoDeve(tx, "admin NÃO fecha o mês com compra sem nota e sem justificativa", async (sp) => { await comoUsuario(sp, U.admin); await sp`select public.fechar_mes(${nov})`; }, "aguardando nota fiscal");
    await naoDeve(tx, "gestor NÃO justifica pendência existente", async (sp) => { await comoUsuario(sp, U.gestor); await sp`update public.notas set pendencia_justificativa = 'x' where id = ${pendente}`; }, "administrador");
    // (os savepoints de deve() são liberados, não desfeitos: os passos abaixo se encadeiam)
    await deve(tx, "admin justifica a pendência sem motivo de edição; a conferência não é reaberta", async (sp) => {
      await comoUsuario(sp, U.admin);
      return sp`update public.notas set pendencia_justificativa = '  fornecedor informal, não emite nota  ' where id = ${pendente} returning pendencia_justificativa, conferencia`;
    }, (r) => r[0].pendencia_justificativa === "fornecedor informal, não emite nota" && r[0].conferencia === "pendente");
    await deve(tx, "mês com a pendente justificada pode ser fechado (checagem feita e desfeita aqui)", async (sp) => {
      await comoUsuario(sp, U.admin);
      await sp`select public.fechar_mes(${nov})`;
      await sp`reset role`;
      const [m] = await sp`select status from public.meses where id = ${nov}`;
      // volta a abrir para os testes seguintes
      await sp`select set_config('cmv.permitir_status', 'on', true)`;
      await sp`update public.meses set status = 'aberto', fechado_por = null, fechado_em = null where id = ${nov}`;
      await sp`select set_config('cmv.permitir_status', 'off', true)`;
      return m.status;
    }, (r) => r === "fechado");
    await deve(tx, "nota fiscal chegou: gestor troca tipo, número, foto e valor com motivo → auditoria guarda a foto antiga; justificativa limpa", async (sp) => {
      await comoUsuario(sp, U.gestor);
      const [n2] = await sp`update public.notas set tipo = 'nfe', numero = '4521', foto_path = '2026/11/nf.jpg', valor = 512.40, motivo_edicao = 'Nota fiscal recebida' where id = ${pendente} returning pendencia_justificativa, status`;
      await sp`reset role`;
      const [a] = await sp`select antes->>'foto_path' antes, depois->>'foto_path' depois, antes->>'tipo' tipo_antes, motivo from public.auditoria where registro_id = ${pendente} order by id desc limit 1`;
      return { ...a, just: n2.pendencia_justificativa, status: n2.status };
    }, (r) => r.antes === "2026/11/romaneio.jpg" && r.depois === "2026/11/nf.jpg" && r.tipo_antes === "sem_nota" && r.motivo === "Nota fiscal recebida" && r.just === null && r.status === "ativa");

    // Fecha novembro (fora de savepoint) para os testes de mês fechado.
    // A pendente acima já virou NF-e: o fechamento passa.
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

    console.log("\nFornecedores");
    await deve(tx, "gestor cria fornecedor (nome + categoria) → fica 'novo', campos de admin zerados", async (sp) => {
      await comoUsuario(sp, U.gestor);
      return sp`insert into public.fornecedores (nome, categoria_padrao_id, prazo_vencimento_dias, cnpj, ativo)
                values ('  Peixaria   do Porto ', ${pescados}, 30, '12345678000199', false)
                returning nome, criado_por, revisado_em, prazo_vencimento_dias, cnpj, ativo`;
    }, (r) => r[0].nome === "Peixaria do Porto" && r[0].criado_por === U.gestor && r[0].revisado_em === null
              && r[0].prazo_vencimento_dias === null && r[0].cnpj === null && r[0].ativo === true);
    await naoDeve(tx, "gestor NÃO cria fornecedor duplicado (caixa/espaços diferentes)", async (sp) => { await comoUsuario(sp, U.gestor); await sp`insert into public.fornecedores (nome, categoria_padrao_id) values ('FRUMAR ', ${pescados})`; }, "duplicate key");
    await deve(tx, "gestor NÃO edita fornecedor (0 linhas)", async (sp) => { await comoUsuario(sp, U.gestor); return sp`update public.fornecedores set prazo_vencimento_dias = 10 where id = ${frumar}`; }, (r) => r.count === 0);
    await deve(tx, "gestor NÃO desativa nem apaga fornecedor (0 linhas)", async (sp) => {
      await comoUsuario(sp, U.gestor);
      const a = await sp`update public.fornecedores set ativo = false where id = ${frumar}`;
      const b = await sp`delete from public.fornecedores where id = ${frumar}`;
      return a.count + b.count;
    }, (r) => r === 0);
    await deve(tx, "admin cria fornecedor → já nasce revisado", async (sp) => { await comoUsuario(sp, U.admin); return sp`insert into public.fornecedores (nome, categoria_padrao_id) values ('Atacadão', ${pescados}) returning revisado_em, revisado_por`; }, (r) => r[0].revisado_em !== null && r[0].revisado_por === U.admin);

    console.log("\nCategoria fora do padrão do fornecedor");
    await deve(tx, "nota com a categoria padrão do fornecedor → não destacada", async (sp) => {
      await comoUsuario(sp, U.gestor);
      return novaNota(sp, { data_emissao: "2026-12-03", foto_path: "2026/12/a.jpg" });
    }, (r) => r[0].categoria_fora_do_padrao === false);
    await deve(tx, "nota com outra categoria → destacada; gestor não consegue 'limpar' o destaque", async (sp) => {
      await comoUsuario(sp, U.gestor);
      const [outra] = await sp`select id from public.categorias_cmv where slug = 'mercado'`;
      const [x] = await novaNota(sp, { data_emissao: "2026-12-03", foto_path: "2026/12/b.jpg", categoria_id: outra.id });
      const [y] = await sp`update public.notas set categoria_fora_do_padrao = false, observacao = 'x', motivo_edicao = 'teste' where id = ${x.id} returning categoria_fora_do_padrao`;
      const [z] = await sp`update public.notas set categoria_id = ${pescados}, motivo_edicao = 'corrigi a categoria' where id = ${x.id} returning categoria_fora_do_padrao`;
      return [x.categoria_fora_do_padrao, y.categoria_fora_do_padrao, z.categoria_fora_do_padrao];
    }, (r) => r[0] === true && r[1] === true && r[2] === false);

    console.log("\nConferência (Etapa 6)");
    await deve(tx, "admin confere nota → conferida_por/em preenchidos; editar a nota volta para pendente", async (sp) => {
      await comoUsuario(sp, U.gestor);
      const [x] = await novaNota(sp, { data_emissao: "2026-12-04", foto_path: "2026/12/c1.jpg" });
      await comoUsuario(sp, U.admin);
      const [a] = await sp`update public.notas set conferencia = 'conferida' where id = ${x.id} returning conferencia, conferida_por, conferida_em`;
      await comoUsuario(sp, U.gestor);
      const [b] = await sp`update public.notas set valor = 101, motivo_edicao = 'valor corrigido' where id = ${x.id} returning conferencia, conferida_por`;
      return [a, b];
    }, ([a, b]) => a.conferencia === "conferida" && a.conferida_por === U.admin && a.conferida_em !== null && b.conferencia === "pendente" && b.conferida_por === null);
    await naoDeve(tx, "divergente sem observação é recusado", async (sp) => {
      await comoUsuario(sp, U.gestor);
      const [x] = await novaNota(sp, { data_emissao: "2026-12-04", foto_path: "2026/12/c2.jpg" });
      await comoUsuario(sp, U.admin);
      await sp`update public.notas set conferencia = 'divergente', conferencia_obs = '  ' where id = ${x.id}`;
    }, "notas_divergente_com_obs");

    console.log("\nMescla de fornecedores (Etapa 6)");
    const [{ id: mercadoCat }] = await tx`select id from public.categorias_cmv where slug = 'mercado'`;
    const [fA] = await tx`insert into public.fornecedores (nome, categoria_padrao_id) values ('Teste Mescla Principal', ${mercadoCat}) returning id`;
    const [fB] = await tx`insert into public.fornecedores (nome, categoria_padrao_id, revisado_em) values ('Teste Mescla Duplicado', ${mercadoCat}, null) returning id`;
    await tx`update public.fornecedores set revisado_em = null, revisado_por = null where id = ${fB.id}`;
    await naoDeve(tx, "gestor NÃO mescla fornecedores", async (sp) => { await comoUsuario(sp, U.gestor); await sp`select public.mesclar_fornecedores(${fA.id}, ${fB.id})`; }, "administrador");
    await naoDeve(tx, "admin NÃO mescla um fornecedor com ele mesmo", async (sp) => { await comoUsuario(sp, U.admin); await sp`select public.mesclar_fornecedores(${fA.id}, ${fA.id})`; }, "diferentes");
    await deve(tx, "admin mescla: notas de mês aberto passam (conferência mantida), as de mês fechado ficam; duplicado desativado e auditado", async (sp) => {
      await comoUsuario(sp, U.gestor);
      const [nNov] = await novaNota(sp, { data_emissao: "2026-11-03", foto_path: "2026/11/m1.jpg", fornecedor_id: fB.id, categoria_id: mercadoCat });
      const [nDez] = await novaNota(sp, { data_emissao: "2026-12-05", foto_path: "2026/12/m2.jpg", fornecedor_id: fB.id, categoria_id: mercadoCat });
      await comoUsuario(sp, U.admin);
      await sp`update public.notas set conferencia = 'conferida' where id = ${nDez.id}`;
      await sp`reset role`;
      // fecha novembro só aqui dentro (direto, sem as checagens de fechar_mes)
      await sp`select set_config('cmv.permitir_status', 'on', true)`;
      await sp`update public.meses set status = 'fechado', fechado_em = now() where id = ${nov}`;
      await sp`select set_config('cmv.permitir_status', 'off', true)`;
      await comoUsuario(sp, U.admin);
      const [{ mesclar_fornecedores: res }] = await sp`select public.mesclar_fornecedores(${fA.id}, ${fB.id})`;
      await sp`reset role`;
      const notas = await sp`select id, fornecedor_id, conferencia from public.notas where id in (${nNov.id}, ${nDez.id})`;
      const [f] = await sp`select ativo, mesclado_em_id, revisado_em from public.fornecedores where id = ${fB.id}`;
      const [aud] = await sp`select count(*)::int n from public.auditoria where tabela = 'fornecedores' and registro_id = ${fB.id} and acao = 'merge'`;
      const [audNota] = await sp`select motivo from public.auditoria where tabela = 'notas' and registro_id = ${nDez.id} order by id desc limit 1`;
      await sp`select set_config('cmv.permitir_status', 'on', true)`;
      await sp`update public.meses set status = 'aberto', fechado_por = null, fechado_em = null where id = ${nov}`;
      await sp`select set_config('cmv.permitir_status', 'off', true)`;
      return { res, nNov: notas.find((x) => x.id === nNov.id), nDez: notas.find((x) => x.id === nDez.id), f, aud: aud.n, motivo: audNota.motivo };
    }, (r) => r.res.notas_movidas === 1 && r.res.notas_em_mes_fechado === 1
              && r.nDez.fornecedor_id === fA.id && r.nDez.conferencia === "conferida"
              && r.nNov.fornecedor_id === fB.id
              && r.f.ativo === false && r.f.mesclado_em_id === fA.id && r.f.revisado_em !== null
              && r.aud === 1 && r.motivo?.startsWith("Mescla de fornecedores"));
    await naoDeve(tx, "fornecedor já mesclado NÃO é mesclado de novo", async (sp) => { await comoUsuario(sp, U.admin); await sp`select public.mesclar_fornecedores(${fA.id}, ${fB.id})`; }, "já foi mesclado");
    await naoDeve(tx, "fornecedor mesclado NÃO pode ser reativado", async (sp) => { await comoUsuario(sp, U.admin); await sp`update public.fornecedores set ativo = true where id = ${fB.id}`; }, "fornecedores_mescla_coerente");
    await deve(tx, "admin marca fornecedor como revisado", async (sp) => {
      await comoUsuario(sp, U.admin);
      const [x] = await sp`insert into public.fornecedores (nome, categoria_padrao_id) values ('Teste Revisar', ${mercadoCat}) returning id`;
      await sp`reset role`;
      await sp`update public.fornecedores set revisado_em = null, revisado_por = null where id = ${x.id}`;
      await comoUsuario(sp, U.admin);
      return sp`update public.fornecedores set revisado_em = now(), revisado_por = ${U.admin} where id = ${x.id} returning revisado_em`;
    }, (r) => r.length === 1 && r[0].revisado_em !== null);

    console.log("\nContagem de estoque (Etapa 6)");
    const [{ id: dez }] = await tx`select id from public.meses where competencia = '2026-12-01'`;
    await naoDeve(tx, "gestor NÃO cadastra item de contagem", async (sp) => { await comoUsuario(sp, U.gestor); await sp`insert into public.itens_contagem (nome, unidade, categoria_id) values ('Salmão', 'kg', ${pescados})`; }, "row-level security");
    await comoUsuario(tx, U.admin);
    const [it1] = await tx`insert into public.itens_contagem (nome, unidade, categoria_id, custo_unitario_ref) values ('  Teste   Salmão ', 'kg', ${pescados}, 89.90) returning id, nome`;
    const [it2] = await tx`insert into public.itens_contagem (nome, unidade, categoria_id) values ('Teste Arroz', 'pct', ${pescados}) returning id`;
    await tx`reset role`;
    registrar(it1.nome === "Teste Salmão", "admin cadastra item de contagem (nome normalizado)");
    await naoDeve(tx, "item com nome repetido (caixa/espaços) é recusado", async (sp) => { await comoUsuario(sp, U.admin); await sp`insert into public.itens_contagem (nome, unidade, categoria_id) values ('teste salmão', 'kg', ${pescados})`; }, "duplicate key");
    await naoDeve(tx, "contagem com data futura é recusada", async (sp) => { await comoUsuario(sp, U.gestor); await sp`insert into public.contagens (mes_id, data) values (${dez}, '2099-01-01')`; }, "futuro");
    await comoUsuario(tx, U.gestor);
    const [cont] = await tx`insert into public.contagens (mes_id, data, status) values (${dez}, current_date - 1, 'finalizada') returning id, status, realizada_por`;
    await tx`reset role`;
    registrar(cont.status === "rascunho" && cont.realizada_por === U.gestor, "gestor cria contagem → sempre nasce rascunho");
    await naoDeve(tx, "segunda contagem de fechamento no mesmo mês é recusada", async (sp) => { await comoUsuario(sp, U.gestor); await sp`insert into public.contagens (mes_id, data) values (${dez}, current_date - 1)`; }, "duplicate key");
    await naoDeve(tx, "contagem sem itens NÃO é finalizada", async (sp) => { await comoUsuario(sp, U.gestor); await sp`update public.contagens set status = 'finalizada' where id = ${cont.id}`; }, "nenhum item");
    await deve(tx, "gestor lança itens e finaliza → valor = qtd × custo; auditoria 'finalize' com o total", async (sp) => {
      await comoUsuario(sp, U.gestor);
      await sp`insert into public.contagem_itens (contagem_id, item_id, quantidade, custo_unitario) values (${cont.id}, ${it1.id}, 12.345, 89.90), (${cont.id}, ${it2.id}, 3, 25)`;
      await sp`update public.contagem_itens set quantidade = 12.5 where contagem_id = ${cont.id} and item_id = ${it1.id}`;
      const [c] = await sp`update public.contagens set status = 'finalizada' where id = ${cont.id} returning status, finalizada_por, finalizada_em`;
      await sp`reset role`;
      const itens = await sp`select valor from public.contagem_itens where contagem_id = ${cont.id} order by valor desc`;
      const [a] = await sp`select depois->>'total' total from public.auditoria where tabela = 'contagens' and registro_id = ${cont.id} and acao = 'finalize'`;
      return { c, valores: itens.map((i) => i.valor), total: a?.total };
    }, (r) => r.c.status === "finalizada" && r.c.finalizada_por === U.gestor && r.valores[0] === "1123.75" && r.valores[1] === "75.00" && Number(r.total) === 1198.75);
    await naoDeve(tx, "item de contagem finalizada NÃO pode ser alterado", async (sp) => { await comoUsuario(sp, U.admin); await sp`update public.contagem_itens set quantidade = 1 where contagem_id = ${cont.id}`; }, "finalizada");
    await naoDeve(tx, "item NÃO pode ser incluído em contagem finalizada", async (sp) => {
      await comoUsuario(sp, U.admin);
      const [it3] = await sp`insert into public.itens_contagem (nome, unidade, categoria_id) values ('Teste Nori', 'pct', ${pescados}) returning id`;
      await sp`insert into public.contagem_itens (contagem_id, item_id, quantidade, custo_unitario) values (${cont.id}, ${it3.id}, 1, 1)`;
    }, "finalizada");
    await naoDeve(tx, "contagem finalizada NÃO volta a rascunho por UPDATE direto (nem admin)", async (sp) => { await comoUsuario(sp, U.admin); await sp`update public.contagens set status = 'rascunho' where id = ${cont.id}`; }, "finalizada");
    await naoDeve(tx, "admin NÃO apaga contagem finalizada", async (sp) => { await comoUsuario(sp, U.admin); await sp`delete from public.contagens where id = ${cont.id}`; }, "não pode ser apagada");
    await naoDeve(tx, "gestor NÃO reabre contagem", async (sp) => { await comoUsuario(sp, U.gestor); await sp`select public.reabrir_contagem(${cont.id}, 'errei')`; }, "administrador");
    await naoDeve(tx, "admin NÃO reabre contagem sem motivo", async (sp) => { await comoUsuario(sp, U.admin); await sp`select public.reabrir_contagem(${cont.id}, ' ')`; }, "motivo");
    await deve(tx, "admin reabre contagem com motivo → rascunho e auditoria 'reopen'", async (sp) => {
      await comoUsuario(sp, U.admin);
      await sp`select public.reabrir_contagem(${cont.id}, 'faltou o freezer 2')`;
      await sp`reset role`;
      const [c] = await sp`select status, finalizada_em from public.contagens where id = ${cont.id}`;
      const [a] = await sp`select motivo from public.auditoria where tabela = 'contagens' and registro_id = ${cont.id} and acao = 'reopen'`;
      return { ...c, motivo: a?.motivo };
    }, (r) => r.status === "rascunho" && r.finalizada_em === null && r.motivo === "faltou o freezer 2");
    await naoDeve(tx, "contagem de mês fechado NÃO aceita itens", async (sp) => {
      await sp`select set_config('cmv.permitir_status', 'on', true)`;
      await sp`update public.meses set status = 'fechado', fechado_em = now() where id = ${dez}`;
      await sp`select set_config('cmv.permitir_status', 'off', true)`;
      await comoUsuario(sp, U.admin);
      await sp`update public.contagem_itens set quantidade = 2 where contagem_id = ${cont.id}`;
    }, "está fechado");

    console.log("\nSincronização e conflitos");
    const [conf] = await tx`insert into public.conflitos_venda (data, turno, origem, valores_manual, valores_planilha, total_manual, total_planilha, assinatura_planilha)
      values ('2026-12-02', 1, 'restaurante', '{}', '{}', 10, 20, 'x') returning id`;
    await deve(tx, "gestor lê conflitos e sincronizações", async (sp) => {
      await comoUsuario(sp, U.gestor);
      const a = await sp`select id from public.conflitos_venda`;
      const b = await sp`select id from public.sincronizacoes`;
      return [a.length, b.length];
    }, (r) => r[0] >= 1 && r[1] >= 0);
    await deve(tx, "gestor NÃO resolve conflito (0 linhas)", async (sp) => { await comoUsuario(sp, U.gestor); return sp`update public.conflitos_venda set resolucao = 'manter_manual' where id = ${conf.id}`; }, (r) => r.count === 0);
    await naoDeve(tx, "gestor NÃO registra sincronização (só a secret key)", async (sp) => { await comoUsuario(sp, U.gestor); await sp`insert into public.sincronizacoes (competencia, gatilho) values ('2026-12-01', 'manual')`; }, "row-level security");
    await deve(tx, "admin resolve conflito → resolvido_por/em preenchidos e auditado", async (sp) => {
      await comoUsuario(sp, U.admin);
      await sp`update public.conflitos_venda set resolucao = 'manter_manual' where id = ${conf.id}`;
      await sp`reset role`;
      const [c] = await sp`select resolvido_por, resolvido_em from public.conflitos_venda where id = ${conf.id}`;
      const [a] = await sp`select count(*)::int n from public.auditoria where tabela = 'conflitos_venda' and registro_id = ${conf.id}`;
      return { ...c, aud: a.n };
    }, (r) => r.resolvido_por === U.admin && r.resolvido_em !== null && r.aud === 1);
    await naoDeve(tx, "anônimo não lê conflitos", async (sp) => { await comoAnonimo(sp); await sp`select * from public.conflitos_venda`; }, "permission denied");

    console.log("\nTroca de senha");
    await deve(tx, "usuário confirma a troca de senha só no próprio perfil", async (sp) => {
      await sp`update public.perfis set deve_trocar_senha = true where id in (${U.gestor}, ${U.admin})`;
      await comoUsuario(sp, U.gestor);
      await sp`select public.confirmar_troca_senha()`;
      await sp`reset role`;
      return sp`select id, deve_trocar_senha from public.perfis where id in (${U.gestor}, ${U.admin})`;
    }, (r) => r.find((x) => x.id === U.gestor)?.deve_trocar_senha === false && r.find((x) => x.id === U.admin)?.deve_trocar_senha === true);
    await deve(tx, "gestor NÃO altera o próprio perfil diretamente (0 linhas)", async (sp) => { await comoUsuario(sp, U.gestor); return sp`update public.perfis set deve_trocar_senha = false, nome = 'x' where id = ${U.gestor}`; }, (r) => r.count === 0);

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
