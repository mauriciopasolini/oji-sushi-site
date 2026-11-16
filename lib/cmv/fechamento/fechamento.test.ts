import { describe, expect, it } from "vitest";
import { formatarBRL } from "../dinheiro";
import { avaliarChecklist, checklistCompleto } from "./checklist";
import { assinaturaDe, montarFechamento, notaDaBase } from "./montar";
import { CAT, contagem, entradaBase, nota, venda } from "./exemplo";
import type { EntradaFechamento } from "./tipos";

const porId = (e: EntradaFechamento) => Object.fromEntries(avaliarChecklist(e).map((i) => [i.id, i]));

describe("checklist bloqueante", () => {
  it("mês pronto: os 7 itens ok", () => {
    const itens = avaliarChecklist(entradaBase("2027-01-01", "2027-02-01"));
    expect(itens.map((i) => i.id)).toEqual(["mes_encerrado", "vendas", "contagem", "conferencia", "sem_nota", "fornecedores", "erp"]);
    expect(itens.filter((i) => !i.ok)).toEqual([]);
    expect(checklistCompleto(itens)).toBe(true);
  });

  it("mês ainda não terminou (último dia é hoje) bloqueia", () => {
    const e = entradaBase("2027-01-01", "2027-01-31");
    expect(porId(e).mes_encerrado.ok).toBe(false);
    expect(checklistCompleto(avaliarChecklist(e))).toBe(false);
  });

  it("dia sem venda bloqueia e lista o dia; 'sem movimento' (linha zerada) ou aba sincronizada contam como registrado", () => {
    const e = entradaBase("2027-01-01", "2027-02-01");
    e.vendas = e.vendas.filter((v) => v.data !== "2027-01-12" && v.data !== "2027-01-13" && v.data !== "2027-01-14");
    let it = porId(e).vendas;
    expect(it.ok).toBe(false);
    expect(it.resumo).toContain("3 dia(s) sem venda registrada: 12, 13 e 14/01");
    expect(it.href).toBe("/painel/cmv/vendas?mes=2027-01");
    e.vendas.push(venda("2027-01-12", 0)); // sem movimento
    e.diasComFechamentoTurno.push("2027-01-13", "2027-01-14"); // aba sincronizada
    it = porId(e).vendas;
    expect(it.ok).toBe(true);
  });

  it("conflito de venda pendente bloqueia as vendas", () => {
    const e = entradaBase("2027-01-01", "2027-02-01");
    e.conflitosPendentes = [{ data: "2027-01-05", turno: 2, origem: "restaurante" }];
    expect(porId(e).vendas.ok).toBe(false);
    expect(porId(e).vendas.detalhes).toEqual(["Conflito em 05/01, turno 2"]);
  });

  it("contagem ausente ou em rascunho bloqueia", () => {
    const e = entradaBase("2027-01-01", "2027-02-01");
    e.contagemFinal = { ...e.contagemFinal!, status: "rascunho" };
    expect(porId(e).contagem.ok).toBe(false);
    expect(porId(e).contagem.resumo).toMatch(/rascunho/);
    e.contagemFinal = null;
    expect(porId(e).contagem.resumo).toMatch(/não foi iniciada/);
    expect(porId(e).contagem.href).toBe("/painel/cmv/contagem?mes=2027-01");
  });

  it("nota pendente de conferência bloqueia; divergente (com observação) não", () => {
    const e = entradaBase("2027-01-01", "2027-02-01");
    e.notas[0].conferencia = "divergente";
    e.notas[0].conferenciaObs = "valor diferente da foto";
    expect(porId(e).conferencia.ok).toBe(true);
    e.notas[1].conferencia = "pendente";
    const it = porId(e).conferencia;
    expect(it.ok).toBe(false);
    expect(it.detalhes).toEqual([`10/01 · Frumar · ${formatarBRL(1_000_000)}`]);
    expect(it.href).toBe("/painel/cmv/conferencia?mes=2027-01&filtro=pendentes");
  });

  it("compra sem nota sem justificativa bloqueia; com justificativa libera", () => {
    const e = entradaBase("2027-01-01", "2027-02-01");
    e.notas.push(nota({ data: "2027-01-20", valor: 5_000, categoriaId: CAT.fruteira.id, tipo: "sem_nota", observacao: "romaneio" }));
    expect(porId(e).sem_nota.ok).toBe(false);
    e.notas[e.notas.length - 1].pendenciaJustificativa = "fornecedor informal, sem emissão";
    expect(porId(e).sem_nota.ok).toBe(true);
  });

  it("fornecedor novo com nota no mês bloqueia (um por fornecedor, não por nota)", () => {
    const e = entradaBase("2027-01-01", "2027-02-01");
    e.notas.push(nota({ data: "2027-01-21", valor: 1_000, categoriaId: CAT.mercado.id, fornecedorId: "f9", fornecedorNome: "Atacadão", fornecedorRevisado: false }));
    e.notas.push(nota({ data: "2027-01-22", valor: 1_000, categoriaId: CAT.mercado.id, fornecedorId: "f9", fornecedorNome: "Atacadão", fornecedorRevisado: false }));
    const it = porId(e).fornecedores;
    expect(it.ok).toBe(false);
    expect(it.detalhes).toEqual(["Atacadão"]);
  });

  it("sem total ERP bloqueia", () => {
    const e = entradaBase("2027-01-01", "2027-02-01");
    e.mes.vendaBaseErp = null;
    expect(porId(e).erp.ok).toBe(false);
  });
});

