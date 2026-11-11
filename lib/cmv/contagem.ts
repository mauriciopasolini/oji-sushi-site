// Contagem de estoque (funções puras, sem banco).
// Quantidade em MILÉSIMOS inteiros (numeric(12,3) no banco); custo em centavos.
// valor = round(quantidade × custo, 2), igual à coluna gerada contagem_itens.valor.

import type { Centavos } from "./dinheiro";

export type Milesimos = number;

export const UNIDADES = [
  { valor: "kg", rotulo: "kg" },
  { valor: "un", rotulo: "un" },
  { valor: "cx", rotulo: "cx" },
  { valor: "pct", rotulo: "pct" },
  { valor: "l", rotulo: "l" },
] as const;
export type Unidade = (typeof UNIDADES)[number]["valor"];

/** Teto de quantidade: numeric(12,3) aceita até 999.999.999,999; aqui, um limite de sanidade. */
export const QUANTIDADE_MAXIMA: Milesimos = 1_000_000 * 1000;

/**
 * "12,5" → 12500 · "0,250" → 250 · "3" → 3000 · "1.5" → 1500 (ponto decimal do teclado) ·
 * "1.234,5" → 1234500 · "" → null. Mais de 3 casas, negativo ou texto → erro.
 */
export function lerQuantidade(texto: string | null | undefined): Milesimos | null {
  let s = (texto ?? "").trim().replace(/\s/g, "");
  if (s === "") return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const m = /^(\d*)(?:\.(\d{0,3}))?$/.exec(s);
  if (!m || (m[1] === "" && (m[2] ?? "") === "")) throw new Error(`Quantidade inválida: ${texto}`);
  const q = Number(m[1] || "0") * 1000 + Number((m[2] ?? "").padEnd(3, "0"));
  if (q > QUANTIDADE_MAXIMA) throw new Error(`Quantidade muito alta: ${texto}`);
  return q;
}

/** Igual a lerQuantidade, mas devolve undefined em vez de erro (para a digitação ao vivo). */
export function tentarLerQuantidade(texto: string | null | undefined): Milesimos | null | undefined {
  try {
    return lerQuantidade(texto);
  } catch {
    return undefined;
  }
}

/** 12500 → "12,5" · 250 → "0,25" · 3000 → "3" (sem separador de milhar: é para campo de digitação). */
export function formatarQuantidade(q: Milesimos): string {
  const inteiro = Math.floor(q / 1000);
  const frac = String(q % 1000).padStart(3, "0").replace(/0+$/, "");
  return frac ? `${inteiro},${frac}` : String(inteiro);
}

/** 12500 → "12.5" (para gravar em numeric) */
export function quantidadeParaDecimal(q: Milesimos): string {
  return `${Math.floor(q / 1000)}.${String(q % 1000).padStart(3, "0")}`;
}

/** numeric do banco (número JSON ou texto) → milésimos */
export function milesimos(v: string | number | null | undefined): Milesimos {
  if (v === null || v === undefined || v === "") return 0;
  const q = lerQuantidade(typeof v === "number" ? String(v) : v);
  return q ?? 0;
}

/** round(quantidade × custo, 2) em centavos inteiros (meio centavo para cima, como o round do Postgres). */
export function valorDoItem(quantidade: Milesimos, custo: Centavos): Centavos {
  // q (milésimos) × c (centavos) / 1000 = centavos, com arredondamento exato em inteiros
  const produto = quantidade * custo;
  return Math.floor((produto + 500) / 1000);
}

export type LinhaContagem = { quantidade: Milesimos | null; custo: Centavos | null };

/** Total da contagem e quantos itens ainda estão sem quantidade. */
export function totalDaContagem(linhas: LinhaContagem[]): { total: Centavos; preenchidos: number; vazios: number } {
  let total = 0;
  let preenchidos = 0;
  for (const l of linhas) {
    if (l.quantidade === null) continue;
    preenchidos++;
    total += valorDoItem(l.quantidade, l.custo ?? 0);
  }
  return { total, preenchidos, vazios: linhas.length - preenchidos };
}

/**
 * Custo pré-preenchido: o último custo usado para o item numa contagem (da mais recente
 * para a mais antiga); sem histórico, o custo de referência do cadastro.
 */
export function custoSugerido(
  itemId: string,
  historico: { itemId: string; custo: Centavos; data: string }[],
  custoReferencia: Centavos | null,
): Centavos | null {
  let melhor: { custo: Centavos; data: string } | null = null;
  for (const h of historico) {
    if (h.itemId !== itemId) continue;
    if (!melhor || h.data > melhor.data) melhor = h;
  }
  return melhor ? melhor.custo : custoReferencia;
}
