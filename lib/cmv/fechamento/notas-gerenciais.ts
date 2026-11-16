// Notas gerenciais do relatório, geradas a partir dos DADOS (não texto fixo).
// Hoje: o corte de estoque de novembro/2026 (decisão 110). Cada corte registrado diz
// o que foi combinado; o texto final usa a contagem finalizada e as notas com a
// observação de corte que de fato existem no banco.

import { type DataCivil, somarMeses } from "../datas";
import type { Centavos } from "../dinheiro";
import { brl, dataBR, nomeMes } from "./formatos";
import type { ContagemEntrada } from "./tipos";

export type Corte = {
  /** mês que fecha com o corte */
  competencia: DataCivil;
  contagemPrevista: DataCivil;
  /** dia cujas compras vão para o mês seguinte */
  recebimento: DataCivil;
  /** data com que essas compras são lançadas no mês seguinte */
  lancamento: DataCivil;
  decisao: number;
};

export const CORTES: Corte[] = [{ competencia: "2026-11-01", contagemPrevista: "2026-11-29", recebimento: "2026-11-30", lancamento: "2026-12-01", decisao: 110 }];

/** Notas lançadas com a observação de corte (busca sem diferenciar maiúsculas). */
export const RE_OBS_CORTE = /corte de estoque/i;

export type NotaCorte = { data: DataCivil; fornecedor: string; valor: Centavos };

/** Corte que afeta o mês: o do próprio mês (ele fecha com o corte) ou o do mês anterior (ele recebe as compras). */
export function corteDoMes(competencia: DataCivil): { corte: Corte; papel: "fecha" | "recebe" } | null {
  const fecha = CORTES.find((c) => c.competencia === competencia);
  if (fecha) return { corte: fecha, papel: "fecha" };
  const recebe = CORTES.find((c) => somarMeses(c.competencia, 1) === competencia);
  return recebe ? { corte: recebe, papel: "recebe" } : null;
}

const total = (c: ContagemEntrada) => c.itens.reduce((a, i) => a + i.valor, 0);
const resumoNotas = (ns: NotaCorte[]) => `${ns.length} compra(s), ${brl(ns.reduce((a, n) => a + n.valor, 0))}`;

export function notasGerenciais(p: {
  competencia: DataCivil;
  previa: boolean;
  contagemFinal: ContagemEntrada | null;
  contagemInicial: ContagemEntrada | null;
  /** notas com a observação de corte no mês que RECEBE as compras */
  notasCorte: NotaCorte[];
}): string[] {
  const c = corteDoMes(p.competencia);
  if (!c) return [];
  const { corte, papel } = c;
  const mesSeguinte = nomeMes(somarMeses(corte.competencia, 1));
  const previsto =
    `Previsto (decisão ${corte.decisao}): contagem de fechamento em ${dataBR(corte.contagemPrevista)}, após o expediente; ` +
    `compras recebidas em ${dataBR(corte.recebimento)} lançadas em ${mesSeguinte} (data ${dataBR(corte.lancamento)}, observação de corte de estoque).`;
  const ate = p.notasCorte.length ? ` Até agora: ${resumoNotas(p.notasCorte)} com a observação de corte.` : "";

  if (papel === "fecha") {
    const ef = p.contagemFinal?.status === "finalizada" ? p.contagemFinal : null;
    if (p.previa || !ef) return [`Corte de estoque. ${previsto}${ate}`];
    const contagem = `a contagem de fechamento foi feita em ${dataBR(ef.data)} (${brl(total(ef))})${ef.data !== corte.contagemPrevista ? `, e não em ${dataBR(corte.contagemPrevista)} como previsto` : ""}`;
    const compras = p.notasCorte.length
      ? `${resumoNotas(p.notasCorte)} recebidas em ${dataBR(corte.recebimento)} foram lançadas em ${mesSeguinte} com a observação de corte e não entram neste mês`
      : `nenhuma compra com a observação de corte havia sido lançada em ${mesSeguinte} até este fechamento (as compras de ${dataBR(corte.recebimento)} entram em ${mesSeguinte})`;
    return [`Corte de estoque: ${contagem}; ${compras}. As vendas de ${dataBR(corte.recebimento)} ficam neste mês.`];
  }

  // Mês que recebe as compras do corte.
  const ei = p.contagemInicial?.status === "finalizada" ? p.contagemInicial : null;
  if (p.previa || !ei)
    return [`Corte de estoque de ${nomeMes(corte.competencia)}. ${previsto}${ate}${ei ? ` Estoque inicial: contagem de ${dataBR(ei.data)} (${brl(total(ei))}).` : ""}`];
  const compras = p.notasCorte.length
    ? `este mês inclui ${resumoNotas(p.notasCorte)} recebidas em ${dataBR(corte.recebimento)} e lançadas com a observação de corte`
    : `nenhuma compra com a observação de corte foi lançada neste mês`;
  return [
    `Corte de estoque de ${nomeMes(corte.competencia)}: ${compras}. O estoque inicial é a contagem de ${dataBR(ei.data)} (${brl(total(ei))}). ` +
      `O consumo de ${dataBR(corte.recebimento)} sai desse estoque, enquanto as vendas de ${dataBR(corte.recebimento)} ficaram em ${nomeMes(corte.competencia)}.`,
  ];
}
