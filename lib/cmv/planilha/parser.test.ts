import { describe, expect, it } from "vitest";
import { type Grade, dataDaAba, idDaPlanilha, lerAbaDiaria, normalizar, numeroCentavos } from "./parser";

// -----------------------------------------------------------------------------
// Planilha sintética com os valores conhecidos do dia 08/11 (informados pelo Mauricio).
// O layout real será conferido com a aba de verdade; aqui o objetivo é testar as regras.
// -----------------------------------------------------------------------------
type Bloco = (string | number | null)[][];

function blocoTurno(t: {
  titulo: string;
  restaurante: [number, number, number, number]; // dinheiro, crédito, débito, pix
  teles: { nome: string; qtd: number; dinheiro: number; cartao: number; online: number; total: number }[];
  despesas: [number, number, number];
  totalDia: number;
  totalPedidos: number;
  caixa: number;
  comoTexto?: boolean;
}): Bloco {
  const v = (n: number) => (t.comoTexto ? `R$ ${n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}` : n);
  const [di, cr, de, px] = t.restaurante;
  const linhas: Bloco = [
    [t.titulo, null],
    ["Restaurante", null],
    ["Dinheiro", v(di)],
    ["Crédito", v(cr)],
    ["Débito", v(de)],
    ["Pix", px === 0 ? null : v(px)], // célula vazia = 0
    ["Total", v(di + cr + de + px)],
  ];
  for (const tele of t.teles) {
    linhas.push([tele.nome, null], ["Qtd. Pedidos", tele.qtd], ["Loja", null], ["Dinheiro", v(tele.dinheiro)], ["Cartão", v(tele.cartao)], ["Online", v(tele.online)], ["Total", v(tele.total)]);
  }
  linhas.push(["Despesas", null], ["Mercado", v(t.despesas[0])], ["Motoboy", v(t.despesas[1])], ["Outros", v(t.despesas[2])], ["Total", v(t.despesas.reduce((a, b) => a + b, 0))]);
  linhas.push(["Total do Dia", v(t.totalDia)], ["Total Pedidos", t.totalPedidos], ["Dinheiro em Caixa", v(t.caixa)]);
  return linhas;
}

const turno1 = blocoTurno({
  titulo: "TURNO 1",
  restaurante: [120.0, 400.4, 200.0, 123.0], // 843,40
  teles: [
    { nome: "Oji Tele", qtd: 14, dinheiro: 80.0, cartao: 300.0, online: 842.53, total: 1222.53 },
    { nome: "Shakai Tele", qtd: 2, dinheiro: 0, cartao: 0, online: 135.5, total: 135.5 },
    { nome: "Wabi Tele", qtd: 1, dinheiro: 52.38, cartao: 0, online: 0, total: 52.38 },
  ],
  despesas: [45.9, 60.0, 0],
  totalDia: 2253.81,
  totalPedidos: 17,
  caixa: 252.38,
});
const turno2 = blocoTurno({
  titulo: "TURNO 2",
  restaurante: [200.0, 700.0, 300.0, 259.96], // 1.459,96
  teles: [
    // Erro real da planilha: Total 1.024,72 com partes somando 1.010,72 (diferença 14,00 = Qtd. Pedidos)
    { nome: "Oji Tele", qtd: 14, dinheiro: 0, cartao: 0, online: 1010.72, total: 1024.72 },
    { nome: "Shakai Tele", qtd: 1, dinheiro: 0, cartao: 89.9, online: 0, total: 89.9 },
    { nome: "Wabi Tele", qtd: 3, dinheiro: 0, cartao: 0, online: 232.19, total: 232.19 },
  ],
  despesas: [0, 80.0, 12.5],
  totalDia: 2792.77,
  totalPedidos: 18,
  caixa: 200.0,
  comoTexto: true, // o turno 2 vem formatado "R$ 1.234,56"
});

