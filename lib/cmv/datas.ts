// Datas do módulo CMV.
//
// Regra: TODO dia é uma "data civil" de São Paulo no formato "AAAA-MM-DD".
// A conversão de instante (Date / timestamptz) para data civil acontece só aqui,
// sempre no fuso America/Sao_Paulo. A aritmética de calendário usa UTC puro,
// que não depende do fuso da máquina (a Vercel roda em UTC).

import { tz } from "@date-fns/tz";
import { format } from "date-fns";

export const FUSO = "America/Sao_Paulo";
const naSP = tz(FUSO);

/** "AAAA-MM-DD" */
export type DataCivil = string;

const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

export function partes(d: DataCivil): { ano: number; mes: number; dia: number } {
  const m = RE_DATA.exec(d);
  if (!m) throw new Error(`Data civil inválida: ${d}`);
  return { ano: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]) };
}

export function montar(ano: number, mes: number, dia: number): DataCivil {
  return `${String(ano).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Data civil de São Paulo para um instante. Ex.: 2026-12-01T02:30Z → "2026-11-30". */
export function dataCivilSP(instante: Date | string | number): DataCivil {
  return format(new Date(instante), "yyyy-MM-dd", { in: naSP });
}

/** "Hoje" em São Paulo (o servidor da Vercel está em UTC). */
export function hojeSP(agora: Date = new Date()): DataCivil {
  return dataCivilSP(agora);
}

export function diasNoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/** 0 = domingo … 6 = sábado (independente de fuso). */
export function diaSemana(d: DataCivil): number {
  const { ano, mes, dia } = partes(d);
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
}

export function somarDias(d: DataCivil, n: number): DataCivil {
  const { ano, mes, dia } = partes(d);
  const t = new Date(Date.UTC(ano, mes - 1, dia + n));
  return montar(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Primeiro dia do mês da data. */
export function competenciaDe(d: DataCivil): DataCivil {
  const { ano, mes } = partes(d);
  return montar(ano, mes, 1);
}

export function mesmoMes(a: DataCivil, b: DataCivil): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/** Todas as datas do mês da competência. */
export function diasDoMes(competencia: DataCivil): DataCivil[] {
  const { ano, mes } = partes(competencia);
  return Array.from({ length: diasNoMes(ano, mes) }, (_, i) => montar(ano, mes, i + 1));
}

// -----------------------------------------------------------------------------
// Semanas do mês: blocos fixos por dia do mês.
// S1 = 1–7, S2 = 8–14, S3 = 15–21, S4 = 22 até o último dia (22–28 … 22–31).
// -----------------------------------------------------------------------------
export type NumeroSemana = 1 | 2 | 3 | 4;

export type Semana = {
  numero: NumeroSemana;
  inicio: DataCivil;
  fim: DataCivil;
  dias: number;
};

export function semanaDoDia(dia: number): NumeroSemana {
  if (dia <= 7) return 1;
  if (dia <= 14) return 2;
  if (dia <= 21) return 3;
  return 4;
}

export function semanaDaData(d: DataCivil): NumeroSemana {
  return semanaDoDia(partes(d).dia);
}

export function semanasDoMes(competencia: DataCivil): Semana[] {
  const { ano, mes } = partes(competencia);
  const ultimo = diasNoMes(ano, mes);
  const limites: [number, number][] = [
    [1, 7],
    [8, 14],
    [15, 21],
    [22, ultimo],
  ];
  return limites.map(([ini, fim], i) => ({
    numero: (i + 1) as NumeroSemana,
    inicio: montar(ano, mes, ini),
    fim: montar(ano, mes, fim),
    dias: fim - ini + 1,
  }));
}

/** "08 a 14/11" */
export function rotuloSemana(s: Semana): string {
  const a = partes(s.inicio);
  const b = partes(s.fim);
  return `${String(a.dia).padStart(2, "0")} a ${String(b.dia).padStart(2, "0")}/${String(b.mes).padStart(2, "0")}`;
}
