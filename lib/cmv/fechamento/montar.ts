// Monta os dados do fechamento (snapshot) a partir da entrada bruta. Função pura:
// usa o mesmo motor do painel (calcularPainel / calcularCmvSemanas), então a prévia,
// o snapshot e o painel batem entre si.

import { type DataCivil, INICIO_SISTEMA, diasDoMes, somarDias, somarMeses } from "../datas";
import type { Centavos } from "../dinheiro";
import { calcularPainel } from "../engine";
import { avaliarChecklist, diasRegistrados } from "./checklist";
import { brl, dataBR, mesCurto, nomeMes } from "./formatos";
import { corteDoMes, notasGerenciais, RE_OBS_CORTE } from "./notas-gerenciais";
import type { Assinatura, BlocoVendas, ContagemEntrada, DadosFechamento, EntradaFechamento, LinhaCategoria, NotaSnapshot, Origem, VendaTurnoEntrada } from "./tipos";

const soma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const totalContagem = (c: Pick<ContagemEntrada, "itens"> | null) => (c ? soma(c.itens.map((i) => i.valor)) : null);
const porCategoria = (c: Pick<ContagemEntrada, "itens">) => {
  const r: Record<string, Centavos> = {};
  for (const i of c.itens) r[i.categoriaId] = (r[i.categoriaId] ?? 0) + i.valor;
  return r;
};

/**
 * Assinatura dos dados que o banco recalcula dentro de fechar_mes: se algo mudou entre
 * montar o snapshot e fechar, o banco recusa. Usa os valores brutos (sem a regra do início
 * do sistema), igual ao SQL.
 */
export function assinaturaDe(e: EntradaFechamento): Assinatura {
  return {
    notas: e.notas.length,
    notasTotal: soma(e.notas.map((n) => n.valor)),
    vendasTotal: soma(e.vendas.map((v) => v.total)),
    erp: e.mes.vendaBaseErp,
    estoqueFinal: e.contagemFinal?.status === "finalizada" ? totalContagem(e.contagemFinal) : null,
    estoqueInicial: e.contagemInicial?.status === "finalizada" ? totalContagem(e.contagemInicial) : null,
  };
}

export function blocoVendas(vendas: VendaTurnoEntrada[]): BlocoVendas {
  const de = (f: (v: VendaTurnoEntrada) => boolean, campo: (v: VendaTurnoEntrada) => number = (v) => v.total) => soma(vendas.filter(f).map(campo));
  const porOrigem = Object.fromEntries(
    (["restaurante", "oji_tele", "shakai_tele", "wabi_tele"] as Origem[]).map((o) => [o, de((v) => v.origem === o)]),
  ) as Record<Origem, Centavos>;
  const rest = vendas.filter((v) => v.origem === "restaurante");
  const teles = vendas.filter((v) => v.origem !== "restaurante");
  const pedidos = (o: Origem) => soma(vendas.filter((v) => v.origem === o).map((v) => v.qtdPedidos ?? 0));
  return {
    total: de(() => true),
    porOrigem,
    porMarca: { oji: porOrigem.oji_tele, shakai: porOrigem.shakai_tele, wabi: porOrigem.wabi_tele },
    porTurno: { 1: de((v) => v.turno === 1), 2: de((v) => v.turno === 2) },
    restaurante: {
      dinheiro: soma(rest.map((v) => v.dinheiro)),
      credito: soma(rest.map((v) => v.credito)),
      debito: soma(rest.map((v) => v.debito)),
      pix: soma(rest.map((v) => v.pix)),
    },
    teles: {
      lojaDinheiro: soma(teles.map((v) => v.lojaDinheiro)),
      lojaCartao: soma(teles.map((v) => v.lojaCartao)),
      online: soma(teles.map((v) => v.online)),
      pedidos: soma(teles.map((v) => v.qtdPedidos ?? 0)),
    },
    pedidosPorMarca: { oji: pedidos("oji_tele"), shakai: pedidos("shakai_tele"), wabi: pedidos("wabi_tele") },
  };
}

