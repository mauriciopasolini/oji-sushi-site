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
    expect(gerarAlertas({ painel: p, ehAdmin: true, fornecedoresNovos: 2 }).find((x) => x.id === "fornecedores-novos")?.href).toBe("/painel/cmv/fornecedores?filtro=novos");
    expect(gerarAlertas({ painel: p, ehAdmin: false, fornecedoresNovos: 2 }).some((x) => x.id === "fornecedores-novos")).toBe(false);
  });

  it("alertas de caixa: conflitos, cupom não lançado, divergências, abas faltando/vazias, falha", () => {
    const a = gerarAlertas({
      painel: painel(vendasAte(9)),
      ehAdmin: true,
      caixa: {
        planilhaConfigurada: true,
        ultimaSync: { status: "erro", em: "2026-11-10T10:00:00Z", mensagem: "Sem acesso à planilha" },
        abasFaltando: ["2026-11-03"],
        abasVazias: ["2026-11-09"],
        divergencias: [{ data: "2026-11-08", turno: 2, tipo: "total_origem", origem: "oji_tele", diferenca: R(14), totalPlanilha: R(1024.72), totalCalculado: R(1010.72) }],
        mercadoSemNota: [{ data: "2026-11-05", valor: R(87.5) }],
        conflitosPendentes: 2,
      },
    });
    const ids = a.map((x) => x.id);
    expect(ids[0]).toBe("sync-erro"); // erro vem primeiro
    expect(ids).toEqual(expect.arrayContaining(["conflitos-venda", "mercado-sem-nota-2026-11-05", "divergencias-planilha", "abas-faltando", "abas-vazias"]));
    expect(a.find((x) => x.id === "mercado-sem-nota-2026-11-05")?.titulo.replace(/ /g, " ")).toBe("Possível cupom não lançado: Mercado R$ 87,50 em 05/11");
    expect(a.find((x) => x.id === "divergencias-planilha")?.detalhe?.replace(/ /g, " ")).toContain("08/11 T2 Oji Tele: Total R$ 1.024,72 × partes R$ 1.010,72");
  });

  it("planilha não configurada: aviso só para o admin; mês fechado não gera alertas de caixa", () => {
    const caixa = { planilhaConfigurada: false, ultimaSync: null, abasFaltando: [], abasVazias: [], divergencias: [], mercadoSemNota: [], conflitosPendentes: 0 };
    expect(gerarAlertas({ painel: painel(vendasAte(9)), ehAdmin: true, caixa }).some((x) => x.id === "planilha-nao-configurada")).toBe(true);
    expect(gerarAlertas({ painel: painel(vendasAte(9)), ehAdmin: false, caixa }).some((x) => x.id === "planilha-nao-configurada")).toBe(false);
    expect(gerarAlertas({ painel: painel(vendasAte(9)), ehAdmin: true, caixa: { ...caixa, planilhaConfigurada: true, conflitosPendentes: 3 }, mesFechado: true }).some((x) => x.id === "conflitos-venda")).toBe(false);
  });

  it("compras aguardando nota fiscal: aviso com contagem e link para as pendentes", () => {
    const p = painel(vendasAte(9));
    expect(gerarAlertas({ painel: p, ehAdmin: false }).some((a) => a.id === "compras-sem-nota")).toBe(false);
    const a = gerarAlertas({ painel: p, ehAdmin: false, comprasSemNota: 2 }).find((x) => x.id === "compras-sem-nota");
    expect(a?.titulo).toBe("2 compra(s) aguardando nota fiscal");
    expect(a?.nivel).toBe("aviso");
    expect(a?.href).toBe("/painel/cmv/notas?status=aguardando");
    // pendência é de qualquer mês: aparece mesmo olhando um mês fechado
    expect(gerarAlertas({ painel: p, ehAdmin: true, mesFechado: true, comprasSemNota: 1 }).some((x) => x.id === "compras-sem-nota")).toBe(true);
  });

  it("formata a lista de dias", () => {
    expect(listarDias(["2026-11-03"])).toBe("03/11");
    expect(listarDias(["2026-11-03", "2026-11-04", "2026-11-07"])).toBe("03, 04 e 07/11");
  });
});

describe("Ritmo de compra sem prorrateio (cenário de 10/11/2026)", () => {
  const nota = (data: string, reais: number): NotaCalc => ({ categoriaId: "pescados", data, valor: R(reais), status: "ativa" });
  const notas = [nota("2026-11-02", 6868.73), nota("2026-11-09", 5171.46)];

  it("compras de seg (S2) dentro do orçamento da semana inteira → sem alerta de ritmo", () => {
    const p = painel(vendasAte(9), notas);
    const alertas = gerarAlertas({ painel: p, ehAdmin: true });
    expect(alertas.some((a) => a.id.startsWith("ritmo-"))).toBe(false);
    expect(p.categorias[0].ritmo.cor).toBe("verde");
  });

  it("acima das semanas encerradas + orçamento inteiro da semana atual → alerta de ritmo (ou de semana estourada)", () => {
    const p = painel(vendasAte(9), [...notas, nota("2026-11-10", 9000)]);
    const alertas = gerarAlertas({ painel: p, ehAdmin: true });
    expect(p.categorias[0].ritmo.desvio).toBeGreaterThan(0);
    expect(alertas.some((a) => a.id.startsWith("ritmo-") || a.id.startsWith("estouro-semana-"))).toBe(true);
  });
});
