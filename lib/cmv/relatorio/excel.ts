import "server-only";
// Excel do fechamento: abas tabulares (uma linha de cabeçalho, sem células mescladas),
// valores numéricos de verdade (R$ com 2 casas, % como fração), datas como data.
// Abas: Resumo, CMV por categoria, CMV por semana, Notas, Vendas diárias, Contagem,
// Fornecedores, Histórico e "Para o DRE".

import ExcelJS from "exceljs";
import { classificarRegua } from "../engine";
import type { DadosFechamento } from "../fechamento/tipos";
import { mesCurto, ROTULO_CONF, ROTULO_FORMA, ROTULO_TIPO, tituloMes } from "../fechamento/formatos";
import { RODAPE_PZO } from "./constantes";

const FMT_BRL = '#,##0.00;[Red]-#,##0.00';
const FMT_PCT = "0.0%";
const FMT_DATA = "dd/mm/yyyy";
const COR_CABECALHO = "FF111110";

type TipoColuna = "texto" | "brl" | "pct" | "data" | "int" | "qtd";
type Col = { titulo: string; largura: number; tipo?: TipoColuna };

const reais = (c: number | null | undefined) => (c === null || c === undefined ? null : Math.round(c) / 100);
/** "AAAA-MM-DD" → Date em UTC (o Excel mostra a data civil, sem fuso) */
const data = (d: string | null | undefined) => (d ? new Date(`${d}T00:00:00Z`) : null);

function aba(wb: ExcelJS.Workbook, nome: string, colunas: Col[], linhas: (string | number | Date | null)[][]) {
  const ws = wb.addWorksheet(nome, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = colunas.map((c) => ({ header: c.titulo, width: c.largura }));
  const cab = ws.getRow(1);
  cab.font = { bold: true, color: { argb: "FFFFFFFF" } };
  cab.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COR_CABECALHO } };
  cab.alignment = { vertical: "middle" };
  for (const l of linhas) ws.addRow(l);
  colunas.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.tipo === "brl") col.numFmt = FMT_BRL;
    if (c.tipo === "pct") col.numFmt = FMT_PCT;
    if (c.tipo === "data") col.numFmt = FMT_DATA;
    if (c.tipo === "qtd") col.numFmt = "#,##0.###";
    if (c.tipo === "brl" || c.tipo === "pct" || c.tipo === "int" || c.tipo === "qtd") col.alignment = { horizontal: "right" };
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colunas.length } };
  return ws;
}

