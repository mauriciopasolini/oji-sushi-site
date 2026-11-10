import { describe, expect, it } from "vitest";
import { dataCivilSP, diasNoMes, hojeSP, rotuloSemana, semanaDaData, semanaDoDia, semanasDoMes } from "./datas";
import { centavos, formatarBRL, formatarPct, paraDecimal } from "./dinheiro";
import {
  type ConfigMes,
  type FaixaRegua,
  type NotaCalc,
  type VendaDia,
  calcularCmv,
  calcularCmvProjetado,
  calcularCmvSemanas,
  planejadoRestante,
  reguaDaCategoria,
  calcularOrcamentoCategoria,
  calcularPainel,
  calcularProjecao,
  classificarRegua,
  corDoRitmo,
  corVendas,
  definirHojeRef,
  metasDiarias,
  somaPesosDoMes,
} from "./engine";

// -----------------------------------------------------------------------------
// Dados do briefing
// -----------------------------------------------------------------------------
const R = (reais: number) => Math.round(reais * 100); // reais → centavos (só para legibilidade dos testes)

const PESOS_DIA = [3300, 2700, 2500, 3300, 2950, 3700, 4200]; // dom..sáb

const novembro: ConfigMes = {
  competencia: "2026-11-01",
  metaVenda: R(95000),
  metaCmvPct: 0.35,
  pesosSemana: [6.5, 6.5, 5.5, 5.5],
  limiteAcumuloPct: 1.25,
  pesosDiaSemana: PESOS_DIA,
};

// pct_meta como vem do banco: numeric(12,10) → string → Number
const CATEGORIAS = [
  { id: "pescados", nome: "Pescados e Linha Seca", pctMeta: Number("0.2666666667") },
  { id: "bebidas", nome: "Bebidas", pctMeta: Number("0.0222222222") },
  { id: "mercado", nome: "Mercado", pctMeta: Number("0.0333333333") },
  { id: "fruteira", nome: "Fruteira", pctMeta: Number("0.0277777778") },
];
const PESCADOS = CATEGORIAS[0];

const REGUA: FaixaRegua[] = [
  { faixa: "Ótimo", limiteSuperiorPct: 0.36, cor: "#16a34a", ordem: 1 },
  { faixa: "Bom", limiteSuperiorPct: 0.375, cor: "#65a30d", ordem: 2 },
  { faixa: "Atenção", limiteSuperiorPct: 0.39, cor: "#d97706", ordem: 3 },
  { faixa: "Crítico", limiteSuperiorPct: null, cor: "#dc2626", ordem: 4 },
];

/** 30.793,84 em 8 dias (01 a 08/11): 8 × 3.849,23 */
const VENDAS_1_A_8: VendaDia[] = Array.from({ length: 8 }, (_, i) => ({
  data: `2026-11-0${i + 1}`,
  total: R(3849.23),
}));

/** |a − b| ≤ tol (em centavos) */
function perto(real: number, esperado: number, tolCentavos: number) {
  expect(Math.abs(real - esperado), `valor ${real} ≠ ${esperado} (±${tolCentavos})`).toBeLessThanOrEqual(tolCentavos);
}

const projecaoNovembro = () =>
  calcularProjecao({ config: novembro, vendas: VENDAS_1_A_8, hojeRef: definirHojeRef("2026-11-09", VENDAS_1_A_8.map((v) => v.data)) });

const nota = (data: string, reais: number, categoriaId = "pescados", status: NotaCalc["status"] = "ativa"): NotaCalc => ({
  data,
  valor: R(reais),
  categoriaId,
  status,
});

// =============================================================================
// TESTES OBRIGATÓRIOS DO BRIEFING
// =============================================================================

describe("1. Meta diária e projeção — novembro/2026", () => {
  it("soma bruta dos pesos do mês = 96.600", () => {
    expect(somaPesosDoMes(novembro)).toBe(96600);
  });

  it("meta acumulada de 01 a 08/11 = 25.520,19 (±0,01)", () => {
    const metas = metasDiarias(novembro);
    perto(metas[7].metaAcumulada, R(25520.19), 1);
  });

  it("realizado 30.793,84 → projeção = 100.273,65 (±0,01)", () => {
    const p = projecaoNovembro();
    expect(p.hojeRef).toBe("2026-11-08");
    expect(p.realizado).toBe(R(30793.84));
    expect(p.fatorRitmo).toBeGreaterThan(1); // venda acima da meta: não extrapola (min 1)
    perto(p.projecao, R(100273.65), 1);
  });
});

