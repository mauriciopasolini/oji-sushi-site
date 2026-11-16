// Integração (SÓ LEITURA): monta a prévia do fechamento com os dados reais do banco e
// grava PDF e Excel na pasta de SAIDA_PREVIA (ou só confere, sem a variável).
//   SAIDA_PREVIA=<pasta> MES_PREVIA=2026-11 npm run test:integracao -- lib/cmv/fechamento/previa
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAdminClient } from "../../supabase/admin";
import { hojeSP } from "../datas";
import { gerarExcel } from "../relatorio/excel";
import { gerarPdf } from "../relatorio/pdf";
import { carregarEntrada } from "./carregar";
import { contagem, CAT, entradaBase } from "./exemplo";
import { montarFechamento } from "./montar";

describe("Prévia do fechamento com os dados reais", () => {
  it("monta, gera PDF e Excel sem gravar nada no banco", async () => {
    const mes = process.env.MES_PREVIA ?? "2026-11";
    const supabase = createAdminClient();
    const { entrada } = await carregarEntrada(supabase, `${mes}-01`, hojeSP());
    const d = montarFechamento(entrada, { previa: true });
    console.log(
      `${mes}: caixa ${d.base.caixa / 100} · ERP ${d.base.erp === null ? "—" : d.base.erp / 100} · compras ${d.cmv.compras / 100} · CMV ${((d.cmv.pct ?? 0) * 100).toFixed(1)}% (${d.cmv.tipo}) · ${d.notas.length} notas · checklist: ${d.checklist.filter((i) => !i.ok).map((i) => i.id).join(", ") || "ok"}`,
    );
    const pdf = await gerarPdf(d);
    const xlsx = await gerarExcel(d);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(xlsx.subarray(0, 2).toString()).toBe("PK");
    const saida = process.env.SAIDA_PREVIA;
    if (saida) {
      mkdirSync(saida, { recursive: true });
      writeFileSync(path.join(saida, `previa-fechamento-cmv-${mes}.pdf`), pdf);
      writeFileSync(path.join(saida, `previa-fechamento-cmv-${mes}.xlsx`), xlsx);
      writeFileSync(path.join(saida, `previa-fechamento-cmv-${mes}.json`), JSON.stringify(d, null, 2));
      console.log(`gravados em ${saida}: PDF ${pdf.length} bytes, Excel ${xlsx.length} bytes`);
    }
  });

  it("exemplo fictício com estoque inicial e final (CMV real), para conferir o layout", async () => {
    const e = entradaBase("2027-01-01", "2027-02-01");
    e.contagemInicial = { ...contagem("2026-12-31", [[CAT.pescados.id, 800_000], [CAT.bebidas.id, 200_000]]), competencia: "2026-12-01" };
    e.contagemFinal = contagem("2027-01-31", [[CAT.pescados.id, 600_000], [CAT.bebidas.id, 100_000]]);
    e.historico = [{ competencia: "2026-12-01", venda: 9_000_000, cmvValor: 3_240_000, cmvPct: 0.36, fonte: "sistema" }];
    const d = montarFechamento(e, { previa: false, geradoEm: "2027-02-01T12:00:00.000Z" });
    d.fechamento = { versao: 1, fechadoEm: "2027-02-01T12:00:00.000Z", fechadoPor: "Exemplo" };
    const pdf = await gerarPdf(d);
    expect(d.cmv.tipo).toBe("real");
    if (process.env.SAIDA_PREVIA) writeFileSync(path.join(process.env.SAIDA_PREVIA, "exemplo-ficticio-cmv-real.pdf"), pdf);
  });
});
