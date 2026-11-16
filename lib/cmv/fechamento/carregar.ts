import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { carregarCaixa, fimDoMes, listarCategorias } from "../dados";
import { type DataCivil, competenciaDe, somarMeses } from "../datas";
import { milesimos } from "../contagem";
import { centavos } from "../dinheiro";
import type { PesosSemana } from "../engine";
import type { NotaRow } from "../tipos";
import { montarFechamento } from "./montar";
import type { ContagemEntrada, DadosFechamento, EntradaFechamento, HistoricoEntrada, Origem } from "./tipos";

/** Padrões de um mês que ainda não existe no banco (iguais aos defaults da tabela meses). */
const PADRAO = { meta_venda: 90000, meta_cmv_pct: 0.35, pesos_semana: [6.5, 6.5, 5.5, 5.5], limite_acumulo_pct: 1.25 };

type ContagemRow = {
  status: "rascunho" | "finalizada";
  data: string;
  meses: { competencia: string };
  contagem_itens: { quantidade: number; custo_unitario: number; valor: number; itens_contagem: { nome: string; unidade: string; categoria_id: string; ordem: number } }[];
};

export type VersaoFechamento = { versao: number; criadoEm: string; criadoPor: string; vendaBase: number; cmvValor: number; cmvPct: number | null; cmvTipo: string };

export type InfoMes = {
  id: string | null;
  status: "aberto" | "fechado";
  fechadoEm: string | null;
  fechadoPor: string | null;
};

