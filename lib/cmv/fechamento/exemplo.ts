// Dados de exemplo (fictícios) do fechamento: usados pelos testes e para gerar um
// relatório de exemplo de mês com CMV real. Nada aqui vai para o banco.

import { diasDoMes } from "../datas";
import type { ContagemEntrada, EntradaFechamento, NotaEntrada, VendaTurnoEntrada } from "./tipos";

export const CAT = {
  pescados: { id: "c-pesc", nome: "Pescados e Linha Seca", slug: "pescados-linha-seca", pctMeta: 0.2666666667, ordem: 1 },
  bebidas: { id: "c-beb", nome: "Bebidas", slug: "bebidas", pctMeta: 0.0222222222, ordem: 2 },
  mercado: { id: "c-merc", nome: "Mercado", slug: "mercado", pctMeta: 0.0333333333, ordem: 3 },
  fruteira: { id: "c-frut", nome: "Fruteira", slug: "fruteira", pctMeta: 0.0277777778, ordem: 4 },
};
const REGUA = [
  { faixa: "Ótimo", limiteSuperiorPct: 0.36, cor: "#16a34a", ordem: 1 },
  { faixa: "Bom", limiteSuperiorPct: 0.375, cor: "#65a30d", ordem: 2 },
  { faixa: "Atenção", limiteSuperiorPct: 0.39, cor: "#d97706", ordem: 3 },
  { faixa: "Crítico", limiteSuperiorPct: null, cor: "#dc2626", ordem: 4 },
];

let seq = 0;
export function nota(p: Partial<NotaEntrada> & Pick<NotaEntrada, "data" | "valor" | "categoriaId">): NotaEntrada {
  seq++;
  return {
    id: `n${seq}`,
    fornecedorId: "f1",
    fornecedorNome: "Frumar",
    fornecedorRevisado: true,
    tipo: "nfe",
    numero: String(seq),
    vencimento: null,
    formaPagamento: "boleto",
    conferencia: "conferida",
    conferenciaObs: null,
    observacao: null,
    pendenciaJustificativa: null,
    ...p,
  };
}
export function venda(data: string, total: number, extra: Partial<VendaTurnoEntrada> = {}): VendaTurnoEntrada {
  return { data, turno: 1, origem: "restaurante", dinheiro: 0, credito: total, debito: 0, pix: 0, lojaDinheiro: 0, lojaCartao: 0, online: 0, total, qtdPedidos: null, fonte: "planilha", ...extra };
}
export function contagem(data: string, itens: [string, number][]): ContagemEntrada {
  return { data, status: "finalizada", itens: itens.map(([categoriaId, valor], i) => ({ nome: `Item ${i}`, unidade: "kg", categoriaId, quantidade: 1000, custo: valor, valor })) };
}

/** Mês pronto para fechar: todas as regras atendidas. */
export function entradaBase(competencia: string, hoje: string): EntradaFechamento {
  const dias = diasDoMes(competencia);
  return {
    competencia,
    hoje,
    mes: { id: "m1", status: "aberto", metaVenda: 9_000_000, metaCmvPct: 0.35, pesosSemana: [6.5, 6.5, 5.5, 5.5], limiteAcumuloPct: 1.25, vendaBaseErp: dias.length * 300_000 + 200_000 },
    pesosDiaSemana: [1, 1, 1, 1, 1, 1, 1],
    regua: REGUA,
    categorias: Object.values(CAT),
    notas: [
      nota({ data: dias[1], valor: 1_500_000, categoriaId: CAT.pescados.id }),
      nota({ data: dias[9], valor: 1_000_000, categoriaId: CAT.pescados.id }),
      nota({ data: dias[3], valor: 200_000, categoriaId: CAT.bebidas.id, fornecedorId: "f2", fornecedorNome: "FEMSA" }),
      nota({ data: dias[4], valor: 300_000, categoriaId: CAT.mercado.id, fornecedorId: "f3", fornecedorNome: "Mercado" }),
      nota({ data: dias[5], valor: 250_000, categoriaId: CAT.fruteira.id, fornecedorId: "f4", fornecedorNome: "Fruteira" }),
    ],
    vendas: dias.map((d) => venda(d, 300_000)),
    diasComFechamentoTurno: [],
    conflitosPendentes: [],
    divergenciasCaixa: [],
    mercadoSemNota: [],
    contagemFinal: contagem(dias[dias.length - 1], [[CAT.pescados.id, 600_000], [CAT.bebidas.id, 100_000]]),
    contagemInicial: null,
    historico: [],
  };
}

