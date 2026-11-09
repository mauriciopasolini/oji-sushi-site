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

// -----------------------------------------------------------------------------
// Aba REAL "08/11" da planilha "Caixas OJI Sushi", transcrita célula a célula
// (lida pela API em 10/11/2026). Layout: TURNO 1 em B1 e TURNO 2 em I1, com o
// bloco 2 começando em H; Restaurante | Despesas lado a lado; resumo na coluna E/L.
// -----------------------------------------------------------------------------
const ABA_REAL_0811 = `
B1="TURNO 1"  I1="TURNO 2"
A2="DATA:"  E2="OPERADOR"  I2="DATA:"  L2="OPERADOR"
A4="Restaurante"  E4="Despesas"  H4="Restaurante"  L4="Despesas"
A5="Dinheiro"  C5=53.97  E5="Mercado"  H5="Dinheiro"  J5=114.72  L5="Mercado"
A6="Crédito"  C6=374.15  E6="Motoboy"  H6="Crédito"  J6=367.36  L6="Motoboy"
A7="Débito"  C7=371.21  E7="Outros"  H7="Débito"  J7=549.22  L7="Outros"  M7=70
A8="Pix"  C8=44.07  E8="Total"  F8=0  H8="Pix"  J8=428.66  L8="Total"  M8=70
A9="Total"  C9=843.4  H9="Total"  J9=1459.9600000000003
A11="Oji Tele"  E11="Total do Dia"  F11=2253.81  H11="Oji Tele"  L11="Total do Dia"  M11=2792.7700000000004
A12="Qtd. Pedidos"  C12=17  E12="Total Pedidos"  F12=20  H12="Qtd. Pedidos"  J12=14  L12="Total Pedidos"  M12=18
A13="Loja"  B13="Dinheiro"  E13="Dinheiro em Caixa"  F13=97.91  H13="Loja"  I13="Dinheiro"  L13="Dinheiro em Caixa"  M13=187.52999999999997
B14="Cartão"  I14="Cartão"
A15="Online"  C15=1222.53  H15="Online"  J15=1010.72
A16="Total"  C16=1222.53  H16="Total"  J16=1010.72
A18="Shakai Tele"  H18="Shakai Tele"
A19="Qtd. Pedidos"  C19=2  H19="Qtd. Pedidos"  J19=1
A20="Loja"  B20="Dinheiro"  C20=43.94  H20="Loja"  I20="Dinheiro"
B21="Cartão"  I21="Cartão"
A22="Online"  C22=91.56  H22="Online"  J22=89.9
A23="Total"  C23=135.5  H23="Total"  J23=89.9
A25="Wabi Tele"  H25="Wabi Tele"
A26="Qtd. Pedidos"  C26=1  H26="Qtd. Pedidos"  J26=3
A27="Loja"  B27="Dinheiro"  H27="Loja"  I27="Dinheiro"  J27=142.81
B28="Cartão"  C28=52.38  I28="Cartão"
A29="Online"  H29="Online"  J29=89.38
A30="Total"  C30=52.38  H30="Total"  J30=232.19`;

/** "A1=valor  B2=..." → grade */
function gradeDe(texto: string): Grade {
  const g: Grade = [];
  for (const m of texto.matchAll(/([A-Z]+)(\d+)=("(?:[^"\\]|\\.)*"|[-\d.]+)/g)) {
    const coluna = [...m[1]].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const linha = Number(m[2]) - 1;
    (g[linha] ??= [])[coluna] = m[3].startsWith('"') ? JSON.parse(m[3]) : Number(m[3]);
  }
  for (let i = 0; i < g.length; i++) g[i] ??= [];
  return g;
}