/** Monta a aba com os dois blocos lado a lado, com deslocamentos opcionais. */
function montarAba({ linhasAntes = 1, colunasAntes = 0, espacoEntre = 1, colunaVaziaNoValor = false } = {}): Grade {
  const largura = colunaVaziaNoValor ? 3 : 2;
  const expandir = (l: (string | number | null)[]) => (colunaVaziaNoValor ? [l[0], null, l[1]] : l);
  const n = Math.max(turno1.length, turno2.length);
  const grade: Grade = Array.from({ length: linhasAntes }, () => []);
  grade[0] = ["Fechamento de caixa — 08/11"];
  for (let i = 0; i < n; i++) {
    const a = expandir(turno1[i] ?? [null, null]);
    const b = expandir(turno2[i] ?? [null, null]);
    grade.push([...Array(colunasAntes).fill(null), ...a, ...Array(espacoEntre).fill(null), ...b]);
  }
  void largura;
  return grade;
}

const R = (reais: number) => Math.round(reais * 100);

describe("Leitor da aba diária — valores conhecidos de 08/11", () => {
  const aba = lerAbaDiaria(montarAba());
  const [t1, t2] = aba.turnos;

  it("encontra os dois turnos sem avisos", () => {
    expect(aba.avisos).toEqual([]);
    expect(aba.turnos.map((t) => t.turno)).toEqual([1, 2]);
    expect(aba.vazia).toBe(false);
  });

  it("Turno 1: Restaurante 843,40 · Oji 1.222,53 · Shakai 135,50 · Wabi 52,38 · Total do Dia 2.253,81", () => {
    expect(t1.origens.restaurante.totalCalculado).toBe(R(843.4));
    expect(t1.origens.oji_tele.totalCalculado).toBe(R(1222.53));
    expect(t1.origens.shakai_tele.totalCalculado).toBe(R(135.5));
    expect(t1.origens.wabi_tele.totalCalculado).toBe(R(52.38));
    expect(t1.somaOrigens).toBe(R(2253.81));
    expect(t1.totalDia).toBe(R(2253.81));
    expect(t1.divergenciaTotalDia).toBe(0);
  });

  it("Turno 2: Restaurante 1.459,96 · Oji 1.010,72 · Shakai 89,90 · Wabi 232,19 · Total do Dia 2.792,77", () => {
    expect(t2.origens.restaurante.totalCalculado).toBe(R(1459.96));
    expect(t2.origens.oji_tele.totalCalculado).toBe(R(1010.72));
    expect(t2.origens.shakai_tele.totalCalculado).toBe(R(89.9));
    expect(t2.origens.wabi_tele.totalCalculado).toBe(R(232.19));
    expect(t2.somaOrigens).toBe(R(2792.77));
    expect(t2.totalDia).toBe(R(2792.77));
  });

  it("dia = 5.046,58", () => {
    expect(t1.somaOrigens + t2.somaOrigens).toBe(R(5046.58));
  });

  it("Oji Tele T2: usa a soma das partes e registra a divergência de 14,00 do Total da planilha", () => {
    const oji = t2.origens.oji_tele;
    expect(oji.totalPlanilha).toBe(R(1024.72));
    expect(oji.totalCalculado).toBe(R(1010.72));
    expect(oji.divergencia).toBe(R(14));
    expect(oji.qtdPedidos).toBe(14);
  });

  it("lê despesas, pedidos e dinheiro em caixa", () => {
    expect(t1.despesas).toEqual({ mercado: R(45.9), motoboy: R(60), outros: 0, total: R(105.9) });
    expect(t1.totalPedidos).toBe(17);
    expect(t2.dinheiroEmCaixa).toBe(R(200));
  });

  it("célula vazia = 0 (Pix vazio)", () => {
    const g = montarAba();
    // zera o Pix do T1 deixando a célula vazia
    const linhaPix = g.findIndex((l) => normalizar(l[0]) === "pix");
    g[linhaPix][1] = null;
    const t = lerAbaDiaria(g).turnos[0];
    expect(t.origens.restaurante.campos.pix).toBe(0);
    expect(t.origens.restaurante.divergencia).toBe(R(123)); // o Total da planilha ainda inclui o Pix
  });

  it("registra a célula de origem de cada valor (para depuração)", () => {
    expect(t1.celulas["restaurante.dinheiro"]).toMatch(/^B\d+$/);
    expect(t2.celulas["oji_tele.online"]).toMatch(/^E\d+$/);
  });
});