describe("base de cálculo (convenção do DRE: a menor)", () => {
  it("menor entre caixa e ERP, com a divergência", () => {
    const e = entradaBase("2027-01-01", "2027-02-01"); // caixa 93.000, ERP 95.000
    let d = montarFechamento(e, { previa: false });
    expect(d.base).toMatchObject({ caixa: 9_300_000, erp: 9_500_000, base: 9_300_000, divergencia: -200_000, origem: "caixa" });
    expect(d.base.nota).toContain("diferença de R$ 2.000,00");
    expect(d.base.nota).toContain("base menor (R$ 93.000,00, o caixa)");
    e.mes.vendaBaseErp = 9_000_000;
    d = montarFechamento(e, { previa: false });
    expect(d.base).toMatchObject({ base: 9_000_000, divergencia: 300_000, origem: "erp" });
    expect(notaDaBase(100, null)).toMatch(/ainda não foi informado/);
  });
});

describe("novembro/2026: início do sistema, sem estoque inicial", () => {
  it("fecha como CMV de compras; o estoque final (29/11) aparece mas não é descontado; nota do corte de 30/11", () => {
    const e = entradaBase("2026-11-01", "2026-12-01");
    e.contagemFinal = contagem("2026-11-29", [[CAT.pescados.id, 700_000], [CAT.mercado.id, 50_000]]);
    // Mesmo que existisse uma contagem de outubro, outubro está fora do sistema.
    e.contagemInicial = { ...contagem("2026-10-31", [[CAT.pescados.id, 999_999]]), competencia: "2026-10-01" };
    const d = montarFechamento(e, { previa: false });
    expect(d.cmv.tipo).toBe("compras");
    expect(d.cmv.real).toBeNull();
    expect(d.cmv.valor).toBe(3_250_000);
    expect(d.cmv.pct).toBeCloseTo(3_250_000 / d.base.base, 10);
    expect(d.estoque.inicial).toBeNull();
    expect(d.estoque.final?.valor).toBe(750_000);
    expect(d.estoque.final?.data).toBe("2026-11-29");
    expect(d.estoque.descontado).toBe(false);
    expect(d.estoque.nota).toContain("primeiro mês do sistema");
    expect(d.estoque.nota).toContain("não é descontado");
    expect(d.estoque.nota).toContain("estoque inicial de dezembro/2026");
    expect(d.notasGerenciais.join(" ")).toContain("30/11");
    expect(d.cmv.porCategoria.every((l) => l.real === null && l.cmv === l.compras)).toBe(true);
  });
});