describe("2. Tetos a partir da projeção", () => {
  it("teto de Pescados e Linha Seca ≈ 26.739,64 e teto total (35%) ≈ 35.095,78 (±0,05)", () => {
    const p = projecaoNovembro();
    const pescados = calcularOrcamentoCategoria({ config: novembro, categoria: PESCADOS, projecao: p.projecao, notas: [], hoje: "2026-11-09" });
    perto(pescados.teto, R(26739.64), 5);

    const painel = calcularPainel({ config: novembro, categorias: CATEGORIAS, notas: [], vendas: VENDAS_1_A_8, hoje: "2026-11-09", regua: REGUA });
    perto(painel.tetoTotal, R(35095.78), 5);
    const somaTetos = painel.categorias.reduce((a, c) => a + c.teto, 0);
    perto(somaTetos, R(35095.78), 5);
  });
});

describe("3. Orçamento semanal com compras na S1", () => {
  it("S1 = 8.000; semana atual S2 → saldo início 18.739,64; S2 ≈ 6.960,44; S3 e S4 ≈ 5.889,60", () => {
    const p = projecaoNovembro();
    const o = calcularOrcamentoCategoria({
      config: novembro,
      categoria: PESCADOS,
      projecao: p.projecao,
      notas: [nota("2026-11-03", 3000), nota("2026-11-06", 5000)],
      hoje: "2026-11-09",
    });
    expect(o.semanaAtual).toBe(2);
    perto(o.saldoInicioSemana, R(18739.64), 5);
    perto(o.orcamentoSemana, R(6960.44), 5);
    perto(o.semanas[2].orcamento, R(5889.6), 5);
    perto(o.semanas[3].orcamento, R(5889.6), 5);
    expect(o.disponivelAgora).toBe(o.orcamentoSemana); // nada comprado na S2 ainda
    expect(o.semanas.map((s) => s.situacao)).toEqual(["encerrada", "atual", "futura", "futura"]);
    expect(o.semanas[0].comprado).toBe(R(8000));
  });
});

describe("4. Venda abaixo da meta reduz a meta restante", () => {
  it("fator_ritmo 0,9 → meta restante reduzida em 10%", () => {
    const metaAcum = metasDiarias(novembro)[7].metaAcumulada;
    const realizado = Math.round(metaAcum * 0.9);
    const p = calcularProjecao({ config: novembro, vendas: [{ data: "2026-11-05", total: realizado }], hojeRef: "2026-11-08" });

    expect(p.fatorRitmo).toBeCloseTo(0.9, 6);
    const restanteProjetado = p.projecao - p.realizado;
    perto(restanteProjetado, Math.round(p.metaRestante * 0.9), 1);
    perto(p.metaRestante - restanteProjetado, Math.round(p.metaRestante * 0.1), 1);
  });

  it("projeção por tendência é só informativa (realizado / dias × dias do mês)", () => {
    const p = projecaoNovembro();
    expect(p.projecaoTendencia).toBe(Math.round((R(30793.84) / 8) * 30));
  });
});

describe("5. Sobra acumulada limitada a 125% do planejado original", () => {
  it("sem compras na S1 e S2, a S3 fica no teto de 125% (e não em metade do saldo)", () => {
    const p = projecaoNovembro();
    const o = calcularOrcamentoCategoria({ config: novembro, categoria: PESCADOS, projecao: p.projecao, notas: [], hoje: "2026-11-16" });
    const s3 = o.semanas[2];
    const semLimite = Math.round((o.teto * 5.5) / 11);
    expect(o.semanaAtual).toBe(3);
    expect(s3.orcamento).toBe(Math.round(s3.planejadoOriginal * 1.25));
    expect(s3.orcamento).toBeLessThan(semLimite);
  });

  it("limite vale para qualquer semana (S2 sem compras na S1)", () => {
    const p = projecaoNovembro();
    const o = calcularOrcamentoCategoria({ config: novembro, categoria: PESCADOS, projecao: p.projecao, notas: [], hoje: "2026-11-09" });
    expect(o.orcamentoSemana).toBe(Math.round(o.semanas[1].planejadoOriginal * 1.25));
    for (const s of o.semanas) expect(s.orcamento).toBeLessThanOrEqual(Math.round(s.planejadoOriginal * 1.25));
  });
});

