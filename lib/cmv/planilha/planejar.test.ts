import { describe, expect, it } from "vitest";
import { type Grade, lerAbaDiaria } from "./parser";
import { type VendaExistente, assinatura, planejarSincronizacao } from "./planejar";

const R = (reais: number) => Math.round(reais * 100);

// Aba simplificada no layout real (blocos lado a lado, seções lado a lado).
function aba(t1: { restPix: number; ojiOnline: number; ojiTotal?: number; mercado?: number }, t2 = { restPix: 100, ojiOnline: 50 }): Grade {
  const g: Grade = [];
  const set = (ref: string, v: string | number) => {
    const c = ref.charCodeAt(0) - 65;
    const l = Number(ref.slice(1)) - 1;
    (g[l] ??= [])[c] = v;
  };
  set("B1", "TURNO 1");
  set("I1", "TURNO 2");
  for (const [base, val, desp, res, dados] of [
    ["A", "C", "E", "F", t1],
    ["H", "J", "L", "M", t2],
  ] as const) {
    const col = (ch: string, d: number) => String.fromCharCode(ch.charCodeAt(0) + d);
    set(`${base}4`, "Restaurante");
    set(`${base}5`, "Dinheiro");
    set(`${base}8`, "Pix");
    set(`${val}8`, dados.restPix);
    set(`${base}9`, "Total");
    set(`${val}9`, dados.restPix);
    set(`${desp}4`, "Despesas");
    set(`${desp}5`, "Mercado");
    if ("mercado" in dados && dados.mercado) set(`${res}5`, dados.mercado);
    set(`${desp}11`, "Total do Dia");
    set(`${res}11`, dados.restPix + dados.ojiOnline);
    set(`${base}11`, "Oji Tele");
    set(`${base}12`, "Qtd. Pedidos");
    set(`${val}12`, 3);
    set(`${base}15`, "Online");
    set(`${val}15`, dados.ojiOnline);
    set(`${base}16`, "Total");
    set(`${val}16`, ("ojiTotal" in dados && dados.ojiTotal) || dados.ojiOnline);
    for (const [n, nome] of [
      [18, "Shakai Tele"],
      [25, "Wabi Tele"],
    ] as const)
      set(`${base}${n}`, nome);
    void col;
  }
  for (let i = 0; i < g.length; i++) g[i] ??= [];
  return g;
}

const ler = (g: Grade, titulo: string) => ({ titulo, aba: lerAbaDiaria(g), grade: g });
const vazio = { dinheiro: 0, credito: 0, debito: 0, pix: 0, loja_dinheiro: 0, loja_cartao: 0, online: 0 };

