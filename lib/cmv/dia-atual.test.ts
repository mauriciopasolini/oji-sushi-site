import { describe, expect, it } from "vitest";
import { avaliarDiaAtual, diaCompleto, mesclarDiaAtual, precisaSincronizar, textoDiaAtual, totalParcial, turnoPreenchido } from "./dia-atual";
import type { AbaLida, TurnoLido } from "./planilha/parser";

const R = (reais: number) => Math.round(reais * 100);
const turno = (n: 1 | 2, somaOrigens: number) => ({ turno: n, somaOrigens }) as TurnoLido;
const aba = (...turnos: TurnoLido[]) => ({ turnos, vazia: turnos.every((t) => t.somaOrigens === 0), avisos: [] }) as AbaLida;

describe("dia em andamento: leitura da planilha", () => {
  it("turno 1 preenchido, turno 2 vazio → parcial", () => {
    const d = avaliarDiaAtual("2026-11-09", aba(turno(1, R(749.65)), turno(2, 0)));
    expect(d.completo).toBe(false);
    expect(d.turnos).toEqual([
      { turno: 1, total: R(749.65) },
      { turno: 2, total: null },
    ]);
    expect(textoDiaAtual(d)).toBe("09/11 · Turno 1: R$\u00a0749,65 · Turno 2: aguardando");
    expect(totalParcial(d)).toBe(R(749.65));
  });

  it("os dois turnos preenchidos → completo (passa a contar no cálculo)", () => {
    const d = avaliarDiaAtual("2026-11-09", aba(turno(1, R(749.65)), turno(2, R(1200))));
    expect(d.completo).toBe(true);
    expect(totalParcial(d)).toBe(R(1949.65));
  });

  it("só o turno 2 preenchido → parcial", () => {
    const d = avaliarDiaAtual("2026-11-09", aba(turno(1, 0), turno(2, R(10))));
    expect(d.completo).toBe(false);
    expect(d.turnos[0].total).toBeNull();
  });

  it("aba ausente ou vazia → os dois aguardando", () => {
    for (const a of [null, aba(turno(1, 0), turno(2, 0))]) {
      const d = avaliarDiaAtual("2026-11-09", a);
      expect(d.completo).toBe(false);
      expect(textoDiaAtual(d)).toBe("09/11 · Turno 1: aguardando · Turno 2: aguardando");
    }
  });

  it("turno preenchido = soma das partes > 0", () => {
    expect(turnoPreenchido(undefined)).toBe(false);
    expect(turnoPreenchido({ somaOrigens: 0 })).toBe(false);
    expect(turnoPreenchido({ somaOrigens: 1 })).toBe(true);
    expect(diaCompleto(1, 1)).toBe(true);
    expect(diaCompleto(1, 0)).toBe(false);
  });
});

describe("dia em andamento: banco × planilha", () => {
  const planilha = avaliarDiaAtual("2026-11-09", aba(turno(1, R(749.65)), turno(2, 0)));

  it("sem nada no banco, mostra a planilha", () => {
    const d = mesclarDiaAtual("2026-11-09", { turno1: 0, turno2: 0 }, planilha);
    expect(d.completo).toBe(false);
    expect(d.turnos[0].total).toBe(R(749.65));
    expect(d.turnos[1].total).toBeNull();
  });

  it("lançamento manual de um turno prevalece sobre a planilha nesse turno", () => {
    const d = mesclarDiaAtual("2026-11-09", { turno1: R(800), turno2: 0 }, planilha);
    expect(d.turnos[0].total).toBe(R(800));
    expect(d.completo).toBe(false);
  });

  it("completo só quando o banco tem os dois turnos (é o que o cálculo usa)", () => {
    expect(mesclarDiaAtual("2026-11-09", { turno1: R(800), turno2: R(900) }, planilha).completo).toBe(true);
  });

  it("leitura de outro dia (ex.: de ontem, antes da virada) é ignorada", () => {
    const d = mesclarDiaAtual("2026-11-10", { turno1: 0, turno2: 0 }, planilha);
    expect(d.turnos.every((t) => t.total === null)).toBe(true);
  });
});

describe("sincronização automática ao abrir o painel", () => {
  const agora = Date.parse("2026-11-10T03:10:00Z"); // 00:10 em SP

  it("sem nenhuma sincronização → sincroniza", () => {
    expect(precisaSincronizar(null, agora)).toBe(true);
  });
  it("menos de 30 min no mesmo dia → não sincroniza", () => {
    expect(precisaSincronizar("2026-11-10T03:00:00Z", agora)).toBe(false); // 00:00 SP
  });
  it("30 min ou mais → sincroniza", () => {
    expect(precisaSincronizar("2026-11-10T02:40:00Z", agora)).toBe(true);
  });
  it("virou a meia-noite em SP (última às 23:55 de ontem) → sincroniza mesmo com 15 min", () => {
    expect(precisaSincronizar("2026-11-10T02:55:00Z", agora)).toBe(true);
  });
  it("meia-noite UTC não conta: 20:50 e 21:10 em SP são o mesmo dia", () => {
    expect(precisaSincronizar("2026-11-09T23:50:00Z", Date.parse("2026-11-10T00:10:00Z"))).toBe(false);
  });
});