describe("6. Estouro", () => {
  it("estouro maior que o saldo → orçamento da semana = 0 e flag de estouro", () => {
    const p = projecaoNovembro();
    const o = calcularOrcamentoCategoria({ config: novembro, categoria: PESCADOS, projecao: p.projecao, notas: [nota("2026-11-02", 30000)], hoje: "2026-11-09" });
    expect(o.saldoInicioSemana).toBeLessThan(0);
    expect(o.orcamentoSemana).toBe(0);
    expect(o.disponivelAgora).toBe(0);
    expect(o.semSaldo).toBe(true);
    expect(o.estouroMes).toBe(true);
    expect(o.semanas[2].orcamento).toBe(0);
    expect(o.semanas[3].orcamento).toBe(0);
  });

  it("estouro na semana atual já reduz as semanas seguintes", () => {
    const p = projecaoNovembro();
    const base = { config: novembro, categoria: PESCADOS, projecao: p.projecao, hoje: "2026-11-10" };
    const normal = calcularOrcamentoCategoria({ ...base, notas: [nota("2026-11-03", 8000)] });
    const estourado = calcularOrcamentoCategoria({ ...base, notas: [nota("2026-11-03", 8000), nota("2026-11-09", 9000)] });

    expect(estourado.estouroSemana).toBe(true);
    perto(estourado.disponivelAgora, R(6960.44 - 9000), 5);
    expect(estourado.semanas[2].orcamento).toBeLessThan(normal.semanas[2].orcamento);
    expect(estourado.semanas[3].orcamento).toBeLessThan(normal.semanas[3].orcamento);
    // o que sobra é dividido nas semanas futuras: (18.739,64 − 9.000) / 2
    perto(estourado.semanas[2].orcamento, R((18739.64 - 9000) / 2), 5);
  });

  it("notas canceladas não contam", () => {
    const p = projecaoNovembro();
    const o = calcularOrcamentoCategoria({ config: novembro, categoria: PESCADOS, projecao: p.projecao, notas: [nota("2026-11-02", 30000, "pescados", "cancelada")], hoje: "2026-11-09" });
    expect(o.compradoMes).toBe(0);
    expect(o.estouroMes).toBe(false);
  });
});

describe("7. Semanas do mês: dias 29–31 na S4; meses de 28, 29, 30 e 31 dias", () => {
  it.each([
    ["2026-02-01", 28], // fevereiro comum
    ["2028-02-01", 29], // fevereiro bissexto
    ["2026-04-01", 30],
    ["2026-01-01", 31],
  ])("%s tem %i dias e a S4 vai do dia 22 ao último", (competencia, dias) => {
    const [ano, mes] = competencia.split("-").map(Number);
    expect(diasNoMes(ano, mes)).toBe(dias);
    const s = semanasDoMes(competencia);
    expect(s.map((x) => [x.inicio.slice(8), x.fim.slice(8)])).toEqual([
      ["01", "07"],
      ["08", "14"],
      ["15", "21"],
      ["22", String(dias)],
    ]);
    expect(s[3].dias).toBe(dias - 21);
    expect(s.reduce((a, x) => a + x.dias, 0)).toBe(dias);
  });

  it("dias 29, 30 e 31 caem na S4", () => {
    expect([semanaDoDia(28), semanaDoDia(29), semanaDoDia(30), semanaDoDia(31)]).toEqual([4, 4, 4, 4]);
    expect([semanaDoDia(7), semanaDoDia(8), semanaDoDia(14), semanaDoDia(15), semanaDoDia(21), semanaDoDia(22)]).toEqual([1, 2, 2, 3, 3, 4]);
  });

  it("compra no dia 31 entra na S4 e o ritmo do mês encerrado usa todas as semanas", () => {
    const janeiro: ConfigMes = { ...novembro, competencia: "2026-01-01" };
    const o = calcularOrcamentoCategoria({ config: janeiro, categoria: PESCADOS, projecao: R(90000), notas: [nota("2026-01-31", 1000)], hoje: "2026-02-03" });
    expect(o.semanas[3].comprado).toBe(R(1000));
    expect(o.semanaAtual).toBeNull();
    expect(o.ritmo.esperadoAteFimDaSemana).toBe(o.semanas.reduce((a, s) => a + s.orcamento, 0));
  });

  it("meta diária fecha exatamente a meta do mês em meses de 28 a 31 dias", () => {
    for (const competencia of ["2026-02-01", "2028-02-01", "2026-04-01", "2026-01-01", "2026-11-01"]) {
      const metas = metasDiarias({ ...novembro, competencia });
      expect(metas.reduce((a, m) => a + m.meta, 0)).toBe(novembro.metaVenda);
    }
  });
});

