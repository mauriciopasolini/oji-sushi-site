import { describe, expect, it } from "vitest";
import {
  type ContextoCaixa,
  type NotaParaConferir,
  destaqueDeCaixa,
  destaquesDaNota,
  filtroValido,
  passaNoFiltro,
  progressoConferencia,
  proximaDepoisDeMarcar,
  vizinhas,
} from "./conferencia";
import type { NotaComparavel } from "./duplicidade";

const MERCADO = "cat-mercado";
const nota = (extra: Partial<NotaParaConferir> = {}): NotaParaConferir => ({
  id: "n1", fornecedorId: "f1", categoriaId: "cat-pescados", data: "2026-11-10", valor: 100_000, tipo: "nfe", status: "ativa",
  formaPagamento: "boleto", categoriaForaDoPadrao: false, fornecedorNovo: false, ...extra,
});
const semCaixa: ContextoCaixa = { categoriaMercadoId: MERCADO, despesaMercadoPorDia: new Map(), notasMercadoPorDia: new Map() };
const caixa = (despesa: number | undefined, notasDia: number): ContextoCaixa => ({
  categoriaMercadoId: MERCADO,
  despesaMercadoPorDia: new Map(despesa === undefined ? [] : [["2026-11-10", despesa]]),
  notasMercadoPorDia: new Map([["2026-11-10", notasDia]]),
});

describe("filtros e progresso", () => {
  it("filtro padrão é 'pendentes'", () => {
    expect(filtroValido(undefined)).toBe("pendentes");
    expect(filtroValido("xyz")).toBe("pendentes");
    expect(filtroValido("divergentes")).toBe("divergentes");
  });

  it("cada filtro deixa passar só a sua conferência", () => {
    expect(passaNoFiltro("pendente", "pendentes")).toBe(true);
    expect(passaNoFiltro("conferida", "pendentes")).toBe(false);
    expect(passaNoFiltro("conferida", "conferidas")).toBe(true);
    expect(passaNoFiltro("divergente", "divergentes")).toBe(true);
    expect(passaNoFiltro("divergente", "todas")).toBe(true);
  });

  it("progresso conta só notas ativas: '23 de 36 conferidas'", () => {
    const ns = [
      ...Array.from({ length: 23 }, () => ({ status: "ativa", conferencia: "conferida" as const })),
      ...Array.from({ length: 2 }, () => ({ status: "ativa", conferencia: "divergente" as const })),
      ...Array.from({ length: 11 }, () => ({ status: "ativa", conferencia: "pendente" as const })),
      { status: "cancelada", conferencia: "pendente" as const },
    ];
    expect(progressoConferencia(ns)).toEqual({ total: 36, conferidas: 23, divergentes: 2, pendentes: 11 });
  });
});

describe("navegação", () => {
  const ids = ["a", "b", "c"];
  it("vizinhas: anterior e próxima; sem atual, abre a primeira", () => {
    expect(vizinhas(ids, "b")).toEqual({ indice: 1, anterior: "a", proxima: "c" });
    expect(vizinhas(ids, null)).toEqual({ indice: -1, anterior: null, proxima: "a" });
    expect(vizinhas(ids, "a").anterior).toBeNull();
  });
  it("depois de marcar: vai para a seguinte; na última, volta para a anterior; lista de 1 → nenhuma", () => {
    expect(proximaDepoisDeMarcar(ids, "a")).toBe("b");
    expect(proximaDepoisDeMarcar(ids, "c")).toBe("b");
    expect(proximaDepoisDeMarcar(["a"], "a")).toBeNull();
  });
});

describe("destaques da nota", () => {
  it("nota comum, sem nada a destacar", () => {
    expect(destaquesDaNota(nota(), { outras: [], caixa: semCaixa })).toEqual([]);
  });

  it("fornecedor novo, categoria trocada e sem nota", () => {
    const d = destaquesDaNota(nota({ fornecedorNovo: true, categoriaForaDoPadrao: true, tipo: "sem_nota", observacao: "romaneio" }), { outras: [], caixa: semCaixa });
    expect(d.map((x) => x.id).sort()).toEqual(["categoria-trocada", "fornecedor-novo", "sem-nota"]);
    expect(d.find((x) => x.id === "sem-nota")?.detalhe).toBe("romaneio");
  });

  it("possível duplicidade (mesmo fornecedor, até 5%, até 15 dias) vem primeiro e aponta a outra nota", () => {
    const outras: NotaComparavel[] = [
      { id: "n1", fornecedorId: "f1", data: "2026-11-10", valor: 100_000, tipo: "nfe", status: "ativa" }, // a própria
      { id: "n2", fornecedorId: "f1", data: "2026-11-22", valor: 104_000, tipo: "nfe", status: "ativa" },
    ];
    const d = destaquesDaNota(nota({ fornecedorNovo: true }), { outras, caixa: semCaixa, nomeFornecedor: "Frumar" });
    expect(d[0].id).toBe("duplicidade");
    expect(d[0].notaId).toBe("n2");
    expect(d[0].titulo).toContain("Frumar");
  });

  it("nota cancelada não acusa duplicidade", () => {
    const outras: NotaComparavel[] = [{ id: "n2", fornecedorId: "f1", data: "2026-11-10", valor: 100_000, tipo: "nfe", status: "ativa" }];
    const d = destaquesDaNota(nota({ status: "cancelada" }), { outras, caixa: semCaixa });
    expect(d.map((x) => x.id)).toEqual(["cancelada"]);
  });
});

describe("alerta de caixa relacionado (Mercado)", () => {
  const mercado = (extra: Partial<NotaParaConferir> = {}) => nota({ categoriaId: MERCADO, valor: 15_000, ...extra });

  it("só vale para notas de Mercado e com o caixa do dia sincronizado", () => {
    expect(destaqueDeCaixa(nota(), caixa(20_000, 0))).toBeNull();
    expect(destaqueDeCaixa(mercado(), caixa(undefined, 15_000))).toBeNull();
  });

  it("confere (dentro de R$ 1,00 ou 5%)", () => {
    expect(destaqueDeCaixa(mercado(), caixa(15_000, 15_000))?.nivel).toBe("ok");
    expect(destaqueDeCaixa(mercado(), caixa(15_050, 15_000))?.nivel).toBe("ok");
    expect(destaqueDeCaixa(mercado(), caixa(100_000, 95_000))?.nivel).toBe("ok"); // 5% exato
  });

  it("caixa maior que as notas do dia → possível cupom não lançado", () => {
    const d = destaqueDeCaixa(mercado(), caixa(25_000, 15_000));
    expect(d?.nivel).toBe("aviso");
    expect(d?.detalhe).toContain("possível cupom não lançado");
    expect(d?.detalhe).toMatch(/R\$\s100,00/);
  });

  it("notas maiores que o caixa → aviso de pagamento fora do caixa ou data errada", () => {
    expect(destaqueDeCaixa(mercado(), caixa(5_000, 15_000))?.detalhe).toContain("fora do caixa");
  });

  it("pago no caixa, mas despesa de Mercado zerada no dia", () => {
    expect(destaqueDeCaixa(mercado({ formaPagamento: "caixa" }), caixa(0, 15_000))?.titulo).toContain("não registra");
    expect(destaqueDeCaixa(mercado({ formaPagamento: "boleto" }), caixa(0, 15_000))).toBeNull();
  });
});
