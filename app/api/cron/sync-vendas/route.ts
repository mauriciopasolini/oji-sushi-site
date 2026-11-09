import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { hojeSP } from "@/lib/cmv/datas";
import { sincronizarHoje } from "@/lib/cmv/planilha/sincronizar";

// Vercel Cron: todo dia às 04:00 de São Paulo (07:00 UTC, ver vercel.json).
// Protegido por CRON_SECRET (a Vercel envia "Authorization: Bearer <CRON_SECRET>").
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function autorizado(req: Request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return false;
  const recebido = Buffer.from(req.headers.get("authorization") ?? "");
  const esperado = Buffer.from(`Bearer ${segredo}`);
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

export async function GET(req: Request) {
  if (!autorizado(req)) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  try {
    const resultados = await sincronizarHoje({ hoje: hojeSP(), gatilho: "cron" });
    const falhou = resultados.some((r) => r.status === "erro");
    return NextResponse.json({ ok: !falhou, resultados: resultados.map((r) => ({ competencia: r.competencia, status: r.status, mensagem: r.mensagem })) }, { status: falhou ? 500 : 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: (e as Error).message }, { status: 500 });
  }
}