describe("Planejamento da sincronização", () => {
  const dias = ["2026-11-01", "2026-11-02", "2026-11-03"];
  const lidas = new Map([
    ["2026-11-01", ler(aba({ restPix: 1000, ojiOnline: 500 }), "01/11")],
    ["2026-11-02", ler(aba({ restPix: 0, ojiOnline: 0 }, { restPix: 0, ojiOnline: 0 }).map((l) => l.map((c) => (typeof c === "number" ? null : c))), "02/11")],
  ]);

  it("grava 8 linhas por dia lido (2 turnos × 4 origens) e 2 fechamentos", () => {
    const p = planejarSincronizacao({ diasEsperados: dias, lidas, existentes: [], decisoesManterManual: [] });
    expect(p.diasLidos).toEqual(["2026-11-01"]);
    expect(p.gravarVendas).toHaveLength(8);
    expect(p.gravarFechamentos).toHaveLength(2);
    expect(p.gravarVendas.find((v) => v.turno === 1 && v.origem === "restaurante")?.campos.pix).toBe(R(1000));
    expect(p.gravarFechamentos[0].bruto).toMatchObject({ aba: "01/11" });
  });

  it("aba vazia e aba faltando viram alerta e não gravam nada", () => {
    const p = planejarSincronizacao({ diasEsperados: dias, lidas, existentes: [], decisoesManterManual: [] });
    expect(p.abasVazias).toEqual(["2026-11-02"]);
    expect(p.abasFaltando).toEqual(["2026-11-03"]);
  });

  it("linha da planilha que já existe é atualizada (idempotente)", () => {
    const existentes: VendaExistente[] = [{ data: "2026-11-01", turno: 1, origem: "restaurante", fonte: "planilha", campos: { ...vazio, pix: 1 }, qtdPedidos: null }];
    const p = planejarSincronizacao({ diasEsperados: dias, lidas, existentes, decisoesManterManual: [] });
    expect(p.conflitos).toEqual([]);
    expect(p.gravarVendas).toHaveLength(8);
  });

  it("venda MANUAL diferente da planilha → conflito; a manual não é sobrescrita", () => {
    const existentes: VendaExistente[] = [{ data: "2026-11-01", turno: 1, origem: "restaurante", fonte: "manual", campos: { ...vazio, pix: R(900) }, qtdPedidos: null }];
    const p = planejarSincronizacao({ diasEsperados: dias, lidas, existentes, decisoesManterManual: [] });
    expect(p.conflitos).toHaveLength(1);
    expect(p.conflitos[0]).toMatchObject({ turno: 1, origem: "restaurante", totalManual: R(900), totalPlanilha: R(1000) });
    expect(p.gravarVendas.some((v) => v.turno === 1 && v.origem === "restaurante")).toBe(false);
    expect(p.gravarVendas).toHaveLength(7);
  });

  it("venda manual IGUAL à planilha → conciliada (passa a ser da planilha), sem conflito", () => {
    const existentes: VendaExistente[] = [{ data: "2026-11-01", turno: 1, origem: "restaurante", fonte: "manual", campos: { ...vazio, pix: R(1000) }, qtdPedidos: null }];
    const p = planejarSincronizacao({ diasEsperados: dias, lidas, existentes, decisoesManterManual: [] });
    expect(p.conflitos).toEqual([]);
    expect(p.conciliadas).toEqual([{ data: "2026-11-01", turno: 1, origem: "restaurante" }]);
    expect(p.gravarVendas).toHaveLength(8);
  });

  it("decisão 'manter manual' vale enquanto a planilha não mudar; se mudar, o conflito volta", () => {
    const existentes: VendaExistente[] = [{ data: "2026-11-01", turno: 1, origem: "restaurante", fonte: "manual", campos: { ...vazio, pix: R(900) }, qtdPedidos: null }];
    const valoresPlanilha = { campos: { ...vazio, pix: R(1000) }, qtdPedidos: null };
    const decisao = { data: "2026-11-01", turno: 1 as const, origem: "restaurante" as const, assinatura: assinatura(valoresPlanilha) };
    let p = planejarSincronizacao({ diasEsperados: dias, lidas, existentes, decisoesManterManual: [decisao] });
    expect(p.conflitos).toEqual([]);
    expect(p.conflitosJaDecididos).toBe(1);

    const mudou = new Map(lidas);
    mudou.set("2026-11-01", ler(aba({ restPix: 1100, ojiOnline: 500 }), "01/11"));
    p = planejarSincronizacao({ diasEsperados: dias, lidas: mudou, existentes, decisoesManterManual: [decisao] });
    expect(p.conflitos).toHaveLength(1);
    expect(p.conflitos[0].totalPlanilha).toBe(R(1100));
  });

  it("divergência entre o Total da origem e as partes vira alerta (usa as partes)", () => {
    const comErro = new Map([["2026-11-01", ler(aba({ restPix: 1000, ojiOnline: 1010.72, ojiTotal: 1024.72 }), "01/11")]]);
    const p = planejarSincronizacao({ diasEsperados: ["2026-11-01"], lidas: comErro, existentes: [], decisoesManterManual: [] });
    expect(p.divergencias).toEqual([
      expect.objectContaining({ tipo: "total_origem", turno: 1, origem: "oji_tele", totalPlanilha: R(1024.72), totalCalculado: R(1010.72), diferenca: R(14) }),
    ]);
    expect(p.gravarVendas.find((v) => v.turno === 1 && v.origem === "oji_tele")?.campos.online).toBe(R(1010.72));
  });

  it("despesa Mercado do caixa vai para o fechamento do turno", () => {
    const comMercado = new Map([["2026-11-01", ler(aba({ restPix: 1000, ojiOnline: 500, mercado: 87.5 }), "01/11")]]);
    const p = planejarSincronizacao({ diasEsperados: ["2026-11-01"], lidas: comMercado, existentes: [], decisoesManterManual: [] });
    expect(p.gravarFechamentos.find((f) => f.turno === 1)?.despesaMercado).toBe(R(87.5));
  });
});

describe("aba do dia em andamento (parser → dia parcial)", () => {
  it("turno 2 ainda em branco → parcial com o total do turno 1; os dois preenchidos → completo", async () => {
    const { avaliarDiaAtual } = await import("../dia-atual");
    const parcial = avaliarDiaAtual("2026-11-09", lerAbaDiaria(aba({ restPix: 500, ojiOnline: 249.65 }, { restPix: 0, ojiOnline: 0 })));
    expect(parcial.completo).toBe(false);
    expect(parcial.turnos).toEqual([
      { turno: 1, total: R(749.65) },
      { turno: 2, total: null },
    ]);
    const completo = avaliarDiaAtual("2026-11-09", lerAbaDiaria(aba({ restPix: 500, ojiOnline: 249.65 })));
    expect(completo.completo).toBe(true);
    expect(completo.turnos[1].total).toBe(R(150));
  });
});

describe("dia gravado no meio do preenchimento é atualizado nas sincronizações seguintes", () => {
  it("linhas da planilha já gravadas (T2 só com restaurante) são regravadas com os valores completos", () => {
    const dia = "2026-11-10";
    // 1ª sincronização: T2 só com o restaurante → o dia já conta como completo e é gravado
    const antes = lerAbaDiaria(aba({ restPix: 500, ojiOnline: 249.65 }, { restPix: 100, ojiOnline: 0 }));
    const p1 = planejarSincronizacao({ diasEsperados: [dia], lidas: new Map([[dia, { titulo: "10/11", aba: antes, grade: [] }]]), existentes: [], decisoesManterManual: [] });
    const gravadas: VendaExistente[] = p1.gravarVendas.map((v) => ({ ...v, fonte: "planilha" }));
    expect(gravadas.find((v) => v.turno === 2 && v.origem === "oji_tele")!.campos.online).toBe(0);

    // Sincronização seguinte (no mesmo dia ou às 04:00): teles preenchidas
    const depois = lerAbaDiaria(aba({ restPix: 500, ojiOnline: 249.65 }, { restPix: 100, ojiOnline: 80 }));
    const p2 = planejarSincronizacao({ diasEsperados: [dia], lidas: new Map([[dia, { titulo: "10/11", aba: depois, grade: [] }]]), existentes: gravadas, decisoesManterManual: [] });
    expect(p2.conflitos).toEqual([]);
    expect(p2.gravarVendas).toHaveLength(8);
    expect(p2.gravarVendas.find((v) => v.turno === 2 && v.origem === "oji_tele")!.campos.online).toBe(R(80));
  });
});