describe("mês com estoque inicial e final: CMV real", () => {
  it("CMV real = inicial + compras − final, também por categoria; CMV de compras continua junto", () => {
    const e = entradaBase("2027-01-01", "2027-02-01");
    e.contagemInicial = { ...contagem("2026-12-31", [[CAT.pescados.id, 800_000], [CAT.bebidas.id, 200_000]]), competencia: "2026-12-01" };
    e.contagemFinal = contagem("2027-01-31", [[CAT.pescados.id, 600_000], [CAT.bebidas.id, 100_000]]);
    const d = montarFechamento(e, { previa: false });
    // compras 32.500; inicial 10.000; final 7.000 → real 35.500
    expect(d.cmv.compras).toBe(3_250_000);
    expect(d.cmv.real).toBe(3_550_000);
    expect(d.cmv.tipo).toBe("real");
    expect(d.cmv.valor).toBe(3_550_000);
    expect(d.cmv.pct).toBeCloseTo(3_550_000 / 9_300_000, 10);
    expect(d.cmv.comprasPct).toBeCloseTo(3_250_000 / 9_300_000, 10);
    expect(d.cmv.faixa?.faixa).toBe("Atenção"); // 38,2%
    const pesc = d.cmv.porCategoria.find((l) => l.id === CAT.pescados.id)!;
    expect(pesc).toMatchObject({ compras: 2_500_000, estoqueInicial: 800_000, estoqueFinal: 600_000, real: 2_700_000, cmv: 2_700_000 });
    const frut = d.cmv.porCategoria.find((l) => l.id === CAT.fruteira.id)!;
    expect(frut).toMatchObject({ compras: 250_000, estoqueInicial: 0, estoqueFinal: 0, real: 250_000 });
    // as linhas do DRE somam o total
    expect(d.dre[1].valor).toBe(3_550_000);
    expect(d.dre.filter((l) => l.nivel === 1).reduce((a, l) => a + l.valor, 0)).toBe(3_550_000);
    expect(d.estoque.descontado).toBe(true);
    expect(d.estoque.nota).toBeNull();
  });

  it("virada de estoque: o final de um mês é o inicial do seguinte", () => {
    const nov = entradaBase("2026-11-01", "2026-12-01");
    nov.contagemFinal = contagem("2026-11-29", [[CAT.pescados.id, 700_000], [CAT.mercado.id, 50_000]]);
    const dNov = montarFechamento(nov, { previa: false });

    const dez = entradaBase("2026-12-01", "2027-01-01");
    dez.contagemInicial = { ...nov.contagemFinal, competencia: "2026-11-01" };
    dez.contagemFinal = contagem("2026-12-31", [[CAT.pescados.id, 500_000]]);
    const dDez = montarFechamento(dez, { previa: false });

    expect(dDez.estoque.inicial?.valor).toBe(dNov.estoque.final?.valor);
    expect(dDez.estoque.inicial?.data).toBe("2026-11-29");
    expect(dDez.cmv.tipo).toBe("real");
    expect(dDez.cmv.real).toBe(750_000 + dDez.cmv.compras - 500_000);
    expect(dDez.notasGerenciais.join(" ")).toContain("O estoque inicial é a contagem de 29/11 (R$");
  });

  it("estoque inicial sem final finalizado: CMV de compras com nota", () => {
    const e = entradaBase("2027-01-01", "2027-02-01");
    e.contagemInicial = { ...contagem("2026-12-31", [[CAT.pescados.id, 800_000]]), competencia: "2026-12-01" };
    e.contagemFinal = { ...e.contagemFinal!, status: "rascunho" };
    const d = montarFechamento(e, { previa: true });
    expect(d.cmv.tipo).toBe("compras");
    expect(d.estoque.final).toBeNull();
    expect(d.estoque.nota).toMatch(/ainda não foi finalizada/);
  });
});