/** Texto da base de cálculo, na convenção do DRE Gerencial (base menor, por prudência). */
export function notaDaBase(caixa: Centavos, erp: Centavos | null): string {
  if (erp === null) return `O total do ERP + delivery ainda não foi informado: os percentuais usam o fechamento de caixa (${brl(caixa)}).`;
  if (erp === caixa) return `O fechamento de caixa e o total do ERP + delivery coincidem (${brl(caixa)}).`;
  const dif = Math.abs(caixa - erp);
  if (erp > caixa)
    return `O fechamento de caixa registrou ${brl(caixa)}, enquanto o total do ERP somado ao delivery foi ${brl(erp)}, uma diferença de ${brl(dif)}. Por prudência, os percentuais deste relatório usam a base menor (${brl(caixa)}, o caixa).`;
  return `O total do ERP somado ao delivery foi ${brl(erp)}, enquanto o fechamento de caixa registrou ${brl(caixa)}, uma diferença de ${brl(dif)}. Por prudência, os percentuais deste relatório usam a base menor (${brl(erp)}, o ERP + delivery).`;
}

export function montarFechamento(e: EntradaFechamento, opcoes: { previa: boolean; geradoEm?: string }): DadosFechamento {
  const ini = e.competencia;
  const dias = diasDoMes(ini);
  const fim = dias[dias.length - 1];
  const hojeCalc = e.hoje > fim ? somarDias(fim, 1) : e.hoje;
  const categoriasOrdenadas = [...e.categorias].sort((a, b) => a.ordem - b.ordem);
  const nomeCat = new Map(e.categorias.map((c) => [c.id, c.nome]));
  const ordemCat = new Map(e.categorias.map((c) => [c.id, c.ordem]));

  // Estoque: o inicial só existe a partir do 2º mês do sistema (novembro/2026 não tem).
  const ei =
    e.contagemInicial && e.contagemInicial.status === "finalizada" && e.contagemInicial.competencia >= INICIO_SISTEMA ? e.contagemInicial : null;
  const ef = e.contagemFinal?.status === "finalizada" ? e.contagemFinal : null;

  // Venda por dia (soma de turnos e origens)
  const porDia = new Map<DataCivil, number>();
  for (const v of e.vendas) porDia.set(v.data, (porDia.get(v.data) ?? 0) + v.total);
  const registrados = diasRegistrados(e);

  const painel = calcularPainel({
    config: {
      competencia: ini,
      metaVenda: e.mes.metaVenda,
      metaCmvPct: e.mes.metaCmvPct,
      pesosSemana: e.mes.pesosSemana,
      limiteAcumuloPct: e.mes.limiteAcumuloPct,
      pesosDiaSemana: e.pesosDiaSemana,
    },
    categorias: categoriasOrdenadas.map((c) => ({ id: c.id, nome: c.nome, pctMeta: c.pctMeta })),
    notas: e.notas.map((n) => ({ categoriaId: n.categoriaId, data: n.data, valor: n.valor, status: "ativa" as const })),
    vendas: [...porDia.entries()].map(([data, total]) => ({ data, total })),
    diasComVenda: [...registrados],
    hoje: hojeCalc,
    hojeCompleto: false,
    regua: e.regua,
    vendaBaseErp: e.mes.vendaBaseErp,
    estoqueInicial: totalContagem(ei),
    estoqueFinal: ei ? totalContagem(ef) : null, // sem inicial, o final não é descontado
  });
  const cmv = painel.cmv;
  const base = cmv.vendaBase;
  const fracao = (v: Centavos | null) => (v !== null && base > 0 ? v / base : null);

  // CMV por categoria (linhas do DRE)
  const eiCat = ei ? porCategoria(ei) : {};
  const efCat = ef ? porCategoria(ef) : {};
  const real = cmv.tipo === "real";
  const linhas: LinhaCategoria[] = categoriasOrdenadas.map((c) => {
    const compras = soma(e.notas.filter((n) => n.categoriaId === c.id).map((n) => n.valor));
    const inicial = real ? (eiCat[c.id] ?? 0) : null;
    const final = real ? (efCat[c.id] ?? 0) : null;
    const r = real ? inicial! + compras - final! : null;
    const oficial = r ?? compras;
    return {
      id: c.id,
      nome: c.nome,
      pctMeta: c.pctMeta,
      compras,
      comprasPct: compras > 0 ? fracao(compras) : null,
      estoqueInicial: inicial,
      estoqueFinal: final,
      real: r,
      realPct: fracao(r),
      cmv: oficial,
      cmvPct: real || compras > 0 ? fracao(oficial) : null,
    };
  });
  const valorCmv = cmv.cmvReal ?? cmv.compras;

  // Variação contra o mês anterior (sistema tem prioridade sobre o histórico manual)
  const compAnterior = somarMeses(ini, -1);
  const doAnterior = (fonte: "sistema" | "historico") => e.historico.find((h) => h.competencia === compAnterior && h.fonte === fonte);
  const ant = doAnterior("sistema") ?? doAnterior("historico") ?? null;

  // Notas do snapshot
  const notas: NotaSnapshot[] = e.notas
    .map((n) => ({
      id: n.id,
      data: n.data,
      fornecedor: n.fornecedorNome,
      categoriaId: n.categoriaId,
      categoria: nomeCat.get(n.categoriaId) ?? "?",
      tipo: n.tipo,
      numero: n.numero,
      valor: n.valor,
      vencimento: n.vencimento,
      formaPagamento: n.formaPagamento,
      conferencia: n.conferencia,
      conferenciaObs: n.conferenciaObs,
      observacao: n.observacao,
      pendenciaJustificativa: n.pendenciaJustificativa,
    }))
    .sort(
      (a, b) =>
        (ordemCat.get(a.categoriaId) ?? 0) - (ordemCat.get(b.categoriaId) ?? 0) ||
        a.data.localeCompare(b.data) ||
        a.fornecedor.localeCompare(b.fornecedor, "pt-BR") ||
        a.valor - b.valor,
    );

  // Ranking de fornecedores
  const porForn = new Map<string, { nome: string; notas: number; total: number }>();
  for (const n of e.notas) {
    const f = porForn.get(n.fornecedorId) ?? { nome: n.fornecedorNome, notas: 0, total: 0 };
    f.notas++;
    f.total += n.valor;
    porForn.set(n.fornecedorId, f);
  }
  const fornecedores = [...porForn.values()]
    .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, "pt-BR"))
    .map((f) => ({ ...f, pct: cmv.compras > 0 ? f.total / cmv.compras : 0 }));

  // Estoque: nota explicativa
  const proximo = somarMeses(ini, 1);
  let notaEstoque: string | null = null;
  if (!real) {
    if (ini === INICIO_SISTEMA)
      notaEstoque = ef
        ? `${mesCurto(ini)} é o primeiro mês do sistema e não tem estoque inicial: o mês fecha com o CMV de compras. O estoque final (contagem de ${dataBR(ef.data)}, ${brl(totalContagem(ef)!)}) aparece aqui, mas não é descontado; ele será o estoque inicial de ${nomeMes(proximo)}.`
        : `${mesCurto(ini)} é o primeiro mês do sistema e não tem estoque inicial: o mês fecha com o CMV de compras. A contagem de fechamento ainda não foi finalizada.`;
    else if (!ei) notaEstoque = `CMV de compras: sem contagem de estoque inicial finalizada (fechamento de ${nomeMes(compAnterior)}).`;
    else notaEstoque = "CMV de compras: a contagem de fechamento deste mês ainda não foi finalizada.";
  }

  // Histórico: 5 meses anteriores + o atual
  const anteriores: DadosFechamento["historico"] = [];
  for (let k = 5; k >= 1; k--) {
    const comp = somarMeses(ini, -k);
    const h = e.historico.find((x) => x.competencia === comp && x.fonte === "sistema") ?? e.historico.find((x) => x.competencia === comp && x.fonte === "historico");
    // Histórico que só tem o %: o CMV em R$ é calculado (venda × %) e marcado como tal.
    if (h) anteriores.push(h.cmvValor === null ? { ...h, cmvValor: Math.round(h.venda * h.cmvPct), cmvCalculado: true } : h);
  }
  const pctOficial = cmv.cmvPct;
  const historico = [...anteriores, ...(pctOficial !== null ? [{ competencia: ini, venda: base, cmvValor: valorCmv, cmvPct: pctOficial, fonte: "sistema" as const }] : [])];

  const comNota = (n: NotaSnapshot) => n;
  const semNota = notas.filter((n) => n.tipo === "sem_nota").map(comNota);
  const divergentes = notas.filter((n) => n.conferencia === "divergente");
  const observacoes = notas.filter((n) => n.tipo !== "sem_nota" && n.observacao?.trim());

  return {
    formato: 1,
    competencia: ini,
    previa: opcoes.previa,
    geradoEm: opcoes.geradoEm ?? new Date().toISOString(),
    hoje: e.hoje,
    fechamento: null,
    config: { metaVenda: e.mes.metaVenda, metaCmvPct: e.mes.metaCmvPct, pesosSemana: e.mes.pesosSemana, limiteAcumuloPct: e.mes.limiteAcumuloPct },
    regua: e.regua,
    categorias: categoriasOrdenadas.map((c) => ({ id: c.id, nome: c.nome, pctMeta: c.pctMeta })),
    vendas: {
      ...blocoVendas(e.vendas),
      porDia: dias
        .filter((d) => d < hojeCalc)
        .map((d) => {
          const doDia = e.vendas.filter((v) => v.data === d);
          const fontes = new Set(doDia.map((v) => v.fonte));
          const total = soma(doDia.map((v) => v.total));
          return {
            data: d,
            turno1: soma(doDia.filter((v) => v.turno === 1).map((v) => v.total)),
            turno2: soma(doDia.filter((v) => v.turno === 2).map((v) => v.total)),
            total,
            semMovimento: registrados.has(d) && total === 0,
            fonte: fontes.size === 0 ? null : fontes.size > 1 ? ("misto" as const) : [...fontes][0],
          };
        }),
      diasSemVenda: dias.filter((d) => d < hojeCalc && !registrados.has(d)),
    },
    base: {
      caixa: cmv.vendaCaixa,
      erp: cmv.vendaBaseErp,
      base,
      divergencia: cmv.divergenciaBase,
      origem: cmv.vendaBaseErp === null ? "sem_erp" : cmv.vendaBaseErp < cmv.vendaCaixa ? "erp" : "caixa",
      nota: notaDaBase(cmv.vendaCaixa, cmv.vendaBaseErp),
    },
    cmv: {
      tipo: cmv.tipo,
      compras: cmv.compras,
      comprasPct: cmv.cmvComprasPct,
      real: cmv.cmvReal,
      realPct: cmv.cmvRealPct,
      valor: valorCmv,
      pct: pctOficial,
      faixa: cmv.faixa,
      metaPct: e.mes.metaCmvPct,
      metaValor: Math.round(base * e.mes.metaCmvPct),
      porCategoria: linhas,
    },
    variacao: {
      anterior: ant ? { competencia: ant.competencia, venda: ant.venda, cmvPct: ant.cmvPct } : null,
      // Venda de mês em andamento não se compara com mês inteiro.
      venda: ant && ant.venda > 0 && e.hoje > fim ? base / ant.venda - 1 : null,
      cmv: ant && pctOficial !== null ? pctOficial - ant.cmvPct : null,
    },
    cmvSemanas: painel.cmvSemanas,
    planejadoComprado: painel.categorias.map((c) => ({
      categoriaId: c.categoriaId,
      categoria: c.nome,
      teto: c.teto,
      semanas: c.semanas.map((s) => ({ numero: s.numero, inicio: s.inicio, fim: s.fim, planejado: s.planejadoOriginal, comprado: s.comprado })),
    })),
    estoque: {
      inicial: ei ? { competencia: e.contagemInicial!.competencia, data: ei.data, valor: totalContagem(ei)!, porCategoria: eiCat } : null,
      final: ef ? { data: ef.data, valor: totalContagem(ef)!, porCategoria: efCat, itens: ef.itens } : null,
      descontado: real,
      nota: notaEstoque,
    },
    fornecedores,
    notas,
    alertas: {
      divergenciasCaixa: e.divergenciasCaixa,
      mercadoSemNota: e.mercadoSemNota,
      semNota,
      divergentes,
      observacoes,
      conflitosPendentes: e.conflitosPendentes.length,
    },
    notasGerenciais: notasGerenciais({
      competencia: ini,
      previa: opcoes.previa,
      contagemFinal: e.contagemFinal,
      contagemInicial: ei,
      notasCorte:
        corteDoMes(ini)?.papel === "recebe"
          ? e.notas.filter((n) => RE_OBS_CORTE.test(n.observacao ?? "")).map((n) => ({ data: n.data, fornecedor: n.fornecedorNome, valor: n.valor }))
          : e.notasCorteMesSeguinte,
    }),
    historico,
    dre: [
      { linha: "RECEITA (base de cálculo)", valor: base, pct: base > 0 ? 1 : null, nivel: 0 },
      { linha: "(–) CMV — Custo da Mercadoria Vendida", valor: valorCmv, pct: pctOficial, nivel: 0 },
      ...linhas.map((l) => ({ linha: l.nome, valor: l.cmv, pct: fracao(l.cmv), nivel: 1 as const })),
    ],
    checklist: avaliarChecklist(e),
    assinatura: assinaturaDe(e),
  };
}
