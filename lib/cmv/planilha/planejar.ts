// =============================================================================
// Planejamento da sincronização — FUNÇÃO PURA (sem banco, sem Google, sem relógio).
// Recebe as abas já lidas e o que existe no banco; devolve o que gravar, os
// conflitos com vendas manuais e os alertas de caixa.
// =============================================================================

import type { AbaLida, CampoPlanilha, Grade, OrigemPlanilha } from "./parser";

export const ORIGENS_PLANILHA: OrigemPlanilha[] = ["restaurante", "oji_tele", "shakai_tele", "wabi_tele"];
export const CAMPOS_PLANILHA: CampoPlanilha[] = ["dinheiro", "credito", "debito", "pix", "loja_dinheiro", "loja_cartao", "online"];

export type Chave = { data: string; turno: 1 | 2; origem: OrigemPlanilha };
export type ValoresVenda = { campos: Record<CampoPlanilha, number>; qtdPedidos: number | null };

export type VendaExistente = Chave & ValoresVenda & { fonte: "manual" | "planilha" };
export type DecisaoManterManual = Chave & { assinatura: string };

export type LinhaVendaPlanilha = Chave & ValoresVenda;
export type FechamentoPlanilha = {
  data: string;
  turno: 1 | 2;
  totalDiaPlanilha: number | null;
  totalPedidos: number | null;
  despesaMercado: number;
  despesaMotoboy: number;
  despesaOutros: number;
  divergencia: number | null;
  bruto: unknown;
};
export type ConflitoNovo = Chave & {
  manual: ValoresVenda;
  planilha: ValoresVenda;
  totalManual: number;
  totalPlanilha: number;
  assinatura: string;
};
export type Divergencia = Chave & { tipo: "total_origem" } & { totalPlanilha: number; totalCalculado: number; diferenca: number };
export type DivergenciaTotalDia = { data: string; turno: 1 | 2; tipo: "total_dia"; totalDia: number; somaOrigens: number; diferenca: number };

export type PlanoSincronizacao = {
  diasLidos: string[];
  gravarVendas: LinhaVendaPlanilha[];
  gravarFechamentos: FechamentoPlanilha[];
  /** vendas manuais idênticas à planilha: passam a ser da planilha, sem conflito */
  conciliadas: Chave[];
  conflitos: ConflitoNovo[];
  /** conflitos em que o admin já decidiu manter a manual e a planilha não mudou */
  conflitosJaDecididos: number;
  abasFaltando: string[];
  abasVazias: string[];
  divergencias: (Divergencia | DivergenciaTotalDia)[];
  avisos: string[];
};

export const totalDe = (v: ValoresVenda) => CAMPOS_PLANILHA.reduce((a, c) => a + (v.campos[c] ?? 0), 0);

/** Impressão digital estável dos valores (para saber se a planilha mudou). */
export function assinatura(v: ValoresVenda): string {
  return [...CAMPOS_PLANILHA.map((c) => `${c}=${v.campos[c] ?? 0}`), `qtd=${v.qtdPedidos ?? ""}`].join(";");
}

/** Valores iguais? (qtd. de pedidos vazia no lançamento manual não conta como diferença) */
export function mesmosValores(manual: ValoresVenda, planilha: ValoresVenda): boolean {
  const camposIguais = CAMPOS_PLANILHA.every((c) => (manual.campos[c] ?? 0) === (planilha.campos[c] ?? 0));
  const qtdIgual = manual.qtdPedidos === null || manual.qtdPedidos === planilha.qtdPedidos;
  return camposIguais && qtdIgual;
}

const chaveStr = (k: Chave) => `${k.data}|${k.turno}|${k.origem}`;

export function planejarSincronizacao(params: {
  /** dias do mês que devem ter aba: do dia 1 até ontem (ou o fim do mês) */
  diasEsperados: string[];
  /** abas diárias lidas, por data */
  lidas: Map<string, { titulo: string; aba: AbaLida; grade: Grade }>;
  existentes: VendaExistente[];
  decisoesManterManual: DecisaoManterManual[];
}): PlanoSincronizacao {
  const existentes = new Map(params.existentes.map((e) => [chaveStr(e), e]));
  const decididos = new Map(params.decisoesManterManual.map((d) => [chaveStr(d), d.assinatura]));

  const plano: PlanoSincronizacao = {
    diasLidos: [],
    gravarVendas: [],
    gravarFechamentos: [],
    conciliadas: [],
    conflitos: [],
    conflitosJaDecididos: 0,
    abasFaltando: [],
    abasVazias: [],
    divergencias: [],
    avisos: [],
  };

  for (const data of params.diasEsperados) {
    const lida = params.lidas.get(data);
    if (!lida) {
      plano.abasFaltando.push(data);
      continue;
    }
    if (lida.aba.vazia) {
      plano.abasVazias.push(data);
      continue;
    }
    plano.diasLidos.push(data);
    for (const a of lida.aba.avisos) plano.avisos.push(`${lida.titulo}: ${a}`);

    for (const t of lida.aba.turnos) {
      for (const origem of ORIGENS_PLANILHA) {
        const o = t.origens[origem];
        const k: Chave = { data, turno: t.turno, origem };
        const planilha: ValoresVenda = { campos: { ...o.campos }, qtdPedidos: o.qtdPedidos };

        if (o.divergencia !== 0 && o.totalPlanilha !== null) {
          plano.divergencias.push({ ...k, tipo: "total_origem", totalPlanilha: o.totalPlanilha, totalCalculado: o.totalCalculado, diferenca: o.divergencia });
        }

        const existente = existentes.get(chaveStr(k));
        if (existente?.fonte === "manual") {
          if (mesmosValores(existente, planilha)) {
            plano.conciliadas.push(k);
            plano.gravarVendas.push({ ...k, ...planilha });
          } else {
            const ass = assinatura(planilha);
            if (decididos.get(chaveStr(k)) === ass) {
              plano.conflitosJaDecididos++;
            } else {
              plano.conflitos.push({
                ...k,
                manual: { campos: existente.campos, qtdPedidos: existente.qtdPedidos },
                planilha,
                totalManual: totalDe(existente),
                totalPlanilha: totalDe(planilha),
                assinatura: ass,
              });
            }
          }
          continue; // venda manual nunca é sobrescrita sem decisão
        }
        plano.gravarVendas.push({ ...k, ...planilha });
      }

      if (t.divergenciaTotalDia) {
        plano.divergencias.push({ data, turno: t.turno, tipo: "total_dia", totalDia: t.totalDia ?? 0, somaOrigens: t.somaOrigens, diferenca: t.divergenciaTotalDia });
      }
      plano.gravarFechamentos.push({
        data,
        turno: t.turno,
        totalDiaPlanilha: t.totalDia,
        totalPedidos: t.totalPedidos,
        despesaMercado: t.despesas.mercado,
        despesaMotoboy: t.despesas.motoboy,
        despesaOutros: t.despesas.outros,
        divergencia: t.divergenciaTotalDia,
        bruto: { aba: lida.titulo, leitura: t, avisos: lida.aba.avisos, grade: lida.grade },
      });
    }
  }
  return plano;
}
