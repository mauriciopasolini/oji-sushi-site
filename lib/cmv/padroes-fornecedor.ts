// Padrões do lançamento a partir do fornecedor (função pura).
// Sem padrão cadastrado vale a regra antiga (decisão 45): NF-e; boleto com prazo, caixa sem prazo.

import type { FormaPagamento, TipoNota } from "./tipos";

export type TipoDocumento = Exclude<TipoNota, "sem_nota">;

export const TIPOS_DOCUMENTO: { valor: TipoDocumento; rotulo: string }[] = [
  { valor: "nfe", rotulo: "NF-e" },
  { valor: "cupom", rotulo: "Cupom" },
  { valor: "comanda", rotulo: "Comanda" },
  { valor: "outro", rotulo: "Outro" },
];

export function padroesDoFornecedor(f: { prazo: number | null; tipoPadrao: TipoDocumento | null; formaPadrao: FormaPagamento | null }): {
  tipo: TipoDocumento;
  forma: FormaPagamento;
} {
  return {
    tipo: f.tipoPadrao ?? "nfe",
    forma: f.formaPadrao ?? (f.prazo !== null ? "boleto" : "caixa"),
  };
}