describe("conteúdo do snapshot", () => {
  it("planejado × comprado: planejado soma o teto, comprado soma as compras da categoria", () => {
    const d = montarFechamento(entradaBase("2027-01-01", "2027-02-01"), { previa: false });
    for (const c of d.planejadoComprado) {
      expect(c.semanas.reduce((a, s) => a + s.planejado, 0)).toBe(c.teto);
      const compras = d.cmv.porCategoria.find((l) => l.id === c.categoriaId)!.compras;
      expect(c.semanas.reduce((a, s) => a + s.comprado, 0)).toBe(compras);
    }
    // semanas do CMV: todas fechadas e o acumulado cobre o mês inteiro
    expect(d.cmvSemanas.semanas.every((s) => s.situacao === "fechada")).toBe(true);
    expect(d.cmvSemanas.acumulado?.compras).toBe(d.cmv.compras);
    expect(d.cmvSemanas.acumulado?.venda).toBe(d.base.caixa);
  });

  it("vendas por origem, marca, turno e forma de pagamento (preparação do DRE)", () => {
    const e = entradaBase("2027-01-01", "2027-02-01");
    e.vendas.push(venda("2027-01-03", 50_000, { turno: 2, origem: "shakai_tele", credito: 0, lojaCartao: 20_000, online: 30_000, qtdPedidos: 4 }));
    e.vendas.push(venda("2027-01-03", 10_000, { turno: 2, origem: "restaurante", credito: 0, pix: 10_000 }));
    const d = montarFechamento(e, { previa: false });
    expect(d.vendas.porOrigem.shakai_tele).toBe(50_000);
    expect(d.vendas.porMarca).toEqual({ oji: 0, shakai: 50_000, wabi: 0 });
    expect(d.vendas.porTurno[2]).toBe(60_000);
    expect(d.vendas.restaurante.pix).toBe(10_000);
    expect(d.vendas.teles).toEqual({ lojaDinheiro: 0, lojaCartao: 20_000, online: 30_000, pedidos: 4 });
    expect(d.vendas.total).toBe(9_300_000 + 60_000);
  });

  it("histórico: 5 meses anteriores + o atual; variação contra o anterior (sistema tem prioridade)", () => {
    const e = entradaBase("2027-01-01", "2027-02-01");
    e.historico = [
      { competencia: "2026-07-01", venda: 9_559_600, cmvValor: null, cmvPct: 0.386, fonte: "historico" },
      { competencia: "2026-08-01", venda: 9_434_831, cmvValor: null, cmvPct: 0.376, fonte: "historico" },
      { competencia: "2026-09-01", venda: 8_441_369, cmvValor: null, cmvPct: 0.405, fonte: "historico" },
      { competencia: "2026-10-01", venda: 8_592_154, cmvValor: 3_022_390, cmvPct: 0.352, fonte: "historico" },
      { competencia: "2026-11-01", venda: 9_000_000, cmvValor: 3_150_000, cmvPct: 0.35, fonte: "sistema" },
      { competencia: "2026-12-01", venda: 1, cmvValor: 1, cmvPct: 0.99, fonte: "historico" },
      { competencia: "2026-12-01", venda: 9_000_000, cmvValor: 3_240_000, cmvPct: 0.36, fonte: "sistema" },
    ];
    const d = montarFechamento(e, { previa: false });
    expect(d.historico.map((h) => h.competencia)).toEqual(["2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01", "2026-12-01", "2027-01-01"]);
    expect(d.variacao.anterior).toEqual({ competencia: "2026-12-01", venda: 9_000_000, cmvPct: 0.36 });
    expect(d.variacao.venda).toBeCloseTo(9_300_000 / 9_000_000 - 1, 10);
    expect(d.variacao.cmv).toBeCloseTo(d.cmv.pct! - 0.36, 10);
  });

  it("ranking de fornecedores e alertas (sem nota, divergentes, observações)", () => {
    const e = entradaBase("2027-01-01", "2027-02-01");
    e.notas[2].conferencia = "divergente";
    e.notas[2].conferenciaObs = "número da nota diferente";
    e.notas[3].observacao = "recebida em 30/11 — corte de estoque, competência dezembro";
    e.notas.push(nota({ data: "2027-01-20", valor: 5_000, categoriaId: CAT.fruteira.id, tipo: "sem_nota", observacao: "romaneio", pendenciaJustificativa: "informal" }));
    const d = montarFechamento(e, { previa: false });
    expect(d.fornecedores[0]).toMatchObject({ nome: "Frumar", notas: 3, total: 2_505_000 });
    expect(d.fornecedores.reduce((a, f) => a + f.pct, 0)).toBeCloseTo(1, 10);
    expect(d.alertas.divergentes.map((n) => n.conferenciaObs)).toEqual(["número da nota diferente"]);
    expect(d.alertas.semNota.map((n) => n.pendenciaJustificativa)).toEqual(["informal"]);
    expect(d.alertas.observacoes.map((n) => n.observacao)).toEqual(["recebida em 30/11 — corte de estoque, competência dezembro"]);
    // notas ordenadas por categoria e data
    expect(d.notas.map((n) => n.categoria)).toEqual(["Pescados e Linha Seca", "Pescados e Linha Seca", "Bebidas", "Mercado", "Fruteira", "Fruteira"]);
  });

  it("assinatura muda quando os dados mudam; o snapshot é JSON puro", () => {
    const e = entradaBase("2027-01-01", "2027-02-01");
    const a1 = assinaturaDe(e);
    expect(a1).toEqual({ notas: 5, notasTotal: 3_250_000, vendasTotal: 9_300_000, erp: 9_500_000, estoqueFinal: 700_000, estoqueInicial: null });
    e.notas.push(nota({ data: "2027-01-25", valor: 100, categoriaId: CAT.mercado.id }));
    expect(assinaturaDe(e)).not.toEqual(a1);
    const d = montarFechamento(e, { previa: false, geradoEm: "2027-02-01T10:00:00.000Z" });
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
  });

  it("prévia no meio do mês: dia de hoje (parcial) fica fora; dias passados sem venda aparecem", () => {
    const e = entradaBase("2026-11-01", "2026-11-15");
    e.vendas = e.vendas.filter((v) => v.data <= "2026-11-13" && v.data !== "2026-11-10");
    e.contagemFinal = null;
    const d = montarFechamento(e, { previa: true });
    expect(d.previa).toBe(true);
    expect(d.vendas.porDia.map((x) => x.data).at(-1)).toBe("2026-11-14");
    expect(d.vendas.diasSemVenda).toEqual(["2026-11-10", "2026-11-14"]);
    expect(checklistCompleto(d.checklist)).toBe(false);
  });
});

