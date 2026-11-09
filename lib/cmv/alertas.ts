// Alertas do painel: função pura sobre o resultado do motor + contagens auxiliares.
// A sincronização com a planilha (Etapa 5) acrescenta os alertas de caixa.

import type { DataCivil } from "./datas";
import { formatarBRL } from "./dinheiro";
import type { ResultadoPainel } from "./engine";

export type NivelAlerta = "erro" | "aviso" | "info";
export type Alerta = { id: string; nivel: NivelAlerta; titulo: string; detalhe?: string; href?: string };

const ORDEM: Record<NivelAlerta, number> = { erro: 0, aviso: 1, info: 2 };

/** "03, 04 e 07/11" */
export function listarDias(dias: DataCivil[], max = 8): string {
  if (!dias.length) return "";
  const mes = dias[0].slice(5, 7);
  const nums = dias.map((d) => d.slice(8, 10));
  const mostrados = nums.slice(0, max);
  const resto = nums.length - mostrados.length;
  const base = mostrados.length > 1 ? `${mostrados.slice(0, -1).join(", ")} e ${mostrados[mostrados.length - 1]}` : mostrados[0];
  return `${base}/${mes}${resto > 0 ? ` (+${resto})` : ""}`;
}

export function gerarAlertas(params: {
  painel: ResultadoPainel;
  ehAdmin: boolean;
  fornecedoresNovos?: number;
  mesFechado?: boolean;
}): Alerta[] {
  const { painel, ehAdmin, fornecedoresNovos = 0, mesFechado = false } = params;
  const alertas: Alerta[] = [];

  if (painel.vendasIncompletas && !mesFechado) {
    alertas.push({
      id: "vendas-incompletas",
      nivel: "aviso",
      titulo: "Dados de venda incompletos: orçamento provisório",
      detalhe: `Sem venda registrada em ${listarDias(painel.diasSemVenda)}. A projeção e os tetos podem mudar quando as vendas entrarem.`,
      href: "/painel/cmv/vendas",
    });
  }

  for (const c of painel.categorias) {
    if (c.estouroMes) {
      alertas.push({
        id: `estouro-mes-${c.categoriaId}`,
        nivel: "erro",
        titulo: `${c.nome}: teto do mês estourado`,
        detalhe: `Comprado ${formatarBRL(c.compradoMes)} para um teto de ${formatarBRL(c.teto)} (${formatarBRL(c.compradoMes - c.teto)} acima).`,
      });
    } else if (c.semSaldo) {
      alertas.push({ id: `sem-saldo-${c.categoriaId}`, nivel: "erro", titulo: `${c.nome}: sem saldo para o resto do mês` });
    }
    if (c.estouroSemana) {
      alertas.push({
        id: `estouro-semana-${c.categoriaId}`,
        nivel: "aviso",
        titulo: `${c.nome}: semana estourada em ${formatarBRL(-c.disponivelAgora)}`,
        detalhe: "O excesso já foi descontado do orçamento das próximas semanas.",
      });
    } else if (c.ritmo.cor === "vermelho" && !c.estouroMes) {
      alertas.push({
        id: `ritmo-${c.categoriaId}`,
        nivel: "aviso",
        titulo: `${c.nome}: compras acima do ritmo`,
        detalhe: `Comprado ${formatarBRL(c.ritmo.comprado)}; o esperado até hoje era ${formatarBRL(c.ritmo.esperadoAteHoje)}.`,
      });
    }
  }

  if (ehAdmin && fornecedoresNovos > 0) {
    alertas.push({
      id: "fornecedores-novos",
      nivel: "info",
      titulo: `${fornecedoresNovos} fornecedor(es) novo(s) cadastrado(s) pelo gestor`,
      detalhe: "Revise nome e categoria, e complete prazo/CNPJ.",
    });
  }

  return alertas.sort((a, b) => ORDEM[a.nivel] - ORDEM[b.nivel]);
}
