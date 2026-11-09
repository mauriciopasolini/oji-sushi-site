// Dinheiro em CENTAVOS INTEIROS. No banco é numeric(12,2), que chega como string
// ("1234.56") pelo PostgREST; converta com `centavos()` sem passar por float.

export type Centavos = number;

/** "1234.56" | "1234.5" | 1234.56 | "R$ 1.234,56" → 123456 */
export function centavos(valor: string | number | null | undefined): Centavos {
  if (valor === null || valor === undefined || valor === "") return 0;
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) throw new Error(`Valor inválido: ${valor}`);
    return Math.round(valor * 100);
  }
  let s = valor.trim().replace(/\s|R\$/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", "."); // formato pt-BR
  const m = /^(-)?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) throw new Error(`Valor inválido: ${valor}`);
  const inteiro = Number(m[2] || "0");
  const frac = (m[3] ?? "").padEnd(3, "0");
  let c = inteiro * 100 + Number(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) c += 1; // arredonda a 3ª casa, se houver
  return m[1] ? -c : c;
}

/** 123456 → "1234.56" (para gravar em numeric) */
export function paraDecimal(c: Centavos): string {
  const neg = c < 0;
  const a = Math.abs(Math.round(c));
  return `${neg ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

const fmtBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** 123456 → "R$ 1.234,56" */
export function formatarBRL(c: Centavos): string {
  return fmtBRL.format(Math.round(c) / 100);
}

/** 0.3517 → "35,2%" */
export function formatarPct(fracao: number, casas = 1): string {
  return `${(fracao * 100).toFixed(casas).replace(".", ",")}%`;
}
