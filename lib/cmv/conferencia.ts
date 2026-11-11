// Conferência das notas pelo admin (funções puras, sem banco).
// Destaques de cada nota, filtros e progresso.

import type { DataCivil } from "./datas";
import { type Centavos, formatarBRL } from "./dinheiro";
import { type NotaComparavel, notasParecidas } from "./duplicidade";
import type { Conferencia, FormaPagamento, TipoNota } from "./tipos";

export type FiltroConferencia = "pendentes" | "conferidas" | "divergentes" | "todas";

export const FILTROS_CONFERENCIA: { valor: FiltroConferencia; rotulo: string }[] = [
  { valor: "pendentes", rotulo: "Pendentes" },
  { valor: "conferidas", rotulo: "Conferidas" },
  { valor: "divergentes", rotulo: "Divergentes" },
  { valor: "todas", rotulo: "Todas" },
];

export const filtroValido = (v: string | undefined): FiltroConferencia =>
  FILTROS_CONFERENCIA.some((f) => f.valor === v) ? (v as FiltroConferencia) : "pendentes";

/** Conferência que entra no filtro. */
export function passaNoFiltro(conferencia: Conferencia, filtro: FiltroConferencia): boolean {
  if (filtro === "todas") return true;
  if (filtro === "pendentes") return conferencia === "pendente";
  if (filtro === "conferidas") return conferencia === "conferida";
  return conferencia === "divergente";
}

export type ProgressoConferencia = { total: number; conferidas: number; divergentes: number; pendentes: number };

/** Progresso sobre as notas ATIVAS do mês. Divergente conta como revisada, mas não como conferida. */
export function progressoConferencia(notas: { status: string; conferencia: Conferencia }[]): ProgressoConferencia {
  const ativas = notas.filter((n) => n.status === "ativa");
  return {
    total: ativas.length,
    conferidas: ativas.filter((n) => n.conferencia === "conferida").length,
    divergentes: ativas.filter((n) => n.conferencia === "divergente").length,
    pendentes: ativas.filter((n) => n.conferencia === "pendente").length,
  };
}

/** Vizinhas na lista filtrada (para ← → e para avançar depois de marcar). */
export function vizinhas(ids: string[], atual: string | null): { indice: number; anterior: string | null; proxima: string | null } {
  const i = atual ? ids.indexOf(atual) : -1;
  if (i < 0) return { indice: -1, anterior: null, proxima: ids[0] ?? null };
  return { indice: i, anterior: ids[i - 1] ?? null, proxima: ids[i + 1] ?? null };
}

/**
 * Próxima nota a mostrar depois de marcar a atual. Se a atual sai do filtro (ex.: em
 * "pendentes", acabou de ser conferida), a próxima é a seguinte; se for a última, a anterior.
 */
export function proximaDepoisDeMarcar(ids: string[], atual: string): string | null {
  const { indice, anterior, proxima } = vizinhas(ids, atual);
  if (indice < 0) return ids[0] ?? null;
  return proxima ?? anterior;
}

export type NivelDestaque = "erro" | "aviso" | "info" | "ok";
export type Destaque = { id: string; nivel: NivelDestaque; titulo: string; detalhe?: string; notaId?: string };

export type NotaParaConferir = {
  id: string;
  fornecedorId: string;
  categoriaId: string;
  data: DataCivil;
  valor: Centavos;
  tipo: TipoNota;
  status: "ativa" | "cancelada";
  formaPagamento: FormaPagamento;
  categoriaForaDoPadrao: boolean;
  fornecedorNovo: boolean;
  observacao?: string | null;
  pendenciaJustificativa?: string | null;
};

export type ContextoCaixa = {
  /** id da categoria "Mercado" (o caixa só registra despesa de Mercado) */
  categoriaMercadoId: string | null;
  /** despesa "Mercado" do caixa por dia (soma dos turnos); dia ausente = caixa sem dados */
  despesaMercadoPorDia: Map<DataCivil, Centavos>;
  /** soma das notas ATIVAS de Mercado por dia */
  notasMercadoPorDia: Map<DataCivil, Centavos>;
};

/** Diferença tolerada entre a despesa do caixa e as notas do dia: R$ 1,00 ou 5%, o que for maior. */
export const TOLERANCIA_CAIXA = { minimo: 100, fracao: 0.05 } as const;

const dataBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** Compara a nota de Mercado com a despesa "Mercado" do caixa no mesmo dia. */
export function destaqueDeCaixa(nota: NotaParaConferir, caixa: ContextoCaixa): Destaque | null {
  if (!caixa.categoriaMercadoId || nota.categoriaId !== caixa.categoriaMercadoId || nota.status !== "ativa") return null;
  const despesa = caixa.despesaMercadoPorDia.get(nota.data);
  if (despesa === undefined) return null; // caixa do dia ainda não sincronizado
  const notasDia = caixa.notasMercadoPorDia.get(nota.data) ?? 0;
  if (despesa === 0) {
    if (nota.formaPagamento !== "caixa") return null;
    return {
      id: "caixa",
      nivel: "aviso",
      titulo: "Pago no caixa, mas o caixa não registra despesa de Mercado",
      detalhe: `Em ${dataBR(nota.data)} a despesa "Mercado" do caixa está zerada. Confira a data da nota e o caixa do dia.`,
    };
  }
  const diferenca = notasDia - despesa;
  const tolerancia = Math.max(TOLERANCIA_CAIXA.minimo, Math.round(despesa * TOLERANCIA_CAIXA.fracao));
  if (Math.abs(diferenca) <= tolerancia) {
    return { id: "caixa", nivel: "ok", titulo: `Confere com o caixa: despesa de Mercado ${formatarBRL(despesa)} em ${dataBR(nota.data)}` };
  }
  return {
    id: "caixa",
    nivel: "aviso",
    titulo: `Caixa de ${dataBR(nota.data)}: Mercado ${formatarBRL(despesa)} × notas de Mercado no dia ${formatarBRL(notasDia)}`,
    detalhe:
      diferenca < 0
        ? `Faltam ${formatarBRL(-diferenca)} em notas: possível cupom não lançado.`
        : `As notas passam a despesa do caixa em ${formatarBRL(diferenca)}: parte pode ter sido paga fora do caixa ou lançada na data errada.`,
  };
}

/** Destaques no topo da nota, do mais grave para o menos grave. */
export function destaquesDaNota(
  nota: NotaParaConferir,
  ctx: { outras: NotaComparavel[]; caixa: ContextoCaixa; nomeFornecedor?: string },
): Destaque[] {
  const d: Destaque[] = [];
  if (nota.status === "cancelada") {
    d.push({ id: "cancelada", nivel: "info", titulo: "Nota cancelada (não entra no CMV)" });
  }
  if (nota.status === "ativa") {
    const [parecida] = notasParecidas({ id: nota.id, fornecedorId: nota.fornecedorId, data: nota.data, valor: nota.valor }, ctx.outras);
    if (parecida) {
      d.push({
        id: "duplicidade",
        nivel: "erro",
        titulo: `Possível duplicidade: ${ctx.nomeFornecedor ?? "mesmo fornecedor"} ${formatarBRL(parecida.valor)} em ${dataBR(parecida.data)}`,
        detalhe: parecida.tipo === "sem_nota" ? "A outra é uma compra aguardando nota fiscal: talvez esta seja a nota dela." : "Mesmo fornecedor, valor até 5% diferente e data a até 15 dias.",
        notaId: parecida.id,
      });
    }
  }
  if (nota.tipo === "sem_nota" && nota.status === "ativa") {
    d.push({
      id: "sem-nota",
      nivel: "aviso",
      titulo: nota.pendenciaJustificativa ? "Sem nota (aguardando) · justificada para o fechamento" : "Sem nota (aguardando a nota fiscal)",
      detalhe: nota.pendenciaJustificativa ?? nota.observacao ?? undefined,
    });
  }
  if (nota.fornecedorNovo) {
    d.push({ id: "fornecedor-novo", nivel: "aviso", titulo: "Fornecedor novo", detalhe: "Cadastrado pelo gestor no lançamento: revise nome, categoria, prazo e CNPJ em Fornecedores." });
  }
  if (nota.categoriaForaDoPadrao) {
    d.push({ id: "categoria-trocada", nivel: "aviso", titulo: "Categoria trocada", detalhe: "A categoria desta nota é diferente da categoria padrão do fornecedor." });
  }
  const caixa = destaqueDeCaixa(nota, ctx.caixa);
  if (caixa) d.push(caixa);
  const ordem: Record<NivelDestaque, number> = { erro: 0, aviso: 1, info: 2, ok: 3 };
  return d.sort((a, b) => ordem[a.nivel] - ordem[b.nivel]);
}
