import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type DataCivil, competenciaDe, diasNoMes, montar, partes, somarDias } from "./datas";
import { type DiaAtual, diaCompleto } from "./dia-atual";
import { estoqueDoMes } from "./contagem";
import { centavos } from "./dinheiro";
import { type ConfigMes, type FaixaRegua, type PesosSemana, type ResultadoPainel, calcularPainel } from "./engine";
import type { DadosCaixa } from "./alertas";
import type { CategoriaRow, FornecedorRow } from "./tipos";

/** Padrões para um mês que ainda não existe no banco (iguais aos defaults da tabela meses). */
const PADRAO_MES = { meta_venda: "90000", meta_cmv_pct: "0.35", pesos_semana: [6.5, 6.5, 5.5, 5.5], limite_acumulo_pct: "1.25" };

export function fimDoMes(competencia: DataCivil): DataCivil {
  const { ano, mes } = partes(competencia);
  return montar(ano, mes, diasNoMes(ano, mes));
}

export async function listarCategorias(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("categorias_cmv").select("id, nome, slug, pct_meta, ordem, ativa").order("ordem");
  if (error) throw new Error(`categorias: ${error.message}`);
  return (data ?? []) as CategoriaRow[];
}

export async function listarFornecedores(supabase: SupabaseClient, { incluirInativos = false } = {}) {
  let q = supabase.from("fornecedores").select("id, nome, categoria_padrao_id, prazo_vencimento_dias, tipo_padrao, forma_pagamento_padrao, ativo, revisado_em").order("nome");
  if (!incluirInativos) q = q.eq("ativo", true);
  const { data, error } = await q;
  if (error) throw new Error(`fornecedores: ${error.message}`);
  return (data ?? []) as FornecedorRow[];
}

/** Ids dos fornecedores mais usados nos últimos 90 dias (para os botões rápidos). */
export async function fornecedoresMaisUsados(supabase: SupabaseClient, hoje: DataCivil, quantos = 5) {
  const { data } = await supabase
    .from("notas")
    .select("fornecedor_id")
    .eq("status", "ativa")
    .gte("data_emissao", somarDias(hoje, -90))
    .limit(2000);
  const contagem = new Map<string, number>();
  for (const n of data ?? []) contagem.set(n.fornecedor_id, (contagem.get(n.fornecedor_id) ?? 0) + 1);
  return [...contagem.entries()].sort((a, b) => b[1] - a[1]).slice(0, quantos).map(([id]) => id);
}

