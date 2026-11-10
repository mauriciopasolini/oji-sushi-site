// Integração (ENSAIO: não grava nada): planilha real + banco real.
import { describe, expect, it } from "vitest";
import { textoDiaAtual } from "../dia-atual";
import { totalDe } from "./planejar";
import { sincronizarMes } from "./sincronizar";

describe("Sincronização — ensaio com a planilha real de novembro/2026", () => {
  it("lê 01 a 08/11 (hoje = 09/11), soma pelas partes = 30.670,84, sem gravar; 09/11 é o dia em andamento", async () => {
    const r = await sincronizarMes({ competencia: "2026-11-01", hoje: "2026-11-09", gatilho: "manual", ensaio: true });
    console.log(r.mensagem);
    expect(r.status).toBe("ok");
    // 09/11 é "hoje": só entra na gravação se os dois turnos estiverem preenchidos.
    expect(r.diaAtual?.data).toBe("2026-11-09");
    console.log(`  hoje: ${textoDiaAtual(r.diaAtual!)} · completo: ${r.diaAtual!.completo}`);
    expect(r.diasLidos).toBe(r.diaAtual!.completo ? 9 : 8);
    expect(r.abasFaltando).toEqual([]);
    expect(r.abasVazias).toEqual([]);
    const plano = r.plano!;
    const porDia = new Map<string, number>();
    for (const v of plano.gravarVendas) porDia.set(v.data, (porDia.get(v.data) ?? 0) + totalDe(v));
    for (const c of plano.conflitos) porDia.set(c.data, (porDia.get(c.data) ?? 0) + c.totalPlanilha);
    for (const [d, t] of [...porDia].sort()) console.log(`  ${d}  ${(t / 100).toFixed(2)}`);
    expect(porDia.get("2026-11-08")).toBe(504658);
    const ate8 = [...porDia].filter(([d]) => d <= "2026-11-08").reduce((a, [, t]) => a + t, 0);
    expect(ate8).toBe(3067084);
    if (r.diaAtual!.completo) expect(porDia.get("2026-11-09")).toBe(r.diaAtual!.turnos.reduce((a, t) => a + (t.total ?? 0), 0));
    else expect(porDia.has("2026-11-09")).toBe(false);
    console.log(`  linhas: ${plano.gravarVendas.length} · conflitos: ${plano.conflitos.length} · conciliadas: ${plano.conciliadas.length} · divergências: ${plano.divergencias.length} · fechamentos: ${plano.gravarFechamentos.length}`);
  });

  it("hoje = 10/11: lê o dia em andamento sem gravar nada dele enquanto parcial", async () => {
    const r = await sincronizarMes({ competencia: "2026-11-01", hoje: "2026-11-10", gatilho: "manual", ensaio: true });
    console.log(r.mensagem);
    expect(r.status).toBe("ok");
    console.log(`  hoje: ${textoDiaAtual(r.diaAtual!)} · completo: ${r.diaAtual!.completo}`);
    const gravaHoje = r.plano!.gravarVendas.some((v) => v.data === "2026-11-10");
    expect(gravaHoje).toBe(r.diaAtual!.completo);
  });
});
