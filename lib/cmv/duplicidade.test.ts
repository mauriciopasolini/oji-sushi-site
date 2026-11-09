import { describe, expect, it } from "vitest";
import { DUPLICIDADE, type NotaComparavel, janelaDeBusca, notasParecidas } from "./duplicidade";

const FRUMAR = "f-frumar";
const nota = (id: string, data: string, valor: number, extra: Partial<NotaComparavel> = {}): NotaComparavel => ({
  id, fornecedorId: FRUMAR, data, valor, tipo: "nfe", status: "ativa", ...extra,
});

describe("aviso de possível duplicidade", () => {
  it("constantes padrão: 5% e 15 dias", () => {
    expect(DUPLICIDADE.tolerancia).toBe(0.05);
    expect(DUPLICIDADE.janelaDias).toBe(15);
  });

  it("acha nota do mesmo fornecedor com valor até 5% diferente em até 15 dias", () => {
    const r = notasParecidas({ fornecedorId: FRUMAR, data: "2026-11-20", valor: 104_000 }, [nota("a", "2026-11-10", 100_000)]);
    expect(r.map((x) => x.id)).toEqual(["a"]);
  });

  it("limites inclusivos: exatamente 5% e exatamente 15 dias contam", () => {
    const r = notasParecidas({ fornecedorId: FRUMAR, data: "2026-11-16", valor: 105_000 }, [nota("a", "2026-11-01", 100_000)]);
    expect(r).toHaveLength(1);
  });

  it("ignora: valor acima de 5%, mais de 15 dias, outro fornecedor, cancelada e a própria nota", () => {
    const existentes = [
      nota("valor", "2026-11-10", 100_000),
      nota("longe", "2026-10-25", 100_500),
      nota("outro", "2026-11-10", 100_500, { fornecedorId: "f-femsa" }),
      nota("cancelada", "2026-11-10", 100_500, { status: "cancelada" }),
      nota("propria", "2026-11-10", 100_500),
    ];
    const r = notasParecidas({ id: "propria", fornecedorId: FRUMAR, data: "2026-11-10", valor: 105_100 + 1 }, existentes);
    // 105.101 vs 100.000 = 5,1% → fora; 100.500 está a 4,58% mas é longe/outro/cancelada/própria
    expect(r.map((x) => x.id)).toEqual([]);
    expect(notasParecidas({ fornecedorId: FRUMAR, data: "2026-11-10", valor: 105_001 }, [nota("x", "2026-11-10", 100_000)])).toEqual([]);
  });

  it("vale também para nota com data anterior à existente (lançamento atrasado)", () => {
    const r = notasParecidas({ fornecedorId: FRUMAR, data: "2026-11-01", valor: 50_000 }, [nota("a", "2026-11-12", 49_000)]);
    expect(r).toHaveLength(1);
  });

  it("'sem nota (aguardando)' vem primeiro; depois valor mais próximo", () => {
    const r = notasParecidas({ fornecedorId: FRUMAR, data: "2026-11-15", valor: 100_000 }, [
      nota("igual", "2026-11-14", 100_000),
      nota("perto", "2026-11-14", 98_000),
      nota("pendente", "2026-11-05", 97_000, { tipo: "sem_nota" }),
    ]);
    expect(r.map((x) => x.id)).toEqual(["pendente", "igual", "perto"]);
  });

  it("tolerância e janela configuráveis", () => {
    const base = [nota("a", "2026-11-01", 100_000)];
    expect(notasParecidas({ fornecedorId: FRUMAR, data: "2026-11-08", valor: 109_000 }, base, { tolerancia: 0.1 })).toHaveLength(1);
    expect(notasParecidas({ fornecedorId: FRUMAR, data: "2026-11-08", valor: 100_000 }, base, { janelaDias: 5 })).toHaveLength(0);
  });

  it("janela de busca no banco: ±15 dias, atravessando o mês", () => {
    expect(janelaDeBusca("2026-11-05")).toEqual({ de: "2026-10-21", ate: "2026-11-20" });
  });
});
