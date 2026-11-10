// Dia em andamento (hoje): leitura parcial da planilha, só para exibição.
// FUNÇÕES PURAS. O dia de hoje só entra no cálculo (projeção, ritmo, cores) quando
// os dois turnos estão preenchidos; antes disso aparece como "parcial".
// Depois da meia-noite ele vira "ontem" e a sincronização o grava como qualquer dia.

import { type DataCivil, dataCivilSP } from "./datas";
import { type Centavos, formatarBRL } from "./dinheiro";
import type { AbaLida, TurnoLido } from "./planilha/parser";

/** total = null → turno ainda não preenchido ("aguardando") */
export type TurnoParcial = { turno: 1 | 2; total: Centavos | null };

export type DiaAtual = {
  data: DataCivil;
  /** os dois turnos preenchidos: o dia já conta no cálculo */
  completo: boolean;
  turnos: [TurnoParcial, TurnoParcial];
};

/** Turno preenchido = alguma venda lançada (soma das partes das origens > 0). */
export function turnoPreenchido(t: Pick<TurnoLido, "somaOrigens"> | undefined): boolean {
  return !!t && t.somaOrigens > 0;
}

/** Dia completo pelos totais de cada turno (vale para planilha e para lançamento manual). */
export function diaCompleto(totalTurno1: Centavos, totalTurno2: Centavos): boolean {
  return totalTurno1 > 0 && totalTurno2 > 0;
}

/** Situação do dia de hoje a partir da aba lida (aba ausente → os dois turnos aguardando). */
export function avaliarDiaAtual(data: DataCivil, aba: AbaLida | null): DiaAtual {
  const turno = (n: 1 | 2): TurnoParcial => {
    const t = aba?.turnos.find((x) => x.turno === n);
    return { turno: n, total: turnoPreenchido(t) ? t!.somaOrigens : null };
  };
  const turnos: [TurnoParcial, TurnoParcial] = [turno(1), turno(2)];
  return { data, completo: turnos.every((t) => t.total !== null), turnos };
}

/**
 * Junta o que está no banco (ex.: lançamento manual de hoje) com a leitura da planilha,
 * turno a turno: vale o banco quando o turno tem valor lá; senão, a planilha.
 */
export function mesclarDiaAtual(
  data: DataCivil,
  banco: { turno1: Centavos; turno2: Centavos },
  planilha: DiaAtual | null,
): DiaAtual {
  const daPlanilha = planilha?.data === data ? planilha : null;
  const turno = (n: 1 | 2, noBanco: Centavos): TurnoParcial => ({
    turno: n,
    total: noBanco > 0 ? noBanco : (daPlanilha?.turnos[n - 1].total ?? null),
  });
  const turnos: [TurnoParcial, TurnoParcial] = [turno(1, banco.turno1), turno(2, banco.turno2)];
  return { data, completo: diaCompleto(banco.turno1, banco.turno2), turnos };
}

export const totalParcial = (d: DiaAtual): Centavos => d.turnos.reduce((a, t) => a + (t.total ?? 0), 0);

/** "09/11 · Turno 1: R$ 749,65 · Turno 2: aguardando" */
export function textoDiaAtual(d: DiaAtual): string {
  const dia = `${d.data.slice(8, 10)}/${d.data.slice(5, 7)}`;
  return [dia, ...d.turnos.map((t) => `Turno ${t.turno}: ${t.total === null ? "aguardando" : formatarBRL(t.total)}`)].join(" · ");
}

/** Intervalo mínimo entre sincronizações automáticas ao abrir o painel. */
export const INTERVALO_AUTOMATICA_MIN = 30;

/**
 * Sincronização automática ao abrir o painel: se não houver nenhuma, se a última tiver
 * mais de 30 min ou se ela for de outro dia (em SP). Depois da meia-noite, o dia que
 * estava parcial vira "ontem" e precisa ser gravado para contar no cálculo.
 */
export function precisaSincronizar(ultimaInicio: string | null, agoraMs: number): boolean {
  if (!ultimaInicio) return true;
  const ultima = new Date(ultimaInicio);
  if (dataCivilSP(ultima) !== dataCivilSP(agoraMs)) return true;
  return agoraMs - ultima.getTime() >= INTERVALO_AUTOMATICA_MIN * 60_000;
}
