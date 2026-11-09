// Integração (ENSAIO: não grava nada): planilha real + banco real.
import { describe, expect, it } from "vitest";
import { totalDe } from "./planejar";
import { sincronizarMes } from "./sincronizar";

describe("Sincronização — ensaio com a planilha real de novembro/2026", () => {
  it("lê 01 a 08/11 (hoje = 09/11), soma pelas partes = 30.670,84, sem gravar", async () => {
    const r = await sincronizarMes({ competencia: "2026-11-01", hoje: "2026-11-09", gatilho: "manual", ensaio: true });
    console.log(r.mensagem);
    expect(r.status).toBe("ok");
    expect(r.diasLidos).toBe(8);
    expect(r.abasFaltando).toEqual([]);
    expect(r.abasVazias).toEqual([]);
    const plano = r.plano!;
    const porDia = new Map<string, number>();
    for (const v of plano.gravarVendas) porDia.set(v.data, (porDia.get(v.data) ?? 0) + totalDe(v));
    for (const c of plano.conflitos) porDia.set(c.data, (porDia.get(c.data) ?? 0) + c.totalPlanilha);
    for (const [d, t] of [...porDia].sort()) console.log(`  ${d}  ${(t / 100).toFixed(2)}`);
    expect(porDia.get("2026-11-08")).toBe(504658);
    expect([...porDia.values()].reduce((a, b) => a + b, 0)).toBe(3067084);
    console.log(`  linhas: ${plano.gravarVendas.length} · conflitos: ${plano.conflitos.length} · conciliadas: ${plano.conciliadas.length} · divergências: ${plano.divergencias.length} · fechamentos: ${plano.gravarFechamentos.length}`);
  });
});