describe("Leitor — aba real 08/11 (layout da planilha Caixas OJI Sushi)", () => {
  const aba = lerAbaDiaria(gradeDe(ABA_REAL_0811));
  const [t1, t2] = aba.turnos;

  it("sem avisos", () => expect(aba.avisos).toEqual([]));

  it("Turno 1: Restaurante 843,40 · Oji 1.222,53 · Shakai 135,50 · Wabi 52,38 = Total do Dia 2.253,81", () => {
    expect(t1.origens.restaurante.campos).toMatchObject({ dinheiro: R(53.97), credito: R(374.15), debito: R(371.21), pix: R(44.07) });
    expect(t1.origens.restaurante.totalCalculado).toBe(R(843.4));
    expect(t1.origens.oji_tele.totalCalculado).toBe(R(1222.53));
    expect(t1.origens.shakai_tele.campos).toMatchObject({ loja_dinheiro: R(43.94), online: R(91.56) });
    expect(t1.origens.shakai_tele.totalCalculado).toBe(R(135.5));
    expect(t1.origens.wabi_tele.campos.loja_cartao).toBe(R(52.38));
    expect(t1.somaOrigens).toBe(R(2253.81));
    expect(t1.totalDia).toBe(R(2253.81));
    expect(t1.divergenciaTotalDia).toBe(0);
  });

  it("Turno 2: Restaurante 1.459,96 · Oji 1.010,72 · Shakai 89,90 · Wabi 232,19 = Total do Dia 2.792,77", () => {
    expect(t2.origens.restaurante.totalCalculado).toBe(R(1459.96));
    expect(t2.origens.oji_tele.totalCalculado).toBe(R(1010.72));
    expect(t2.origens.shakai_tele.totalCalculado).toBe(R(89.9));
    expect(t2.origens.wabi_tele.campos).toMatchObject({ loja_dinheiro: R(142.81), online: R(89.38) });
    expect(t2.origens.wabi_tele.totalCalculado).toBe(R(232.19));
    expect(t2.somaOrigens).toBe(R(2792.77));
    expect(t2.divergenciaTotalDia).toBe(0);
  });

  it("dia = 5.046,58; nenhuma divergência de origem", () => {
    expect(t1.somaOrigens + t2.somaOrigens).toBe(R(5046.58));
    for (const t of aba.turnos) for (const o of Object.values(t.origens)) expect(o.divergencia).toBe(0);
  });

  it("pedidos, despesas e dinheiro em caixa", () => {
    expect([t1.origens.oji_tele.qtdPedidos, t1.origens.shakai_tele.qtdPedidos, t1.origens.wabi_tele.qtdPedidos]).toEqual([17, 2, 1]);
    expect([t2.origens.oji_tele.qtdPedidos, t2.origens.shakai_tele.qtdPedidos, t2.origens.wabi_tele.qtdPedidos]).toEqual([14, 1, 3]);
    expect(t1.totalPedidos).toBe(20);
    expect(t2.totalPedidos).toBe(18);
    expect(t1.despesas).toEqual({ mercado: 0, motoboy: 0, outros: 0, total: 0 });
    expect(t2.despesas).toEqual({ mercado: 0, motoboy: 0, outros: R(70), total: R(70) });
    expect(t1.dinheiroEmCaixa).toBe(R(97.91));
    expect(t2.dinheiroEmCaixa).toBe(R(187.53));
  });

  it("valores do resumo (coluna E/F) não vazam para as seções da esquerda", () => {
    // "Dinheiro" da Loja do Oji (B13) está vazio; ao lado, na mesma linha, está "Dinheiro em Caixa" 97,91
    expect(t1.origens.oji_tele.campos.loja_dinheiro).toBe(0);
  });

  it("o mesmo erro de fórmula (Total ≠ partes) seria detectado neste layout", () => {
    const g = gradeDe(ABA_REAL_0811);
    g[15][9] = 1024.72; // J16: Total do Oji Tele T2 com o erro de 14,00
    const oji = lerAbaDiaria(g).turnos[1].origens.oji_tele;
    expect(oji.totalCalculado).toBe(R(1010.72));
    expect(oji.divergencia).toBe(R(14));
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
