import { describe, expect, it } from "vitest";
import { gerarAlertas, listarDias } from "./alertas";
import { type ConfigMes, type NotaCalc, calcularPainel, diasSemVenda } from "./engine";

const R = (reais: number) => Math.round(reais * 100);
const novembro: ConfigMes = {
  competencia: "2026-11-01",
  metaVenda: R(95000),
  metaCmvPct: 0.35,
  pesosSemana: [6.5, 6.5, 5.5, 5.5],
  limiteAcumuloPct: 1.25,
  pesosDiaSemana: [3300, 2700, 2500, 3300, 2950, 3700, 4200],
};
const CATS = [{ id: "pescados", nome: "Pescados e Linha Seca", pctMeta: 24 / 90 }];
const vendasAte = (ultimoDia: number) =>
  Array.from({ length: ultimoDia }, (_, i) => ({ data: `2026-11-${String(i + 1).padStart(2, "0")}`, total: R(3000) }));
const painel = (vendas: ReturnType<typeof vendasAte>, notas: NotaCalc[] = [], hoje = "2026-11-10") =>
  calcularPainel({ config: novembro, categorias: CATS, notas, vendas, hoje, regua: [] });

describe("Dias sem venda (orçamento provisório)", () => {
  it("lista os dias de 1 até ontem sem venda", () => {
    expect(diasSemVenda("2026-11-01", "2026-11-05", ["2026-11-01", "2026-11-03"])).toEqual(["2026-11-02", "2026-11-04"]);
  });

  it("hoje não conta; dia 1º do mês não tem pendência", () => {
    expect(diasSemVenda("2026-11-01", "2026-11-01", [])).toEqual([]);
    expect(diasSemVenda("2026-11-01", "2026-11-02", ["2026-11-01"])).toEqual([]);
  });

  it("mês encerrado: todos os dias do mês precisam de venda", () => {
    expect(diasSemVenda("2026-11-01", "2026-12-05", []).length).toBe(30);
  });

  it("painel com vendas até ontem → completo; faltando dias → provisório", () => {
    expect(painel(vendasAte(9)).vendasIncompletas).toBe(false);
    const p = painel(vendasAte(7));
    expect(p.vendasIncompletas).toBe(true);
    expect(p.diasSemVenda).toEqual(["2026-11-08", "2026-11-09"]);
  });

  it("dia registrado com venda zero (ex.: fechado) conta como registrado", () => {
    const p = calcularPainel({
      config: novembro, categorias: CATS, notas: [], vendas: vendasAte(8), hoje: "2026-11-10", regua: [],
      diasComVenda: [...vendasAte(8).map((v) => v.data), "2026-11-09"],
    });
    expect(p.vendasIncompletas).toBe(false);
  });
});

describe("Alertas do painel", () => {
  it("aviso de orçamento provisório com os dias faltantes", () => {
    const a = gerarAlertas({ painel: painel(vendasAte(6)), ehAdmin: false });
    expect(a[0].id).toBe("vendas-incompletas");
    expect(a[0].titulo).toBe("Dados de venda incompletos: orçamento provisório");
    expect(a[0].detalhe).toContain("07, 08 e 09/11");
  });

  it("sem aviso quando as vendas estão completas", () => {
    expect(gerarAlertas({ painel: painel(vendasAte(9)), ehAdmin: false }).some((x) => x.id === "vendas-incompletas")).toBe(false);
  });

  it("estouro do mês é erro e vem primeiro", () => {
    const a = gerarAlertas({ painel: painel(vendasAte(6), [{ categoriaId: "pescados", data: "2026-11-02", valor: R(40000) }]), ehAdmin: false });
    expect(a[0].nivel).toBe("erro");
    expect(a[0].titulo).toContain("teto do mês estourado");
  });

  it("estouro da semana avisa que as próximas semanas foram reduzidas", () => {
    const a = gerarAlertas({ painel: painel(vendasAte(9), [{ categoriaId: "pescados", data: "2026-11-09", valor: R(9000) }]), ehAdmin: false });
    expect(a.find((x) => x.id === "estouro-semana-pescados")?.detalhe).toContain("próximas semanas");
  });

  it("fornecedores novos só aparecem para o admin", () => {
    const p = painel(vendasAte(9));
    expect(gerarAlertas({ painel: p, ehAdmin: true, fornecedoresNovos: 2 }).some((x) => x.id === "fornecedores-novos")).toBe(true);
    expect(gerarAlertas({ painel: p, ehAdmin: false, fornecedoresNovos: 2 }).some((x) => x.id === "fornecedores-novos")).toBe(false);
  });

  it("formata a lista de dias", () => {
    expect(listarDias(["2026-11-03"])).toBe("03/11");
    expect(listarDias(["2026-11-03", "2026-11-04", "2026-11-07"])).toBe("03, 04 e 07/11");
  });
});
