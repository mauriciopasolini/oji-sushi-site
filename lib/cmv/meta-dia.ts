// Comparação visual do total do dia com a meta do dia (tela Vendas). Só apresentação:
// não altera nenhuma regra de cálculo.
import { type Centavos, formatarBRL, formatarPct } from "./dinheiro";

export type ComparacaoMeta = {
  sentido: "acima" | "abaixo";
  /** total − meta, em centavos */
  diferenca: Centavos;
  /** ex.: "+R$ 517,68 (+16,0%) vs. meta" */
  texto: string;
};

/**
 * Retorna null (cor neutra) para dia sem venda registrada, dia "sem movimento"
 * (registrado com total zero) ou dia sem meta. Na meta ou acima → "acima".
 */
export function compararComMeta(total: Centavos, meta: Centavos, registrado: boolean): ComparacaoMeta | null {
  if (!registrado || total === 0 || meta <= 0) return null;
  const diferenca = total - meta;
  const sinal = diferenca < 0 ? "−" : "+";
  const pct = formatarPct(Math.abs(diferenca) / meta, 1);
  return {
    sentido: diferenca >= 0 ? "acima" : "abaixo",
    diferenca,
    texto: `${sinal}${formatarBRL(Math.abs(diferenca))} (${sinal}${pct}) vs. meta`,
  };
}
