// Contagem de estoque (funções puras, sem banco).
// Quantidade em MILÉSIMOS inteiros (numeric(12,3) no banco); custo em centavos.
// valor = round(quantidade × custo, 2), igual à coluna gerada contagem_itens.valor.

import { competenciaDe, type DataCivil, INICIO_SISTEMA, partes, somarMeses } from "./datas";
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
 * Estoque do mês para o cálculo do CMV: total da contagem de fechamento FINALIZADA da
 * competência. Rascunho não conta (devolve null, como se não houvesse contagem).
 */
export function estoqueDoMes(
  contagens: { competencia: string; status: "rascunho" | "finalizada"; valores: (string | number)[] }[],
  competencia: string,
  paraCentavos: (v: string | number) => Centavos,
): Centavos | null {
  const c = contagens.find((x) => x.competencia === competencia && x.status === "finalizada");
  return c ? c.valores.reduce<number>((a, v) => a + paraCentavos(v), 0) : null;
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

// -----------------------------------------------------------------------------
// "Fechamento de": mês de fechamento a que a contagem pertence (decisão 109).
// As mesmas regras estão no banco (interno.fechamento_padrao e
// interno.validar_fechamento_contagem); aqui servem à tela e à server action.
// -----------------------------------------------------------------------------

/** Dias do mês em que a contagem, por padrão, ainda fecha o mês anterior. */
export const DIAS_FECHAMENTO_MES_ANTERIOR = 2;

/**
 * Mês de fechamento padrão para uma contagem feita na data civil `data` (São Paulo):
 * o mês da data; nos dias 1 e 2, o mês anterior (contagem que passou da meia-noite
 * ou foi finalizada na manhã seguinte). Ex.: 30/11 → nov · 01/12 → nov · 15/12 → dez.
 */
export function fechamentoPadrao(data: DataCivil): DataCivil {
  const comp = competenciaDe(data);
  return partes(data).dia <= DIAS_FECHAMENTO_MES_ANTERIOR ? somarMeses(comp, -1) : comp;
}

/** Meses que podem receber uma contagem feita em `data`: o anterior e o da data (a partir do início do sistema). */
export function opcoesFechamento(data: DataCivil): DataCivil[] {
  const comp = competenciaDe(data);
  return [somarMeses(comp, -1), comp].filter((m) => m >= INICIO_SISTEMA);
}

/** Erro (em português) se o par fechamento/data não for permitido para o papel; null se estiver ok. */
export function erroFechamento(fechamento: DataCivil, data: DataCivil, ehAdmin: boolean): string | null {
  const nome = (c: DataCivil) => `${String(partes(c).mes).padStart(2, "0")}/${partes(c).ano}`;
  if (fechamento < INICIO_SISTEMA) return `O sistema começa em ${nome(INICIO_SISTEMA)}: não há fechamento antes disso.`;
  if (!opcoesFechamento(data).includes(fechamento)) {
    const [d, m, a] = [data.slice(8, 10), data.slice(5, 7), data.slice(0, 4)];
    return `Uma contagem feita em ${d}/${m}/${a} só pode ser o fechamento de ${opcoesFechamento(data).map(nome).join(" ou ")}.`;
  }
  if (!ehAdmin && fechamento !== fechamentoPadrao(data)) {
    return `Pela data, esta contagem é o fechamento de ${nome(fechamentoPadrao(data))}. Só o administrador pode escolher outro mês.`;
  }
  return null;
}

/** O aviso "contagem do mês anterior não finalizada" só faz sentido se o mês anterior estiver no sistema. */
export function mesAnteriorNoSistema(competencia: DataCivil): boolean {
  return somarMeses(competencia, -1) >= INICIO_SISTEMA;
}
