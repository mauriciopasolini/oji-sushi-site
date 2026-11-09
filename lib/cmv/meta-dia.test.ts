import { describe, expect, it } from "vitest";
import { compararComMeta } from "./meta-dia";

const nbsp = (s: string) => s.replace(/ /g, " ");

describe("total do dia × meta do dia (tela Vendas)", () => {
  it("acima da meta: ▲ e diferença positiva (01/11/2026 real)", () => {
    const c = compararComMeta(376_302, 324_534, true)!;
    expect(c.sentido).toBe("acima");
    expect(c.diferenca).toBe(51_768);
    expect(nbsp(c.texto)).toBe("+R$ 517,68 (+16,0%) vs. meta");
  });
  it("exatamente na meta conta como acima", () => {
    const c = compararComMeta(100_000, 100_000, true)!;
    expect(c.sentido).toBe("acima");
    expect(nbsp(c.texto)).toBe("+R$ 0,00 (+0,0%) vs. meta");
  });
  it("abaixo da meta: ▼ e diferença negativa", () => {
    const c = compararComMeta(90_000, 100_000, true)!;
    expect(c.sentido).toBe("abaixo");
    expect(c.diferenca).toBe(-10_000);
    expect(nbsp(c.texto)).toBe("−R$ 100,00 (−10,0%) vs. meta");
  });
  it("neutro: sem venda registrada, sem movimento (zero) ou sem meta", () => {
    expect(compararComMeta(0, 100_000, false)).toBeNull();
    expect(compararComMeta(0, 100_000, true)).toBeNull();
    expect(compararComMeta(50_000, 0, true)).toBeNull();
  });
});