describe("nota do corte de estoque gerada pelos dados (decisão 110)", () => {
  const corte = (valor: number) => ({ data: "2026-12-01", fornecedor: "Frumar", valor });

  it("prévia de novembro: 'previsto', mesmo com contagem finalizada; mostra as notas de corte que já existem", () => {
    const e = entradaBase("2026-11-01", "2026-11-20");
    e.contagemFinal = contagem("2026-11-29", [[CAT.pescados.id, 700_000]]);
    let t = montarFechamento(e, { previa: true }).notasGerenciais.join(" ");
    expect(t).toContain("Previsto (decisão 110): contagem de fechamento em 29/11");
    expect(t).toContain("compras recebidas em 30/11 lançadas em dezembro/2026 (data 01/12");
    expect(t).not.toContain("foi feita");
    e.notasCorteMesSeguinte = [corte(150_000)];
    t = montarFechamento(e, { previa: true }).notasGerenciais.join(" ");
    expect(t).toContain("Até agora: 1 compra(s), R$ 1.500,00 com a observação de corte.");
  });

  it("fechamento de novembro sem contagem finalizada continua 'previsto'", () => {
    const e = entradaBase("2026-11-01", "2026-12-01");
    e.contagemFinal = { ...contagem("2026-11-29", [[CAT.pescados.id, 1]]), status: "rascunho" };
    expect(montarFechamento(e, { previa: false }).notasGerenciais.join(" ")).toMatch(/^Corte de estoque\. Previsto/);
  });

  it("fechamento de novembro: data real da contagem e quantidade/valor das notas de corte lançadas em dezembro", () => {
    const e = entradaBase("2026-11-01", "2026-12-01");
    e.contagemFinal = contagem("2026-11-29", [[CAT.pescados.id, 700_000], [CAT.mercado.id, 50_000]]);
    e.notasCorteMesSeguinte = [corte(150_000), corte(98_050)];
    const t = montarFechamento(e, { previa: false }).notasGerenciais.join(" ");
    expect(t).toContain("a contagem de fechamento foi feita em 29/11 (R$ 7.500,00)");
    expect(t).toContain("2 compra(s), R$ 2.480,50 recebidas em 30/11 foram lançadas em dezembro/2026");
    expect(t).not.toContain("Previsto");
    expect(t).not.toContain("como previsto");
  });

  it("contagem feita em outro dia: a nota diz a data real e que não foi a prevista; sem notas de corte, diz isso", () => {
    const e = entradaBase("2026-11-01", "2026-12-01");
    e.contagemFinal = contagem("2026-11-28", [[CAT.pescados.id, 700_000]]);
    const t = montarFechamento(e, { previa: false }).notasGerenciais.join(" ");
    expect(t).toContain("feita em 28/11 (R$ 7.000,00), e não em 29/11 como previsto");
    expect(t).toContain("nenhuma compra com a observação de corte havia sido lançada em dezembro/2026 até este fechamento");
  });

  it("dezembro: conta as próprias notas com a observação de corte e cita o estoque inicial", () => {
    const e = entradaBase("2026-12-01", "2027-01-01");
    e.contagemInicial = { ...contagem("2026-11-29", [[CAT.pescados.id, 750_000]]), competencia: "2026-11-01" };
    e.notas.push(nota({ data: "2026-12-01", valor: 150_000, categoriaId: CAT.pescados.id, observacao: "recebida em 30/11 — corte de estoque, competência dezembro" }));
    const t = montarFechamento(e, { previa: false }).notasGerenciais.join(" ");
    expect(t).toContain("este mês inclui 1 compra(s), R$ 1.500,00 recebidas em 30/11");
    expect(t).toContain("O estoque inicial é a contagem de 29/11 (R$ 7.500,00)");
    expect(montarFechamento(entradaBase("2027-01-01", "2027-02-01"), { previa: false }).notasGerenciais).toEqual([]);
  });
});

describe("comparativo: CMV em R$ calculado quando o histórico só tem o %", () => {
  it("junho a setembro: venda × % marcado como calculado; outubro (com R$) fica como está", () => {
    const e = entradaBase("2026-11-01", "2026-12-01");
    e.historico = [
      { competencia: "2026-06-01", venda: 9_296_526, cmvValor: null, cmvPct: 0.365, fonte: "historico" },
      { competencia: "2026-10-01", venda: 8_592_154, cmvValor: 3_022_390, cmvPct: 0.351762, fonte: "historico" },
    ];
    const h = montarFechamento(e, { previa: false }).historico;
    expect(h[0]).toMatchObject({ competencia: "2026-06-01", cmvValor: 3_393_232, cmvCalculado: true });
    expect(h[1]).toMatchObject({ competencia: "2026-10-01", cmvValor: 3_022_390 });
    expect(h[1].cmvCalculado).toBeUndefined();
  });
});

