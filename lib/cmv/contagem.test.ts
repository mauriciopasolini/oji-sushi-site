import { describe, expect, it } from "vitest";
import { custoSugerido, formatarQuantidade, lerQuantidade, milesimos, quantidadeParaDecimal, tentarLerQuantidade, totalDaContagem, valorDoItem } from "./contagem";

describe("quantidade (milésimos inteiros)", () => {
  it("lê vírgula, ponto decimal, inteiro e milhar", () => {
    expect(lerQuantidade("12,5")).toBe(12_500);
    expect(lerQuantidade("0,250")).toBe(250);
    expect(lerQuantidade("3")).toBe(3_000);
    expect(lerQuantidade("1.5")).toBe(1_500);
    expect(lerQuantidade("1.234,5")).toBe(1_234_500);
    expect(lerQuantidade(",5")).toBe(500);
    expect(lerQuantidade(" ")).toBeNull();
  });

  it("recusa mais de 3 casas, negativo e texto", () => {
    expect(() => lerQuantidade("1,2345")).toThrow();
    expect(() => lerQuantidade("-1")).toThrow();
    expect(() => lerQuantidade("abc")).toThrow();
    expect(tentarLerQuantidade("abc")).toBeUndefined();
    expect(tentarLerQuantidade("")).toBeNull();
  });

  it("formata para o campo e para o banco; lê o numeric do banco", () => {
    expect(formatarQuantidade(12_500)).toBe("12,5");
    expect(formatarQuantidade(250)).toBe("0,25");
    expect(formatarQuantidade(3_000)).toBe("3");
    expect(quantidadeParaDecimal(12_345)).toBe("12.345");
    expect(quantidadeParaDecimal(250)).toBe("0.250");
    expect(milesimos(12.345)).toBe(12_345);
    expect(milesimos("3.000")).toBe(3_000);
  });
});

describe("valor do item = round(qtd × custo, 2), igual ao banco", () => {
  it("valores exatos", () => {
    expect(valorDoItem(12_500, 8_990)).toBe(112_375); // 12,5 kg × 89,90 = 1.123,75
    expect(valorDoItem(3_000, 2_500)).toBe(7_500);
  });
  it("meio centavo arredonda para cima (como o round do Postgres)", () => {
    expect(valorDoItem(1_500, 1)).toBe(2); // 1,5 × 0,01 = 0,015 → 0,02
    expect(valorDoItem(1_499, 1)).toBe(1);
    expect(valorDoItem(12_345, 8_990)).toBe(110_982); // 12,345 × 89,90 = 1.109,8155 → 1.109,82
  });
  it("total ignora itens sem quantidade e conta os vazios; quantidade 0 é preenchida", () => {
    expect(totalDaContagem([{ quantidade: 12_500, custo: 8_990 }, { quantidade: null, custo: 100 }, { quantidade: 0, custo: 500 }, { quantidade: 2_000, custo: null }])).toEqual({
      total: 112_375,
      preenchidos: 3,
      vazios: 1,
    });
  });
});

describe("custo pré-preenchido", () => {
  const hist = [
    { itemId: "salmao", custo: 8_500, data: "2026-10-31" },
    { itemId: "salmao", custo: 8_990, data: "2026-11-30" },
    { itemId: "arroz", custo: 2_500, data: "2026-11-30" },
  ];
  it("usa o último custo do item; sem histórico, o de referência", () => {
    expect(custoSugerido("salmao", hist, 7_000)).toBe(8_990);
    expect(custoSugerido("nori", hist, 3_200)).toBe(3_200);
    expect(custoSugerido("nori", hist, null)).toBeNull();
  });
});