/** Lê do banco tudo o que o fechamento do mês precisa (dados brutos, em centavos). */
export async function carregarEntrada(supabase: SupabaseClient, competencia: DataCivil, hoje: DataCivil): Promise<{ entrada: EntradaFechamento; mes: InfoMes }> {
  const ini = competenciaDe(competencia);
  const fim = fimDoMes(ini);
  const anterior = somarMeses(ini, -1);

  const [mesQ, pesosQ, categorias, reguaQ, notasQ, vendasQ, fechTQ, conflQ, contQ, histQ, fechQ, caixa] = await Promise.all([
    supabase.from("meses").select("*, perfis:fechado_por(nome)").eq("competencia", ini).maybeSingle(),
    supabase.from("pesos_dia_semana").select("dia_semana, peso").order("dia_semana"),
    listarCategorias(supabase),
    supabase.from("regua_cmv").select("faixa, limite_superior_pct, cor, ordem").order("ordem"),
    supabase
      .from("notas")
      .select("id, data_emissao, fornecedor_id, categoria_id, tipo, numero, valor, vencimento, forma_pagamento, conferencia, conferencia_obs, observacao, pendencia_justificativa, fornecedores(nome, revisado_em)")
      .eq("status", "ativa")
      .gte("data_emissao", ini)
      .lte("data_emissao", fim)
      .limit(5000),
    supabase
      .from("vendas_turno")
      .select("data, turno, origem, dinheiro, credito, debito, pix, loja_dinheiro, loja_cartao, online, total_calculado, qtd_pedidos, fonte")
      .gte("data", ini)
      .lte("data", fim)
      .limit(5000),
    supabase.from("fechamento_turno").select("data").gte("data", ini).lte("data", fim),
    supabase.from("conflitos_venda").select("data, turno, origem").is("resolucao", null).gte("data", ini).lte("data", fim),
    supabase
      .from("contagens")
      .select("status, data, meses!inner(competencia), contagem_itens(quantidade, custo_unitario, valor, itens_contagem(nome, unidade, categoria_id, ordem))")
      .eq("tipo", "fechamento")
      .in("meses.competencia", [anterior, ini]),
    supabase.from("historico_mensal").select("competencia, venda, cmv_valor, cmv_pct"),
    // Resumo dos meses fechados (última versão de cada um) para o comparativo.
    supabase.from("fechamentos").select("versao, venda_base, cmv_valor, cmv_pct, meses!inner(competencia, status)").eq("meses.status", "fechado"),
    carregarCaixa(supabase, ini),
  ]);
  for (const q of [mesQ, pesosQ, reguaQ, notasQ, vendasQ, fechTQ, conflQ, contQ, histQ]) if (q.error) throw new Error(q.error.message);
  // fechamentos só existe depois da migração 20261117090000: sem ela, o comparativo usa só o histórico.
  if (fechQ.error && !/fechamentos/.test(fechQ.error.message)) throw new Error(fechQ.error.message);

  const m = mesQ.data ?? PADRAO;
  const pesosDiaSemana = Array<number>(7).fill(0);
  for (const p of pesosQ.data ?? []) pesosDiaSemana[p.dia_semana] = Number(p.peso);

  const contagens = (contQ.data ?? []) as unknown as ContagemRow[];
  const paraContagem = (c: ContagemRow | undefined): ContagemEntrada | null =>
    c
      ? {
          data: c.data,
          status: c.status,
          itens: [...c.contagem_itens]
            .sort((a, b) => a.itens_contagem.ordem - b.itens_contagem.ordem || a.itens_contagem.nome.localeCompare(b.itens_contagem.nome, "pt-BR"))
            .map((i) => ({
              nome: i.itens_contagem.nome,
              unidade: i.itens_contagem.unidade,
              categoriaId: i.itens_contagem.categoria_id,
              quantidade: milesimos(i.quantidade),
              custo: centavos(i.custo_unitario),
              valor: centavos(i.valor),
            })),
        }
      : null;
  const final = paraContagem(contagens.find((c) => c.meses.competencia === ini));
  const inicialRow = contagens.find((c) => c.meses.competencia === anterior && c.status === "finalizada");
  const inicial = paraContagem(inicialRow);

  // Comparativo: histórico manual + última versão de cada mês fechado no sistema.
  const ultimas = new Map<string, { versao: number; venda_base: number; cmv_valor: number; cmv_pct: number | null }>();
  for (const f of (fechQ.data ?? []) as unknown as { versao: number; venda_base: number; cmv_valor: number; cmv_pct: number | null; meses: { competencia: string } }[]) {
    const atual = ultimas.get(f.meses.competencia);
    if (!atual || f.versao > atual.versao) ultimas.set(f.meses.competencia, f);
  }
  const historico: HistoricoEntrada[] = [
    ...(histQ.data ?? []).map((h) => ({
      competencia: h.competencia as string,
      venda: centavos(h.venda),
      cmvValor: h.cmv_valor === null ? null : centavos(h.cmv_valor),
      cmvPct: Number(h.cmv_pct),
      fonte: "historico" as const,
    })),
    ...[...ultimas.entries()]
      .filter(([, f]) => f.cmv_pct !== null)
      .map(([competencia, f]) => ({ competencia, venda: centavos(f.venda_base), cmvValor: centavos(f.cmv_valor), cmvPct: Number(f.cmv_pct), fonte: "sistema" as const })),
  ];

  type NotaComForn = Pick<
    NotaRow,
    "id" | "data_emissao" | "fornecedor_id" | "categoria_id" | "tipo" | "numero" | "valor" | "vencimento" | "forma_pagamento" | "conferencia" | "conferencia_obs" | "observacao" | "pendencia_justificativa"
  > & { fornecedores: { nome: string; revisado_em: string | null } | null };

  const entrada: EntradaFechamento = {
    competencia: ini,
    hoje,
    mes: {
      id: mesQ.data?.id ?? null,
      status: mesQ.data?.status === "fechado" ? "fechado" : "aberto",
      metaVenda: centavos(m.meta_venda),
      metaCmvPct: Number(m.meta_cmv_pct),
      pesosSemana: (m.pesos_semana as number[]).map(Number) as PesosSemana,
      limiteAcumuloPct: Number(m.limite_acumulo_pct),
      vendaBaseErp: mesQ.data?.venda_base_erp != null ? centavos(mesQ.data.venda_base_erp) : null,
    },
    pesosDiaSemana,
    regua: (reguaQ.data ?? []).map((r) => ({ faixa: r.faixa, limiteSuperiorPct: r.limite_superior_pct === null ? null : Number(r.limite_superior_pct), cor: r.cor, ordem: r.ordem })),
    categorias: categorias.filter((c) => c.ativa).map((c) => ({ id: c.id, nome: c.nome, slug: c.slug, pctMeta: Number(c.pct_meta), ordem: c.ordem })),
    notas: ((notasQ.data ?? []) as unknown as NotaComForn[]).map((n) => ({
      id: n.id,
      data: n.data_emissao,
      fornecedorId: n.fornecedor_id,
      fornecedorNome: n.fornecedores?.nome ?? "?",
      fornecedorRevisado: Boolean(n.fornecedores?.revisado_em),
      categoriaId: n.categoria_id,
      tipo: n.tipo,
      numero: n.numero,
      valor: centavos(n.valor),
      vencimento: n.vencimento,
      formaPagamento: n.forma_pagamento,
      conferencia: n.conferencia,
      conferenciaObs: n.conferencia_obs,
      observacao: n.observacao,
      pendenciaJustificativa: n.pendencia_justificativa,
    })),
    vendas: (vendasQ.data ?? []).map((v) => ({
      data: v.data,
      turno: v.turno as 1 | 2,
      origem: v.origem as Origem,
      dinheiro: centavos(v.dinheiro),
      credito: centavos(v.credito),
      debito: centavos(v.debito),
      pix: centavos(v.pix),
      lojaDinheiro: centavos(v.loja_dinheiro),
      lojaCartao: centavos(v.loja_cartao),
      online: centavos(v.online),
      total: centavos(v.total_calculado),
      qtdPedidos: v.qtd_pedidos,
      fonte: v.fonte,
    })),
    diasComFechamentoTurno: [...new Set((fechTQ.data ?? []).map((f) => f.data as string))],
    conflitosPendentes: (conflQ.data ?? []).map((c) => ({ data: c.data, turno: c.turno, origem: c.origem })),
    divergenciasCaixa: caixa.divergencias.map((d) => ({ data: d.data, turno: d.turno, tipo: d.tipo, origem: d.origem, diferenca: d.diferenca })),
    mercadoSemNota: caixa.mercadoSemNota,
    contagemFinal: final,
    contagemInicial: inicial ? { ...inicial, competencia: anterior } : null,
    historico,
  };

  const perfil = (mesQ.data as { perfis?: { nome: string } | null } | null)?.perfis;
  return {
    entrada,
    mes: {
      id: mesQ.data?.id ?? null,
      status: entrada.mes.status,
      fechadoEm: mesQ.data?.fechado_em ?? null,
      fechadoPor: perfil?.nome ?? null,
    },
  };
}