export async function gerarExcel(d: DadosFechamento): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PZO";
  wb.company = "Oji Comércio de Alimentos";
  wb.title = `Controladoria Oji · Fechamento de CMV — ${tituloMes(d.competencia)}`;
  wb.created = new Date(d.geradoEm);
  const nomeCat = new Map(d.categorias.map((c) => [c.id, c.nome]));
  const real = d.cmv.tipo === "real";

  // Resumo: pares indicador/valor (tabular, 3 colunas)
  const resumo: (string | number | Date | null)[][] = [
    ["Ferramenta", "Controladoria Oji", null],
    ["Empresa", "Oji Comércio de Alimentos · Oji · Shakai · Wabi", null],
    ["Relatório", "Fechamento de CMV", null],
    ["Mês", mesCurto(d.competencia), null],
    ["Situação", d.previa ? "PRÉVIA (mês aberto: os valores podem mudar)" : `Fechado${d.fechamento ? ` em ${new Date(d.fechamento.fechadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} por ${d.fechamento.fechadoPor} (versão ${d.fechamento.versao})` : ""}`, null],
    ["Dados de", new Date(d.geradoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }), null],
    ["Venda do caixa (R$)", reais(d.base.caixa), null],
    ["Total ERP + delivery (R$)", reais(d.base.erp), null],
    ["Diferença caixa − ERP (R$)", reais(d.base.divergencia), null],
    ["Venda base de cálculo (R$)", reais(d.base.base), "a menor entre caixa e ERP"],
    ["Tipo de CMV", real ? "Real (estoque inicial + compras − estoque final)" : "De compras", null],
    ["CMV (R$)", reais(d.cmv.valor), null],
    ["CMV (%)", d.cmv.pct, null],
    ["Faixa da régua", d.cmv.faixa?.faixa ?? null, null],
    ["Meta de CMV (%)", d.cmv.metaPct, null],
    ["Meta de CMV (R$)", reais(d.cmv.metaValor), null],
    ["Compras do mês (R$)", reais(d.cmv.compras), null],
    ["CMV de compras (%)", d.cmv.comprasPct, "comparável com o histórico"],
    ["Estoque inicial (R$)", reais(d.estoque.inicial?.valor), d.estoque.inicial ? `contagem de ${d.estoque.inicial.data.split("-").reverse().join("/")}` : null],
    ["Estoque final (R$)", reais(d.estoque.final?.valor), d.estoque.final ? `contagem de ${d.estoque.final.data.split("-").reverse().join("/")}${d.estoque.descontado ? "" : " (não descontado)"}` : null],
    ["CMV real (R$)", reais(d.cmv.real), null],
    ["CMV real (%)", d.cmv.realPct, null],
    ["Mês anterior", d.variacao.anterior ? mesCurto(d.variacao.anterior.competencia) : null, null],
    ["Variação da venda", d.variacao.venda, null],
    ["Variação do CMV (p.p.)", d.variacao.cmv === null ? null : Math.round(d.variacao.cmv * 1000) / 10, "pontos percentuais"],
    ["Notas no mês", d.notas.length, null],
    ["Nota da base de cálculo", d.base.nota, null],
    ...(d.estoque.nota ? [["Nota do estoque", d.estoque.nota, null] as (string | null)[]] : []),
    ...d.notasGerenciais.map((t) => ["Nota gerencial", t, null] as (string | null)[]),
    ["", RODAPE_PZO, null],
  ];
  const wsResumo = aba(wb, "Resumo", [{ titulo: "Indicador", largura: 30 }, { titulo: "Valor", largura: 60 }, { titulo: "Observação", largura: 40 }], resumo);
  wsResumo.eachRow((row, i) => {
    if (i === 1) return;
    const rotulo = String(row.getCell(1).value ?? "");
    const cel = row.getCell(2);
    if (/\(R\$\)/.test(rotulo)) cel.numFmt = FMT_BRL;
    else if (/\(%\)|^Variação da venda/.test(rotulo)) cel.numFmt = FMT_PCT;
    cel.alignment = typeof cel.value === "number" ? { horizontal: "right" } : { wrapText: true, vertical: "top" };
  });

  aba(
    wb,
    "CMV por categoria",
    [
      { titulo: "Categoria", largura: 26 },
      { titulo: "Meta (%)", largura: 10, tipo: "pct" },
      { titulo: "Compras (R$)", largura: 15, tipo: "brl" },
      { titulo: "Compras (%)", largura: 12, tipo: "pct" },
      { titulo: "Estoque inicial (R$)", largura: 18, tipo: "brl" },
      { titulo: "Estoque final (R$)", largura: 18, tipo: "brl" },
      { titulo: "CMV real (R$)", largura: 15, tipo: "brl" },
      { titulo: "CMV real (%)", largura: 12, tipo: "pct" },
      { titulo: "CMV oficial (R$)", largura: 16, tipo: "brl" },
      { titulo: "CMV oficial (%)", largura: 14, tipo: "pct" },
    ],
    [
      ...d.cmv.porCategoria.map((l) => [l.nome, l.pctMeta, reais(l.compras), l.comprasPct, reais(l.estoqueInicial), reais(l.estoqueFinal), reais(l.real), l.realPct, reais(l.cmv), l.cmvPct]),
      ["Total", d.cmv.metaPct, reais(d.cmv.compras), d.cmv.comprasPct, reais(d.estoque.inicial && real ? d.estoque.inicial.valor : null), reais(d.estoque.final && real ? d.estoque.final.valor : null), reais(d.cmv.real), d.cmv.realPct, reais(d.cmv.valor), d.cmv.pct],
    ],
  );

  // CMV por semana + planejado × comprado (uma linha por semana e categoria)
  const linhasSemana: (string | number | Date | null)[][] = [];
  for (const w of d.cmvSemanas.semanas) {
    for (const c of d.categorias) {
      const plano = d.planejadoComprado.find((p) => p.categoriaId === c.id)?.semanas.find((x) => x.numero === w.numero);
      linhasSemana.push([`S${w.numero}`, data(w.inicio), data(w.fim), w.situacao, c.nome, reais(w.venda), reais(plano?.planejado ?? null), reais(w.comprasPorCategoria[c.id] ?? 0), w.pctPorCategoria[c.id] ?? null]);
    }
    linhasSemana.push([`S${w.numero}`, data(w.inicio), data(w.fim), w.situacao, "Total", reais(w.venda), reais(d.planejadoComprado.reduce((a, p) => a + (p.semanas.find((x) => x.numero === w.numero)?.planejado ?? 0), 0)), reais(w.compras), w.pct]);
  }
  const ac = d.cmvSemanas.acumulado;
  if (ac) linhasSemana.push([`Acumulado (S${ac.semanas.join(", S")})`, null, null, "fechadas", "Total", reais(ac.venda), null, reais(ac.compras), ac.pct]);
  aba(
    wb,
    "CMV por semana",
    [
      { titulo: "Semana", largura: 18 },
      { titulo: "Início", largura: 12, tipo: "data" },
      { titulo: "Fim", largura: 12, tipo: "data" },
      { titulo: "Situação", largura: 18 },
      { titulo: "Categoria", largura: 26 },
      { titulo: "Venda da semana (R$)", largura: 20, tipo: "brl" },
      { titulo: "Planejado original (R$)", largura: 22, tipo: "brl" },
      { titulo: "Comprado (R$)", largura: 16, tipo: "brl" },
      { titulo: "CMV da semana (%)", largura: 18, tipo: "pct" },
    ],
    linhasSemana,
  );

  aba(
    wb,
    "Notas",
    [
      { titulo: "Data", largura: 12, tipo: "data" },
      { titulo: "Categoria", largura: 24 },
      { titulo: "Fornecedor", largura: 30 },
      { titulo: "Tipo", largura: 11 },
      { titulo: "Número", largura: 14 },
      { titulo: "Valor (R$)", largura: 14, tipo: "brl" },
      { titulo: "Vencimento", largura: 12, tipo: "data" },
      { titulo: "Pagamento", largura: 12 },
      { titulo: "Conferência", largura: 13 },
      { titulo: "Obs. da conferência", largura: 36 },
      { titulo: "Observação", largura: 40 },
      { titulo: "Justificativa (sem nota)", largura: 36 },
      { titulo: "Id", largura: 38 },
    ],
    d.notas.map((n) => [
      data(n.data),
      n.categoria,
      n.fornecedor,
      ROTULO_TIPO[n.tipo] ?? n.tipo,
      n.numero,
      reais(n.valor),
      data(n.vencimento),
      ROTULO_FORMA[n.formaPagamento] ?? n.formaPagamento,
      ROTULO_CONF[n.conferencia],
      n.conferenciaObs,
      n.observacao,
      n.pendenciaJustificativa,
      n.id,
    ]),
  );

  aba(
    wb,
    "Vendas diárias",
    [
      { titulo: "Data", largura: 12, tipo: "data" },
      { titulo: "Turno 1 (R$)", largura: 14, tipo: "brl" },
      { titulo: "Turno 2 (R$)", largura: 14, tipo: "brl" },
      { titulo: "Total (R$)", largura: 14, tipo: "brl" },
      { titulo: "Situação", largura: 16 },
      { titulo: "Fonte", largura: 12 },
    ],
    d.vendas.porDia.map((v) => [data(v.data), reais(v.turno1), reais(v.turno2), reais(v.total), d.vendas.diasSemVenda.includes(v.data) ? "sem venda registrada" : v.semMovimento ? "sem movimento" : "registrado", v.fonte]),
  );

  const itens = d.estoque.final?.itens ?? [];
  aba(
    wb,
    "Contagem",
    [
      { titulo: "Contagem", largura: 14 },
      { titulo: "Data", largura: 12, tipo: "data" },
      { titulo: "Item", largura: 34 },
      { titulo: "Categoria", largura: 24 },
      { titulo: "Unidade", largura: 9 },
      { titulo: "Quantidade", largura: 12, tipo: "qtd" },
      { titulo: "Custo unitário (R$)", largura: 18, tipo: "brl" },
      { titulo: "Valor (R$)", largura: 14, tipo: "brl" },
    ],
    itens.map((i) => ["Estoque final", data(d.estoque.final!.data), i.nome, nomeCat.get(i.categoriaId) ?? "?", i.unidade, i.quantidade / 1000, reais(i.custo), reais(i.valor)]),
  );

  aba(
    wb,
    "Fornecedores",
    [
      { titulo: "Posição", largura: 9, tipo: "int" },
      { titulo: "Fornecedor", largura: 34 },
      { titulo: "Notas", largura: 9, tipo: "int" },
      { titulo: "Total (R$)", largura: 15, tipo: "brl" },
      { titulo: "% das compras", largura: 14, tipo: "pct" },
    ],
    d.fornecedores.map((f, i) => [i + 1, f.nome, f.notas, reais(f.total), f.pct]),
  );

  aba(
    wb,
    "Histórico",
    [
      { titulo: "Mês", largura: 16 },
      { titulo: "Competência", largura: 12, tipo: "data" },
      { titulo: "Venda base (R$)", largura: 16, tipo: "brl" },
      { titulo: "CMV (R$)", largura: 14, tipo: "brl" },
      { titulo: "CMV (%)", largura: 10, tipo: "pct" },
      { titulo: "CMV em R$ calculado", largura: 20 },
      { titulo: "Faixa da régua", largura: 14 },
      { titulo: "Origem", largura: 22 },
    ],
    d.historico.map((h) => [
      mesCurto(h.competencia),
      data(h.competencia),
      reais(h.venda),
      reais(h.cmvValor),
      h.cmvPct,
      h.cmvCalculado ? "sim (venda × %)" : "não",
      classificarRegua(h.cmvPct, d.regua)?.faixa ?? null,
      h.competencia === d.competencia ? (d.previa ? "este mês (prévia)" : "este fechamento") : h.fonte === "sistema" ? "sistema" : "DRE (histórico manual)",
    ]),
  );

  aba(
    wb,
    "Para o DRE",
    [
      { titulo: "Descrição", largura: 42 },
      { titulo: "Valor (R$)", largura: 16, tipo: "brl" },
      { titulo: "% s/ venda", largura: 12, tipo: "pct" },
    ],
    [
      ...d.dre.map((l) => [l.nivel === 1 ? `   ${l.linha}` : l.linha, reais(l.valor), l.pct]),
      [real ? "CMV real (estoque inicial + compras − estoque final)" : "CMV de compras (sem estoque inicial)", null, null],
      [`Base: ${d.base.origem === "erp" ? "ERP + delivery" : "fechamento de caixa"} (a menor)`, null, null],
    ],
  );

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