describe("Leitor: robustez a variações de layout", () => {
  const base = lerAbaDiaria(montarAba());
  const resumo = (a: ReturnType<typeof lerAbaDiaria>) =>
    a.turnos.map((t) => [t.somaOrigens, t.totalDia, t.origens.oji_tele.divergencia, t.despesas.motoboy]);

  it.each([
    ["linhas extras no topo", { linhasAntes: 4 }],
    ["colunas extras à esquerda", { colunasAntes: 2 }],
    ["mais espaço entre os blocos", { espacoEntre: 3 }],
    ["valor duas colunas à direita do rótulo", { colunaVaziaNoValor: true }],
  ])("%s → mesmos valores", (_nome, opcoes) => {
    expect(resumo(lerAbaDiaria(montarAba(opcoes)))).toEqual(resumo(base));
  });

  it("acentos, maiúsculas e espaços diferentes nos rótulos", () => {
    const g = montarAba().map((l) =>
      l.map((c) =>
        typeof c === "string"
          ? ({ "Crédito": "CREDITO", "Débito": "  débito ", "Qtd. Pedidos": "Qtd Pedidos", "Total do Dia": "TOTAL DO DIA", "Cartão": "cartao" } as Record<string, string>)[c] ?? c
          : c,
      ),
    );
    expect(resumo(lerAbaDiaria(g))).toEqual(resumo(base));
  });

  it("aba copiada e não preenchida → vazia", () => {
    const g = montarAba().map((l) => l.map((c) => (typeof c === "number" || (typeof c === "string" && c.startsWith("R$")) ? null : c)));
    expect(lerAbaDiaria(g).vazia).toBe(true);
  });

  it("sem as âncoras de turno → aviso", () => {
    const a = lerAbaDiaria([["Metas"], ["Semana 1", 1000]]);
    expect(a.turnos).toEqual([]);
    expect(a.avisos[0]).toContain("Âncoras de turno não encontradas");
  });
});

describe("Utilitários", () => {
  it("converte valores da planilha para centavos", () => {
    expect(numeroCentavos("R$ 1.234,56")).toBe(123456);
    expect(numeroCentavos("R$1.010,72")).toBe(101072);
    expect(numeroCentavos("1234,5")).toBe(123450);
    expect(numeroCentavos(1024.72)).toBe(102472);
    expect(numeroCentavos("1.234")).toBe(123400); // milhar sem decimais
    expect(numeroCentavos("12.50")).toBe(1250);
    expect(numeroCentavos("-R$ 10,00")).toBe(-1000);
    expect(numeroCentavos("(10,00)")).toBe(-1000);
    expect(numeroCentavos("")).toBeNull();
    expect(numeroCentavos("Total")).toBeNull();
    expect(numeroCentavos(null)).toBeNull();
  });

  it("nome da aba → data; Metas e Motoboys são ignoradas", () => {
    expect(dataDaAba("08/11", 2026)).toBe("2026-11-08");
    expect(dataDaAba(" 1/11 ", 2026)).toBe("2026-11-01");
    expect(dataDaAba("Metas", 2026)).toBeNull();
    expect(dataDaAba("Motoboys", 2026)).toBeNull();
    expect(dataDaAba("31/11", 2026)).toBeNull();
  });

  it("extrai o ID do link da planilha", () => {
    expect(idDaPlanilha("https://docs.google.com/spreadsheets/d/12HQ0ruMsynzcwTqDywTQtG4IJkWhl_LPncpUqHTOGg8/edit#gid=0")).toBe(
      "12HQ0ruMsynzcwTqDywTQtG4IJkWhl_LPncpUqHTOGg8",
    );
    expect(idDaPlanilha("https://exemplo.com")).toBeNull();
  });
});
