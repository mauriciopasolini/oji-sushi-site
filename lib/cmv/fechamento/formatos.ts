// Textos e formatos do fechamento (tela, PDF e Excel).

import type { DataCivil } from "../datas";

export const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "2026-11-01" → "novembro/2026" */
export const nomeMes = (comp: DataCivil) => `${MESES[Number(comp.slice(5, 7)) - 1]}/${comp.slice(0, 4)}`;
/** "2026-11-01" → "Novembro / 2026" */
export const tituloMes = (comp: DataCivil) => {
  const m = MESES[Number(comp.slice(5, 7)) - 1];
  return `${m[0].toUpperCase()}${m.slice(1)} / ${comp.slice(0, 4)}`;
};
/** "2026-11-01" → "Novembro/2026" */
export const mesCurto = (comp: DataCivil) => {
  const m = MESES[Number(comp.slice(5, 7)) - 1];
  return `${m[0].toUpperCase()}${m.slice(1)}/${comp.slice(0, 4)}`;
};
/** "2026-11-08" → "08/11" */
export const dataBR = (d: DataCivil) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
/** "2026-11-08" → "08/11/2026" */
export const dataBRCompleta = (d: DataCivil) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** 123456 → "1.234,56" (sem "R$", para tabelas) */
export function valorBR(c: number): string {
  return (Math.round(c) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/** 123456 → "R$ 1.234,56" */
export const brl = (c: number) => `${c < 0 ? "-" : ""}R$ ${valorBR(Math.abs(c))}`;
/** 0.3517 → "35,2%"; null → "—" */
export const pct = (f: number | null | undefined, casas = 1) => (f === null || f === undefined || !Number.isFinite(f) ? "—" : `${(f * 100).toFixed(casas).replace(".", ",")}%`);
/** −0.053 → "-5,3 p.p." */
export const pp = (f: number | null | undefined) =>
  f === null || f === undefined || !Number.isFinite(f) ? "—" : `${f > 0 ? "+" : f < 0 ? "-" : ""}${Math.abs(f * 100).toFixed(1).replace(".", ",")} p.p.`;
/** 0.018 → "+1,8%" */
export const variacaoPct = (f: number | null | undefined) =>
  f === null || f === undefined || !Number.isFinite(f) ? "—" : `${f > 0 ? "+" : f < 0 ? "-" : ""}${Math.abs(f * 100).toFixed(1).replace(".", ",")}%`;

export const ROTULO_TIPO: Record<string, string> = { nfe: "NF-e", cupom: "Cupom", comanda: "Comanda", outro: "Outro", sem_nota: "Sem nota" };
export const ROTULO_FORMA: Record<string, string> = { boleto: "Boleto", caixa: "Caixa", pix: "Pix", outro: "Outro" };
export const ROTULO_CONF: Record<string, string> = { pendente: "Pendente", conferida: "Conferida", divergente: "Divergente" };
