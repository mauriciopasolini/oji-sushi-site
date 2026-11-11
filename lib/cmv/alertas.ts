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

const ROTULO_ORIGEM: Record<string, string> = { restaurante: "Restaurante", oji_tele: "Oji Tele", shakai_tele: "Shakai Tele", wabi_tele: "Wabi Tele" };
const dataBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** Dados da planilha de caixa para os alertas (da última sincronização + fechamentos + notas). */
export type DadosCaixa = {
  planilhaConfigurada: boolean;
  ultimaSync: { status: string; em: string; mensagem?: string | null } | null;
  abasFaltando: string[];
  abasVazias: string[];
  divergencias: {
    data: string;
    turno: number;
    tipo: "total_origem" | "total_dia";
    origem?: string;
    diferenca: number;
    totalPlanilha?: number;
    totalCalculado?: number;
    totalDia?: number;
    somaOrigens?: number;
  }[];
  /** dias com despesa "Mercado" no caixa e nenhuma nota de Mercado lançada na data */
  mercadoSemNota: { data: string; valor: number }[];
  conflitosPendentes: number;
};

function alertasDeCaixa(caixa: DadosCaixa, ehAdmin: boolean): Alerta[] {
  const a: Alerta[] = [];
  if (!caixa.planilhaConfigurada) {
    if (ehAdmin) a.push({ id: "planilha-nao-configurada", nivel: "info", titulo: "Planilha do mês não configurada", detalhe: "Informe o link em Vendas → Planilha do mês.", href: "/painel/cmv/vendas" });
    return a;
  }
  if (caixa.ultimaSync?.status === "erro") {
    a.push({ id: "sync-erro", nivel: "erro", titulo: "A última sincronização com a planilha falhou", detalhe: caixa.ultimaSync.mensagem ?? undefined, href: "/painel/cmv/vendas" });
  }
  if (caixa.conflitosPendentes > 0) {
    a.push({
      id: "conflitos-venda",
      nivel: "aviso",
      titulo: `${caixa.conflitosPendentes} venda(s) manual(is) diferente(s) da planilha`,
      detalhe: ehAdmin ? "Escolha manter a manual ou usar a planilha." : "O administrador precisa decidir qual valor vale.",
      href: "/painel/cmv/vendas#conflitos",
    });
  }
  for (const m of caixa.mercadoSemNota) {
    a.push({
      id: `mercado-sem-nota-${m.data}`,
      nivel: "aviso",
      titulo: `Possível cupom não lançado: Mercado ${formatarBRL(m.valor)} em ${dataBR(m.data)}`,
      detalhe: "O caixa registra despesa de Mercado nesse dia, mas não há nota de Mercado lançada na data.",
      href: "/painel/cmv/notas/nova",
    });
  }
  if (caixa.divergencias.length) {
    const textos = caixa.divergencias.map((d) =>
      d.tipo === "total_origem"
        ? `${dataBR(d.data)} T${d.turno} ${ROTULO_ORIGEM[d.origem ?? ""] ?? d.origem}: Total ${formatarBRL(d.totalPlanilha ?? 0)} × partes ${formatarBRL(d.totalCalculado ?? 0)}`
        : `${dataBR(d.data)} T${d.turno} Total do Dia ${formatarBRL(d.totalDia ?? 0)} × soma ${formatarBRL(d.somaOrigens ?? 0)}`,
    );
    a.push({
      id: "divergencias-planilha",
      nivel: "aviso",
      titulo: `Planilha com ${caixa.divergencias.length} total(is) que não batem com as partes`,
      detalhe: `${textos.slice(0, 3).join(" · ")}${textos.length > 3 ? ` · e mais ${textos.length - 3}` : ""}. O sistema usa a soma das partes.`,
      href: "/painel/cmv/vendas#divergencias",
    });
  }
  if (caixa.abasFaltando.length) {
    a.push({ id: "abas-faltando", nivel: "aviso", titulo: `Planilha sem a aba de ${listarDias(caixa.abasFaltando)}`, href: "/painel/cmv/vendas" });
  }
  if (caixa.abasVazias.length) {
    a.push({ id: "abas-vazias", nivel: "aviso", titulo: `Aba da planilha vazia em ${listarDias(caixa.abasVazias)}`, detalhe: "O caixa desses dias ainda não foi preenchido.", href: "/painel/cmv/vendas" });
  }
  return a;
}

export function gerarAlertas(params: {
  painel: ResultadoPainel;
  ehAdmin: boolean;
  fornecedoresNovos?: number;
  mesFechado?: boolean;
  caixa?: DadosCaixa;
  /** compras ativas do tipo "sem nota (aguardando)", de qualquer mês */
  comprasSemNota?: number;
}): Alerta[] {
  const { painel, ehAdmin, fornecedoresNovos = 0, mesFechado = false, caixa, comprasSemNota = 0 } = params;
  const alertas: Alerta[] = caixa && !mesFechado ? alertasDeCaixa(caixa, ehAdmin) : [];

  if (comprasSemNota > 0) {
    alertas.push({
      id: "compras-sem-nota",
      nivel: "aviso",
      titulo: `${comprasSemNota} compra(s) aguardando nota fiscal`,
      detalhe: "Quando a nota chegar, abra a compra e toque em “A nota fiscal chegou”. O mês só fecha sem pendentes ou com justificativa.",
      href: "/painel/cmv/notas?status=aguardando",
    });
  }

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
    } else if (c.ritmo.desvio > 0 && !c.estouroMes) {
      // Acima do ritmo = comprado no mês passou das semanas encerradas + orçamento inteiro da semana atual.
      alertas.push({
        id: `ritmo-${c.categoriaId}`,
        nivel: "aviso",
        titulo: `${c.nome}: compras acima do ritmo`,
        detalhe: `Comprado ${formatarBRL(c.ritmo.comprado)}; o planejado até o fim desta semana é ${formatarBRL(c.ritmo.esperadoAteFimDaSemana)}.`,
      });
    }
  }

  if (ehAdmin && fornecedoresNovos > 0) {
    alertas.push({
      id: "fornecedores-novos",
      nivel: "info",
      titulo: `${fornecedoresNovos} fornecedor(es) novo(s) cadastrado(s) pelo gestor`,
      detalhe: "Revise nome e categoria, e complete prazo/CNPJ.",
      href: "/painel/cmv/fornecedores?filtro=novos",
    });
  }

  return alertas.sort((a, b) => ORDEM[a.nivel] - ORDEM[b.nivel]);
}