export async function listarVersoes(supabase: SupabaseClient, mesId: string | null): Promise<VersaoFechamento[]> {
  if (!mesId) return [];
  const { data, error } = await supabase
    .from("fechamentos")
    .select("versao, criado_em, venda_base, cmv_valor, cmv_pct, cmv_tipo, perfis:criado_por(nome)")
    .eq("mes_id", mesId)
    .order("versao", { ascending: false });
  if (error) {
    if (/fechamentos/.test(error.message)) return []; // antes da migração 20261117090000
    throw new Error(error.message);
  }
  return ((data ?? []) as unknown as { versao: number; criado_em: string; venda_base: number; cmv_valor: number; cmv_pct: number | null; cmv_tipo: string; perfis: { nome: string } | null }[]).map((f) => ({
    versao: f.versao,
    criadoEm: f.criado_em,
    criadoPor: f.perfis?.nome ?? "?",
    vendaBase: centavos(f.venda_base),
    cmvValor: centavos(f.cmv_valor),
    cmvPct: f.cmv_pct === null ? null : Number(f.cmv_pct),
    cmvTipo: f.cmv_tipo,
  }));
}

/**
 * Dados para o relatório: mês FECHADO → o último snapshot gravado (não muda mais);
 * mês aberto → prévia montada agora com os dados atuais.
 */
export async function dadosDoRelatorio(supabase: SupabaseClient, competencia: DataCivil, hoje: DataCivil): Promise<DadosFechamento> {
  const ini = competenciaDe(competencia);
  const { data: mes } = await supabase.from("meses").select("id, status").eq("competencia", ini).maybeSingle();
  if (mes?.status === "fechado") {
    const { data, error } = await supabase
      .from("fechamentos")
      .select("versao, criado_em, snapshot, perfis:criado_por(nome)")
      .eq("mes_id", mes.id)
      .order("versao", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) {
      const f = data as unknown as { versao: number; criado_em: string; snapshot: DadosFechamento; perfis: { nome: string } | null };
      return { ...f.snapshot, fechamento: { versao: f.versao, fechadoEm: f.criado_em, fechadoPor: f.perfis?.nome ?? "?" } };
    }
  }
  const { entrada } = await carregarEntrada(supabase, ini, hoje);
  return montarFechamento(entrada, { previa: true });
}
