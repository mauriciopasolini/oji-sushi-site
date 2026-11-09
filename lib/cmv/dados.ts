import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type DataCivil, competenciaDe, diasNoMes, montar, partes, somarDias } from "./datas";
import { centavos } from "./dinheiro";
import { type ConfigMes, type FaixaRegua, type PesosSemana, type ResultadoPainel, calcularPainel } from "./engine";
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
  let q = supabase.from("fornecedores").select("id, nome, categoria_padrao_id, prazo_vencimento_dias, ativo, revisado_em").order("nome");
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

/** Carrega tudo do mês e roda o motor. */
export async function carregarPainel(
  supabase: SupabaseClient,
  competencia: DataCivil,
  hoje: DataCivil,
): Promise<{
  resultado: ResultadoPainel;
  mes: { id: string | null; status: string; competencia: DataCivil; metaVenda: number };
  ultimaSincronizacao: string | null;
  ultimaVendaManual: string | null;
}> {
  const ini = competenciaDe(competencia);
  const fim = fimDoMes(ini);

  const [mesQ, pesosQ, categorias, reguaQ, notasQ, vendasQ, fechQ] = await Promise.all([
    supabase.from("meses").select("*").eq("competencia", ini).maybeSingle(),
    supabase.from("pesos_dia_semana").select("dia_semana, peso").order("dia_semana"),
    listarCategorias(supabase),
    supabase.from("regua_cmv").select("faixa, limite_superior_pct, cor, ordem").order("ordem"),
    supabase.from("notas").select("categoria_id, data_emissao, valor, status").eq("status", "ativa").gte("data_emissao", ini).lte("data_emissao", fim),
    supabase.from("vendas_turno").select("data, total_calculado, fonte, sincronizado_em, atualizado_em").gte("data", ini).lte("data", fim),
    supabase.from("fechamento_turno").select("data, sincronizado_em").gte("data", ini).lte("data", fim),
  ]);
  for (const q of [mesQ, pesosQ, reguaQ, notasQ, vendasQ, fechQ]) if (q.error) throw new Error(q.error.message);

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
    regua,
    vendaBaseErp: mesQ.data?.venda_base_erp != null ? centavos(mesQ.data.venda_base_erp) : null,
  });

  const maior = (xs: (string | null | undefined)[]) => xs.filter(Boolean).sort().at(-1) ?? null;

  return {
    resultado,
    mes: { id: mesQ.data?.id ?? null, status: mesQ.data?.status ?? "aberto", competencia: ini, metaVenda: config.metaVenda },
    ultimaSincronizacao: maior([...(fechQ.data ?? []).map((f) => f.sincronizado_em), ...(vendasQ.data ?? []).map((v) => v.sincronizado_em)]),
    ultimaVendaManual: maior((vendasQ.data ?? []).filter((v) => v.fonte === "manual").map((v) => v.atualizado_em)),
  };
}