describe("8. Datas no fuso de São Paulo", () => {
  it("nota às 23h30 do dia 30 (SP) pertence ao dia 30, não ao dia 1º", () => {
    // 30/11 23:30 em SP = 01/12 02:30 UTC
    expect(dataCivilSP(new Date("2026-12-01T02:30:00Z"))).toBe("2026-11-30");
    expect(dataCivilSP("2026-11-30T23:30:00-03:00")).toBe("2026-11-30");
    expect(semanaDaData(dataCivilSP("2026-12-01T02:30:00Z"))).toBe(4);
  });

  it("a nota entra no orçamento de novembro, S4", () => {
    const data = dataCivilSP("2026-12-01T02:30:00Z");
    const o = calcularOrcamentoCategoria({ config: novembro, categoria: PESCADOS, projecao: R(100000), notas: [nota(data, 500)], hoje: "2026-11-30" });
    expect(o.semanas[3].comprado).toBe(R(500));
    expect(o.compradoMes).toBe(R(500));
  });

  it("'hoje' no servidor em UTC respeita SP (01:00 UTC ainda é ontem em SP)", () => {
    expect(hojeSP(new Date("2026-11-09T01:00:00Z"))).toBe("2026-11-08");
    expect(hojeSP(new Date("2026-11-09T03:00:00Z"))).toBe("2026-11-09");
    expect(process.env.TZ).toBe("UTC"); // os testes rodam em UTC, como a Vercel
  });

  it("hoje_ref = ontem, ou o último dia com venda completa", () => {
    expect(definirHojeRef("2026-11-09", ["2026-11-07", "2026-11-08"])).toBe("2026-11-08");
    expect(definirHojeRef("2026-11-09", ["2026-11-06", "2026-11-07"])).toBe("2026-11-07"); // 08 ainda sem venda
    expect(definirHojeRef("2026-11-09", ["2026-11-09"])).toBeNull(); // hoje não conta
    expect(definirHojeRef("2026-11-01", [])).toBeNull();
  });
});

// =============================================================================
// TESTES COMPLEMENTARES
// =============================================================================

describe("Projeção: casos de borda", () => {
  it("sem nenhuma venda → projeção = meta (fator 1)", () => {
    const p = calcularProjecao({ config: novembro, vendas: [], hojeRef: null });
    expect(p.fatorRitmo).toBe(1);
    expect(p.projecao).toBe(novembro.metaVenda);
    expect(p.projecaoTendencia).toBeNull();
  });

  it("dia 1º do mês: ontem é do mês anterior → nada decorrido", () => {
    const p = calcularProjecao({ config: novembro, vendas: [], hojeRef: "2026-10-31" });
    expect(p.diasDecorridos).toBe(0);
    expect(p.projecao).toBe(novembro.metaVenda);
  });

  it("vendas de outros meses e depois do hoje_ref são ignoradas", () => {
    const p = calcularProjecao({
      config: novembro,
      vendas: [...VENDAS_1_A_8, { data: "2026-10-31", total: R(99999) }, { data: "2026-11-09", total: R(99999) }],
      hojeRef: "2026-11-08",
    });
    expect(p.realizado).toBe(R(30793.84));
  });
});