/** Dados da planilha de caixa para alertas e status da sincronização. */
export async function carregarCaixa(
  supabase: SupabaseClient,
  competencia: DataCivil,
): Promise<DadosCaixa & { ultimaOk: string | null; diaAtual: DiaAtual | null }> {
  const ini = competenciaDe(competencia);
  const fim = fimDoMes(ini);
  const [planilhaQ, ultimaQ, ultimaOkQ, fechQ, catQ, conflitosQ] = await Promise.all([
    supabase.from("meses").select("planilha_url").not("planilha_url", "is", null).lte("competencia", ini).order("competencia", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("sincronizacoes").select("status, iniciado_em, concluido_em, erro").eq("competencia", ini).neq("status", "executando").order("iniciado_em", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("sincronizacoes").select("concluido_em, resumo").eq("competencia", ini).eq("status", "ok").order("iniciado_em", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("fechamento_turno").select("data, despesa_mercado").gte("data", ini).lte("data", fim),
    supabase.from("categorias_cmv").select("id").eq("slug", "mercado").maybeSingle(),
    supabase.from("conflitos_venda").select("id", { count: "exact", head: true }).is("resolucao", null).gte("data", ini).lte("data", fim),
  ]);

  const mercadoPorDia = new Map<string, number>();
  for (const f of fechQ.data ?? []) mercadoPorDia.set(f.data, (mercadoPorDia.get(f.data) ?? 0) + centavos(f.despesa_mercado));
  const diasComMercado = [...mercadoPorDia.entries()].filter(([, v]) => v > 0);
  let comNota = new Set<string>();
  if (diasComMercado.length && catQ.data) {
    const { data } = await supabase
      .from("notas")
      .select("data_emissao")
      .eq("status", "ativa")
      .eq("categoria_id", catQ.data.id)
      .in("data_emissao", diasComMercado.map(([d]) => d));
    comNota = new Set((data ?? []).map((n) => n.data_emissao));
  }

  const resumo = (ultimaOkQ.data?.resumo ?? {}) as Partial<DadosCaixa> & { diaAtual?: DiaAtual | null };
  return {
    planilhaConfigurada: Boolean(planilhaQ.data?.planilha_url),
    ultimaSync: ultimaQ.data ? { status: ultimaQ.data.status, em: ultimaQ.data.concluido_em ?? ultimaQ.data.iniciado_em, mensagem: ultimaQ.data.erro } : null,
    ultimaOk: ultimaOkQ.data?.concluido_em ?? null,
    abasFaltando: resumo.abasFaltando ?? [],
    abasVazias: resumo.abasVazias ?? [],
    divergencias: resumo.divergencias ?? [],
    mercadoSemNota: diasComMercado.filter(([d]) => !comNota.has(d)).map(([data, valor]) => ({ data, valor })).sort((a, b) => a.data.localeCompare(b.data)),
    conflitosPendentes: conflitosQ.count ?? 0,
    diaAtual: resumo.diaAtual ?? null,
  };
}

/** Carrega tudo do mês e roda o motor. */
export async function carregarPainel(
  supabase: SupabaseClient,
  competencia: DataCivil,
  hoje: DataCivil,
): Promise<{
  resultado: ResultadoPainel;
  mes: { id: string | null; status: string; competencia: DataCivil; metaVenda: number; metaCmvPct: number };
  ultimaSincronizacao: string | null;
  ultimaVendaManual: string | null;
  /** totais de hoje por turno, no banco (planilha completa ou lançamento manual) */
  hojeNoBanco: { turno1: number; turno2: number; completo: boolean };
}> {
  const ini = competenciaDe(competencia);
  const fim = fimDoMes(ini);

  const { ano, mes: m } = partes(ini);
  const anterior = montar(m === 1 ? ano - 1 : ano, m === 1 ? 12 : m - 1, 1);
  const [mesQ, pesosQ, categorias, reguaQ, notasQ, vendasQ, fechQ, estoqueQ] = await Promise.all([
    supabase.from("meses").select("*").eq("competencia", ini).maybeSingle(),
    supabase.from("pesos_dia_semana").select("dia_semana, peso").order("dia_semana"),
    listarCategorias(supabase),
    supabase.from("regua_cmv").select("faixa, limite_superior_pct, cor, ordem").order("ordem"),
    supabase.from("notas").select("categoria_id, data_emissao, valor, status").eq("status", "ativa").gte("data_emissao", ini).lte("data_emissao", fim),
    supabase.from("vendas_turno").select("data, turno, total_calculado, fonte, sincronizado_em, atualizado_em").gte("data", ini).lte("data", fim),
    supabase.from("fechamento_turno").select("data, sincronizado_em").gte("data", ini).lte("data", fim),
    // Contagens de fechamento: a do mês anterior é o estoque inicial; a deste mês, o final.
    // Só a finalizada conta (estoqueDoMes descarta rascunho).
    supabase
      .from("contagens")
      .select("status, meses!inner(competencia), contagem_itens(valor)")
      .in("meses.competencia", [anterior, ini]),
  ]);
  for (const q of [mesQ, pesosQ, reguaQ, notasQ, vendasQ, fechQ, estoqueQ]) if (q.error) throw new Error(q.error.message);
  const estoques = ((estoqueQ.data ?? []) as unknown as { status: "rascunho" | "finalizada"; meses: { competencia: string }; contagem_itens: { valor: number }[] }[]).map(
    (e) => ({ competencia: e.meses.competencia, status: e.status, valores: e.contagem_itens.map((i) => i.valor) }),
  );
  const estoqueDe = (comp: string) => estoqueDoMes(estoques, comp, centavos);

  const mes = mesQ.data ?? PADRAO_MES;
  const pesosDiaSemana = Array<number>(7).fill(0);
  for (const p of pesosQ.data ?? []) pesosDiaSemana[p.dia_semana] = Number(p.peso);

  const config: ConfigMes = {
    competencia: ini,
    metaVenda: centavos(mes.meta_venda),
    metaCmvPct: Number(mes.meta_cmv_pct),
    pesosSemana: (mes.pesos_semana as number[]).map(Number) as PesosSemana,
    limiteAcumuloPct: Number(mes.limite_acumulo_pct),
    pesosDiaSemana,
  };

  // Venda por dia = soma dos turnos e origens.
  const porDia = new Map<string, number>();
  for (const v of vendasQ.data ?? []) porDia.set(v.data, (porDia.get(v.data) ?? 0) + centavos(v.total_calculado));

  // Hoje só conta no cálculo com os dois turnos preenchidos.
  const deHoje = (turno: number) =>
    (vendasQ.data ?? []).filter((v) => v.data === hoje && v.turno === turno).reduce((a, v) => a + centavos(v.total_calculado), 0);
  const hojeNoBanco = { turno1: deHoje(1), turno2: deHoje(2), completo: false };
  hojeNoBanco.completo = diaCompleto(hojeNoBanco.turno1, hojeNoBanco.turno2);

  const regua: FaixaRegua[] = (reguaQ.data ?? []).map((r) => ({
    faixa: r.faixa,
    limiteSuperiorPct: r.limite_superior_pct === null ? null : Number(r.limite_superior_pct),
    cor: r.cor,
    ordem: r.ordem,
  }));

  const resultado = calcularPainel({
    config,
    categorias: categorias.filter((c) => c.ativa).map((c) => ({ id: c.id, nome: c.nome, pctMeta: Number(c.pct_meta) })),
    notas: (notasQ.data ?? []).map((n) => ({ categoriaId: n.categoria_id, data: n.data_emissao, valor: centavos(n.valor), status: n.status })),
    vendas: [...porDia.entries()].map(([data, total]) => ({ data, total })),
    // Dia "registrado": tem venda (manual ou planilha) ou aba sincronizada, mesmo que zerada.
    diasComVenda: [...new Set([...porDia.keys(), ...(fechQ.data ?? []).map((f) => f.data)])],
    hoje,
    hojeCompleto: hojeNoBanco.completo,
    regua,
    vendaBaseErp: mesQ.data?.venda_base_erp != null ? centavos(mesQ.data.venda_base_erp) : null,
    estoqueInicial: estoqueDe(anterior),
    estoqueFinal: estoqueDe(ini),
  });

  const maior = (xs: (string | null | undefined)[]) => xs.filter(Boolean).sort().at(-1) ?? null;

  return {
    resultado,
    mes: { id: mesQ.data?.id ?? null, status: mesQ.data?.status ?? "aberto", competencia: ini, metaVenda: config.metaVenda, metaCmvPct: config.metaCmvPct },
    ultimaSincronizacao: maior([...(fechQ.data ?? []).map((f) => f.sincronizado_em), ...(vendasQ.data ?? []).map((v) => v.sincronizado_em)]),
    ultimaVendaManual: maior((vendasQ.data ?? []).filter((v) => v.fonte === "manual").map((v) => v.atualizado_em)),
    hojeNoBanco,
  };
}
