import { describe, expect, it } from "vitest";
import { estoqueDoMes } from "./contagem";
import { centavos } from "./dinheiro";
import { calcularCmv } from "./engine";
import { padroesDoFornecedor } from "./padroes-fornecedor";

describe("padrões do lançamento por fornecedor", () => {
  it("usa o tipo e a forma cadastrados (Frumar: NF-e/boleto; Fruteira: comanda; Mercado: cupom)", () => {
    expect(padroesDoFornecedor({ prazo: null, tipoPadrao: "nfe", formaPadrao: "boleto" })).toEqual({ tipo: "nfe", forma: "boleto" });
    expect(padroesDoFornecedor({ prazo: null, tipoPadrao: "comanda", formaPadrao: null })).toEqual({ tipo: "comanda", forma: "caixa" });
    expect(padroesDoFornecedor({ prazo: null, tipoPadrao: "cupom", formaPadrao: "pix" })).toEqual({ tipo: "cupom", forma: "pix" });
  });
  it("sem padrão: NF-e; boleto com prazo, caixa sem prazo (regra antiga)", () => {
    expect(padroesDoFornecedor({ prazo: 28, tipoPadrao: null, formaPadrao: null })).toEqual({ tipo: "nfe", forma: "boleto" });
    expect(padroesDoFornecedor({ prazo: null, tipoPadrao: null, formaPadrao: null })).toEqual({ tipo: "nfe", forma: "caixa" });
    expect(padroesDoFornecedor({ prazo: 0, tipoPadrao: null, formaPadrao: null }).forma).toBe("boleto");
  });
});

describe("rascunho de contagem não afeta nenhum cálculo", () => {
  const contagens = [
    { competencia: "2026-11-01", status: "finalizada" as const, valores: [1123.75, "75.00"] },
    { competencia: "2026-12-01", status: "rascunho" as const, valores: [5000] },
  ];
  it("só a contagem finalizada vira estoque; rascunho = sem contagem", () => {
    expect(estoqueDoMes(contagens, "2026-11-01", centavos)).toBe(119_875);
    expect(estoqueDoMes(contagens, "2026-12-01", centavos)).toBeNull();
    expect(estoqueDoMes(contagens, "2027-01-01", centavos)).toBeNull();
  });
  it("com o final em rascunho, dezembro continua no CMV de compras (sem CMV real)", () => {
    const estoqueInicial = estoqueDoMes(contagens, "2026-11-01", centavos);
    const estoqueFinal = estoqueDoMes(contagens, "2026-12-01", centavos);
    const r = calcularCmv({ compras: 3_000_000, vendaCaixa: 10_000_000, estoqueInicial, estoqueFinal, regua: [] });
    expect(r.tipo).toBe("compras");
    expect(r.cmvReal).toBeNull();
  });
});