describe("Tabela semanal: Mês + Reserva = teto", () => {
  it("caso relatado: sem vendas (projeção = meta) e S1 encerrada sem compras", () => {
    const o = calcularOrcamentoCategoria({ config: novembro, categoria: PESCADOS, projecao: novembro.metaVenda, notas: [], hoje: "2026-11-09" });
    perto(o.teto, R(25333.33), 1);
    // antes da correção, somar os orçamentos de todas as semanas passava do teto
    expect(o.semanas.reduce((a, s) => a + s.orcamento, 0)).toBeGreaterThan(o.teto);
    // encerrada mostra o comprado (a sobra já foi redistribuída)
    expect(o.semanas[0].situacao).toBe("encerrada");
    expect(o.semanas[0].orcamentoAtual).toBe(0);
    expect(o.alocadoMes).toBe(o.semanas[1].orcamento + o.semanas[2].orcamento + o.semanas[3].orcamento);
    expect(o.reserva).toBeGreaterThan(0); // a trava de 125% deixou parte sem alocar
    expect(o.alocadoMes + o.reserva).toBe(o.teto);
  });

  it("estouro na semana atual não aparece como reserva", () => {
    const p = projecaoNovembro();
    const o = calcularOrcamentoCategoria({ config: novembro, categoria: PESCADOS, projecao: p.projecao, notas: [nota("2026-11-03", 8000), nota("2026-11-09", 9000)], hoje: "2026-11-10" });
    expect(o.estouroSemana).toBe(true);
    expect(o.reserva).toBe(0);
    expect(o.alocadoMes).toBe(o.teto);
  });

  it("propriedade: em todos os cenários, Mês + Reserva = teto; e a reserva só fica negativa se as compras passaram do teto", () => {
    // gerador pseudoaleatório determinístico (os cenários são sempre os mesmos)
    let semente = 20261109;
    const aleatorio = () => ((semente = (semente * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const dias = ["2026-10-31", ...Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`), "2026-12-02"];
    let cenarios = 0;
    for (const projecaoReais of [60000, 95000, 100273.65, 140000]) {
      for (const hoje of dias) {
        for (let rep = 0; rep < 6; rep++) {
          const notas = Array.from({ length: Math.floor(aleatorio() * 9) }, () =>
            nota(`2026-11-${String(1 + Math.floor(aleatorio() * 30)).padStart(2, "0")}`, Math.round(aleatorio() * 900000) / 100),
          );
          const o = calcularOrcamentoCategoria({ config: novembro, categoria: PESCADOS, projecao: R(projecaoReais), notas, hoje });
          expect(o.alocadoMes + o.reserva).toBe(o.teto);
          expect(o.semanas.reduce((a, s) => a + s.planejadoOriginal, 0)).toBe(o.teto);
          if (o.compradoMes <= o.teto) expect(o.reserva).toBeGreaterThanOrEqual(0);
          for (const s of o.semanas) if (s.situacao === "encerrada") expect(s.orcamentoAtual).toBe(s.comprado);
          cenarios++;
        }
      }
    }
    expect(cenarios).toBe(4 * 32 * 6);
  });
});

describe("Ritmo de compra (semáforo)", () => {
  it("limiares: ≤ 0% verde, ≤ 10% amarelo, > 10% vermelho", () => {
    expect(corDoRitmo(-0.2)).toBe("verde");
    expect(corDoRitmo(0)).toBe("verde");
    expect(corDoRitmo(0.05)).toBe("amarelo");
    expect(corDoRitmo(0.1)).toBe("amarelo");
    expect(corDoRitmo(0.11)).toBe("vermelho");
    expect(corDoRitmo(Infinity)).toBe("vermelho");
  });

  it("esperado = semanas encerradas + orçamento INTEIRO da semana atual (sem prorratear por dia)", () => {
    const p = projecaoNovembro();
    // 10/11 = 3º dia da S2 (8 a 14): a semana atual entra inteira, não 3/7 dela
    const o = calcularOrcamentoCategoria({ config: novembro, categoria: PESCADOS, projecao: p.projecao, notas: [nota("2026-11-03", 8000)], hoje: "2026-11-10" });
    const esperado = o.semanas[0].orcamento + o.semanas[1].orcamento;
    expect(o.ritmo.esperadoAteFimDaSemana).toBe(esperado);
    expect(o.ritmo.desvio).toBe(R(8000) - esperado);
  });
});

describe("CMV e régua", () => {
  it("venda base = menor entre caixa e ERP; CMV de compras", () => {
    const c = calcularCmv({ compras: R(30223.9), vendaCaixa: R(86500), vendaBaseErp: R(85921.54), regua: REGUA });
    expect(c.vendaBase).toBe(R(85921.54));
    expect(c.divergenciaBase).toBe(R(86500 - 85921.54));
    expect(c.cmvComprasPct).toBeCloseTo(0.351763, 5);
    expect(c.tipo).toBe("compras");
    expect(c.faixa?.faixa).toBe("Ótimo");
  });

  it("sem ERP usa o caixa; CMV real com as duas contagens", () => {
    const c = calcularCmv({ compras: R(30000), vendaCaixa: R(80000), estoqueInicial: R(5000), estoqueFinal: R(4000), regua: REGUA });
    expect(c.vendaBase).toBe(R(80000));
    expect(c.cmvReal).toBe(R(31000));
    expect(c.cmvRealPct).toBeCloseTo(0.3875, 6);
    expect(c.tipo).toBe("real");
    expect(c.faixa?.faixa).toBe("Atenção");
  });

  it("só uma contagem → continua CMV de compras", () => {
    const c = calcularCmv({ compras: R(30000), vendaCaixa: R(80000), estoqueInicial: R(5000), regua: REGUA });
    expect(c.cmvReal).toBeNull();
    expect(c.tipo).toBe("compras");
  });

  it("sem compras lançadas: sem % e sem faixa da régua (não mostra 0% como se fosse ótimo)", () => {
    const c = calcularCmv({ compras: 0, vendaCaixa: R(30670.84), regua: REGUA });
    expect(c.cmvComprasPct).toBeNull();
    expect(c.cmvPct).toBeNull();
    expect(c.faixa).toBeNull();
  });
});

describe("cor da barra de vendas", () => {
  it("acima da meta é verde (realizado 20,2% acima)", () => {
    expect(corVendas(R(30670.84), R(25520.19))).toBe("verde");
    expect(corVendas(R(1000), R(1000))).toBe("verde");
  });
  it("até 10% abaixo é amarelo; mais que isso, vermelho", () => {
    expect(corVendas(R(950), R(1000))).toBe("amarelo");
    expect(corVendas(R(900), R(1000))).toBe("amarelo");
    expect(corVendas(R(899.99), R(1000))).toBe("vermelho");
  });
  it("sem meta acumulada (início do mês) não acusa nada", () => {
    expect(corVendas(0, 0)).toBe("verde");
  });

  it("faixas da régua, inclusive os limites", () => {
    expect(classificarRegua(0.36, REGUA)?.faixa).toBe("Ótimo");
    expect(classificarRegua(0.3601, REGUA)?.faixa).toBe("Bom");
    expect(classificarRegua(0.375, REGUA)?.faixa).toBe("Bom");
    expect(classificarRegua(0.39, REGUA)?.faixa).toBe("Atenção");
    expect(classificarRegua(0.405, REGUA)?.faixa).toBe("Crítico");
    expect(classificarRegua(null, REGUA)).toBeNull();
  });
});

describe("Painel completo", () => {
  it("junta projeção, categorias e CMV", () => {
    const painel = calcularPainel({
      config: novembro,
      categorias: CATEGORIAS,
      notas: [nota("2026-11-03", 8000), nota("2026-11-04", 600, "bebidas"), nota("2026-11-04", 100, "bebidas", "cancelada")],
      vendas: VENDAS_1_A_8,
      hoje: "2026-11-09",
      regua: REGUA,
    });
    perto(painel.projecao.projecao, R(100273.65), 1);
    expect(painel.compradoTotal).toBe(R(8600));
    expect(painel.cmv.compras).toBe(R(8600));
    expect(painel.cmv.vendaBase).toBe(R(30793.84));
    expect(painel.categorias.map((c) => c.nome)).toEqual(CATEGORIAS.map((c) => c.nome));
  });
});

describe("Dinheiro e formatação", () => {
  it("converte numeric do banco e texto pt-BR para centavos sem erro de float", () => {
    expect(centavos("1234.56")).toBe(123456);
    expect(centavos("1010.72")).toBe(101072);
    expect(centavos("0.1")).toBe(10);
    expect(centavos("R$ 1.234,56")).toBe(123456);
    expect(centavos("14,00")).toBe(1400);
    expect(centavos("")).toBe(0);
    expect(centavos(null)).toBe(0);
    expect(centavos(0.1 + 0.2)).toBe(30);
    expect(() => centavos("abc")).toThrow();
  });

  it("formata em pt-BR", () => {
    expect(formatarBRL(123456).replace(/\s/g, " ")).toBe("R$ 1.234,56");
    expect(paraDecimal(123456)).toBe("1234.56");
    expect(paraDecimal(5)).toBe("0.05");
    expect(formatarPct(0.351763)).toBe("35,2%");
    expect(rotuloSemana(semanasDoMes("2026-11-01")[1])).toBe("08 a 14/11");
  });
});

describe("Dia em andamento (hoje parcial) fica fora do cálculo", () => {
  const base = { config: novembro, categorias: CATEGORIAS, notas: [], hoje: "2026-11-09", regua: REGUA };
  const semHoje = calcularPainel({ ...base, vendas: VENDAS_1_A_8 });
  const comParcial = [...VENDAS_1_A_8, { data: "2026-11-09", total: R(749.65) }];

  it("parcial: projeção, ritmo, tetos e CMV iguais aos de antes do dia começar", () => {
    const p = calcularPainel({ ...base, vendas: comParcial });
    expect(p.projecao).toEqual(semHoje.projecao);
    expect(p.projecao.hojeRef).toBe("2026-11-08");
    perto(p.projecao.projecao, R(100273.65), 1);
    expect(p.tetoTotal).toBe(semHoje.tetoTotal);
    expect(p.cmv).toEqual(semHoje.cmv);
  });

  it("parcial informado em diasComVenda também não vira hoje_ref", () => {
    const p = calcularPainel({ ...base, vendas: comParcial, diasComVenda: comParcial.map((v) => v.data) });
    expect(p.projecao.hojeRef).toBe("2026-11-08");
    expect(p.projecao.realizado).toBe(R(30793.84));
  });

  it("completo (dois turnos): hoje entra em realizado, meta acumulada e ritmo", () => {
    const vendas = [...VENDAS_1_A_8, { data: "2026-11-09", total: R(4000) }];
    const p = calcularPainel({ ...base, vendas, hojeCompleto: true });
    const metas = metasDiarias(novembro);
    expect(p.projecao.hojeRef).toBe("2026-11-09");
    expect(p.projecao.diasDecorridos).toBe(9);
    expect(p.projecao.realizado).toBe(R(34793.84));
    expect(p.projecao.metaAcumulada).toBe(metas[8].metaAcumulada);
    expect(p.projecao.fatorRitmo).toBeCloseTo(R(34793.84) / metas[8].metaAcumulada, 10);
    expect(p.diasSemVenda).toEqual([]);
  });

  it("definirHojeRef: hoje só com hojeCompleto", () => {
    const dias = ["2026-11-08", "2026-11-09"];
    expect(definirHojeRef("2026-11-09", dias)).toBe("2026-11-08");
    expect(definirHojeRef("2026-11-09", dias, true)).toBe("2026-11-09");
  });

  it("mês já encerrado: todos os dias contam normalmente", () => {
    const p = calcularPainel({ ...base, hoje: "2026-12-05", vendas: VENDAS_1_A_8 });
    expect(p.projecao.realizado).toBe(R(30793.84));
  });
});

// -----------------------------------------------------------------------------
// Indicadores de CMV: projetado, por semana fechada e ritmo sem prorrateio
// Cenário real de 10/11/2026 (pedido do Mauricio).
// -----------------------------------------------------------------------------
describe("CMV projetado, CMV por semana e ritmo — cenário de 10/11/2026", () => {
  const PROJECAO = R(100517.64);
  const NOTAS: NotaCalc[] = [nota("2026-11-02", 6868.73), nota("2026-11-09", 5171.46)];
  const o = calcularOrcamentoCategoria({ config: novembro, categoria: PESCADOS, projecao: PROJECAO, notas: NOTAS, hoje: "2026-11-10" });

  it("planejado original de Pescados: 7.259,61 · 7.259,60 · 6.142,75 · 6.142,74", () => {
    expect(o.semanas.map((s) => s.planejadoOriginal)).toEqual([R(7259.61), R(7259.6), R(6142.75), R(6142.74)]);
  });

  it("CMV projetado de Pescados ≈ 26,28%", () => {
    const cp = calcularCmvProjetado({ categorias: [{ ...o, pctMeta: PESCADOS.pctMeta }], projecao: PROJECAO, metaCmvPct: 0.35, regua: REGUA });
    const cat = cp.porCategoria[0];
    // restante = S3 + S4 + (S2 planejado − S2 comprado) = 6.142,75 + 6.142,74 + 2.088,14
    expect(cat.planejadoRestante).toBe(R(14373.63));
    expect(cat.projetado).toBe(R(26413.82));
    expect(cat.pct).toBeCloseTo(0.2628, 4);
    expect(cat.faixa?.faixa).toBe("Ótimo"); // régua escalada: Ótimo ≤ 27,43% para Pescados
    expect(cp.podeComprar).toBe(Math.round(PROJECAO * 0.35) - R(12040.19));
  });

  it("compra além do planejado da semana atual não é abatida do restante (planejado original)", () => {
    const acima = calcularOrcamentoCategoria({
      config: novembro, categoria: PESCADOS, projecao: PROJECAO, notas: [...NOTAS, nota("2026-11-10", 3000)], hoje: "2026-11-10",
    });
    // S2 comprado 8.171,46 > planejado 7.259,60 → a semana atual não soma nada; o excesso aparece no projetado
    expect(planejadoRestante(acima.semanas)).toBe(R(6142.75 + 6142.74));
  });

  it("ritmo: comprado 12.040,19 ≤ S1 + S2 inteira → verde e sem alerta de ritmo", () => {
    expect(o.ritmo.esperadoAteFimDaSemana).toBe(o.semanas[0].orcamento + o.semanas[1].orcamento);
    expect(o.ritmo.desvio).toBeLessThanOrEqual(0);
    expect(o.ritmo.cor).toBe("verde");
    expect(o.estouroSemana).toBe(false);
  });

  it("CMV por semana: S1 Pescados = 6.868,73 ÷ 25.624,26 = 26,81%; S2 em andamento, sem %", () => {
    const vendas: VendaDia[] = [
      ...Array.from({ length: 6 }, (_, i) => ({ data: `2026-11-0${i + 1}`, total: R(3660.61) })),
      { data: "2026-11-07", total: R(3660.6) },
      { data: "2026-11-08", total: R(5046.58) },
      { data: "2026-11-09", total: R(3022.27) },
    ];
    const cs = calcularCmvSemanas({
      config: novembro, categorias: CATEGORIAS, notas: NOTAS, vendas, diasComVenda: vendas.map((v) => v.data), hoje: "2026-11-10", regua: REGUA,
    });
    const [s1, s2, s3, s4] = cs.semanas;
    expect(s1.situacao).toBe("fechada");
    expect(s1.venda).toBe(R(25624.26));
    expect(s1.comprasPorCategoria.pescados).toBe(R(6868.73));
    expect(s1.pctPorCategoria.pescados).toBeCloseTo(0.2681, 4);
    expect(s1.faixaPorCategoria.pescados?.faixa).toBe("Ótimo");
    expect(s1.pct).toBeCloseTo(0.2681, 4); // só Pescados comprado na S1
    expect(s2.situacao).toBe("em_andamento");
    expect(s2.pct).toBeNull();
    expect(s2.pctPorCategoria.pescados).toBeNull();
    expect(s2.venda).toBe(R(5046.58 + 3022.27)); // parcial, só exibição
    expect(s2.compras).toBe(R(5171.46));
    expect([s3.situacao, s4.situacao]).toEqual(["futura", "futura"]);
    expect(cs.acumulado?.semanas).toEqual([1]);
    expect(cs.acumulado?.pctPorCategoria.pescados).toBeCloseTo(0.2681, 4);
  });

  it("semana já passada com dia sem venda fica 'aguardando vendas', sem %, e fora do acumulado", () => {
    const vendas: VendaDia[] = Array.from({ length: 6 }, (_, i) => ({ data: `2026-11-0${i + 1}`, total: R(3000) }));
    const cs = calcularCmvSemanas({
      config: novembro, categorias: CATEGORIAS, notas: NOTAS, vendas, diasComVenda: vendas.map((v) => v.data), hoje: "2026-11-10", regua: REGUA,
    });
    expect(cs.semanas[0].situacao).toBe("aguardando_vendas");
    expect(cs.semanas[0].pct).toBeNull();
    expect(cs.acumulado).toBeNull();
  });

  it("acumulado de S1+S2 compensa a compra de sexta que caiu na semana seguinte", () => {
    const vendas: VendaDia[] = Array.from({ length: 14 }, (_, i) => ({ data: `2026-11-${String(i + 1).padStart(2, "0")}`, total: R(1000) }));
    const notas = [nota("2026-11-06", 1500), nota("2026-11-13", 3500)];
    const cs = calcularCmvSemanas({ config: novembro, categorias: CATEGORIAS, notas, vendas, diasComVenda: vendas.map((v) => v.data), hoje: "2026-11-15", regua: REGUA });
    expect(cs.semanas[0].pct).toBeCloseTo(1500 / 7000, 6);
    expect(cs.semanas[1].pct).toBeCloseTo(3500 / 7000, 6);
    expect(cs.acumulado?.semanas).toEqual([1, 2]);
    expect(cs.acumulado?.pct).toBeCloseTo(5000 / 14000, 6);
    expect(cs.acumulado?.faixa?.faixa).toBe("Ótimo"); // 35,7% ≤ 36%
  });

  it("régua da categoria = régua do total escalada pela meta da categoria", () => {
    const r = reguaDaCategoria(REGUA, PESCADOS.pctMeta, 0.35);
    expect(r[0].limiteSuperiorPct).toBeCloseTo(0.36 * (0.2666666667 / 0.35), 8);
    expect(r[3].limiteSuperiorPct).toBeNull();
  });

  it("painel: o CMV projetado e as semanas vêm junto com o resultado", () => {
    const p = calcularPainel({ config: novembro, categorias: CATEGORIAS, notas: NOTAS, vendas: VENDAS_1_A_8, hoje: "2026-11-09", regua: REGUA });
    expect(p.cmvProjetado.porCategoria).toHaveLength(4);
    expect(p.cmvSemanas.semanas).toHaveLength(4);
    expect(p.cmvSemanas.semanas[0].situacao).toBe("fechada");
  });
});
