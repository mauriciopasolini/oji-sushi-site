// Aviso de possível nota duplicada (função pura, sem acesso ao banco).
// Regra: outra nota ATIVA do MESMO fornecedor, com valor até TOLERANCIA diferente,
// com data até JANELA_DIAS antes ou depois da data da nota que está sendo salva.

import { type DataCivil, somarDias } from "./datas";
import type { Centavos } from "./dinheiro";
import type { TipoNota } from "./tipos";

export const DUPLICIDADE = {
  /** diferença máxima de valor, como fração do valor da nota já existente (0,05 = 5%) */
  tolerancia: 0.05,
  /** distância máxima, em dias, entre as datas das duas notas */
  janelaDias: 15,
} as const;

export type NotaComparavel = {
  id: string;
  fornecedorId: string;
  data: DataCivil;
  valor: Centavos;
  tipo: TipoNota;
  status: "ativa" | "cancelada";
};

/** Intervalo de datas a buscar no banco para a nota dada. */
export function janelaDeBusca(data: DataCivil, janelaDias: number = DUPLICIDADE.janelaDias) {
  return { de: somarDias(data, -janelaDias), ate: somarDias(data, janelaDias) };
}

const distanciaDias = (a: DataCivil, b: DataCivil) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/**
 * Notas parecidas com `nova`, da mais relevante para a menos relevante:
 * primeiro as "sem nota (aguardando)" (o certo é editar a pendente), depois a de
 * valor mais próximo e, por fim, a de data mais próxima.
 */
export function notasParecidas(
  nova: Pick<NotaComparavel, "fornecedorId" | "data" | "valor"> & { id?: string },
  existentes: NotaComparavel[],
  opcoes: { tolerancia?: number; janelaDias?: number } = {},
): NotaComparavel[] {
  const tolerancia = opcoes.tolerancia ?? DUPLICIDADE.tolerancia;
  const janelaDias = opcoes.janelaDias ?? DUPLICIDADE.janelaDias;
  return existentes
    .filter(
      (e) =>
        e.id !== nova.id &&
        e.status === "ativa" &&
        e.fornecedorId === nova.fornecedorId &&
        distanciaDias(e.data, nova.data) <= janelaDias &&
        // comparação em centavos inteiros: |novo − existente| ≤ tolerância × existente
        Math.abs(nova.valor - e.valor) <= Math.round(tolerancia * e.valor),
    )
    .sort(
      (a, b) =>
        Number(b.tipo === "sem_nota") - Number(a.tipo === "sem_nota") ||
        Math.abs(nova.valor - a.valor) - Math.abs(nova.valor - b.valor) ||
        distanciaDias(a.data, nova.data) - distanciaDias(b.data, nova.data),
    );
}
