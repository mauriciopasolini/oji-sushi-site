import type { Metadata } from "next";
import Link from "next/link";
import { fimDoMes } from "@/lib/cmv/dados";
import { competenciaDe, diasDoMes, hojeSP, somarDias } from "@/lib/cmv/datas";
import { centavos, formatarBRL } from "@/lib/cmv/dinheiro";
import { metasDiarias } from "@/lib/cmv/engine";
import { getSessao } from "@/lib/cmv/sessao";
import { type CampoValor, type Origem, TODOS_CAMPOS } from "@/lib/cmv/vendas";
import { createClient } from "@/lib/supabase/server";
import { emailContaServico } from "@/lib/cmv/planilha/google";
import { BotaoSincronizar, ConfigPlanilha, type ConflitoTela, ListaConflitos } from "../sincronizacao/componentes";
import { EditorDia, type VendaExistente } from "./editor-dia";

export const metadata: Metadata = { title: "Vendas" };

const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const dataBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export default async function VendasPage({ searchParams }: { searchParams: Promise<{ mes?: string; data?: string }> }) {
  const sp = await searchParams;
  const hoje = hojeSP();
  const sessao = await getSessao();
  const supabase = await createClient();

  const competencia = /^\d{4}-\d{2}$/.test(sp.mes ?? "") ? `${sp.mes}-01` : competenciaDe(sp.data ?? hoje);
  const fim = fimDoMes(competencia);

  const ehAdmin = sessao?.perfil?.papel === "admin";
  const [{ data: vendas }, { data: fech }, { data: mes }, { data: pesos }, { data: conflitosRaw }, { data: syncs }, { data: planilhaAnterior }] = await Promise.all([
    supabase.from("vendas_turno").select("*").gte("data", competencia).lte("data", fim),
    supabase.from("fechamento_turno").select("data, turno, sincronizado_em").gte("data", competencia).lte("data", fim),
    supabase.from("meses").select("meta_venda, status, planilha_url").eq("competencia", competencia).maybeSingle(),
    supabase.from("pesos_dia_semana").select("dia_semana, peso").order("dia_semana"),
    supabase.from("conflitos_venda").select("*").is("resolucao", null).gte("data", competencia).lte("data", fim).order("data"),
    supabase.from("sincronizacoes").select("id, gatilho, status, iniciado_em, resumo, erro").eq("competencia", competencia).order("iniciado_em", { ascending: false }).limit(5),
    supabase.from("meses").select("planilha_url").not("planilha_url", "is", null).lte("competencia", competencia).order("competencia", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const conflitos: ConflitoTela[] = (conflitosRaw ?? []).map((c) => ({
    id: c.id, data: c.data, turno: c.turno, origem: c.origem,
    totalManual: centavos(c.total_manual), totalPlanilha: centavos(c.total_planilha),
    manual: c.valores_manual, planilha: c.valores_planilha,
  }));
  const quando = (ts: string) =>
    new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
  const GATILHO: Record<string, string> = { manual: "botão", automatica: "automática", cron: "diária (04:00)" };

  const pesosDia = Array<number>(7).fill(0);
  for (const p of pesos ?? []) pesosDia[p.dia_semana] = Number(p.peso);
  const metas = new Map(
    metasDiarias({
      competencia, metaVenda: centavos(mes?.meta_venda ?? 90000), metaCmvPct: 0.35, pesosSemana: [6.5, 6.5, 5.5, 5.5], limiteAcumuloPct: 1.25, pesosDiaSemana: pesosDia,
    }).map((m) => [m.data, m.meta]),
  );

  type Linha = { data: string; turno: 1 | 2; origem: Origem; fonte: "manual" | "planilha"; total_calculado: number; qtd_pedidos: number | null } & Record<CampoValor, number>;
  const linhas = (vendas ?? []) as Linha[];
  const diasRegistrados = new Set([...linhas.map((l) => l.data), ...(fech ?? []).map((f) => f.data)]);
  const ontem = somarDias(hoje, -1);
  const dias = diasDoMes(competencia).filter((d) => d <= hoje);

  const dia = (d: string) => {
    const ls = linhas.filter((l) => l.data === d);
    const t = (turno: number) => ls.filter((l) => l.turno === turno).reduce((a, l) => a + centavos(l.total_calculado), 0);
    const fontes = new Set(ls.map((l) => l.fonte));
    return { t1: t(1), t2: t(2), total: t(1) + t(2), fontes };
  };

  const selecionada = sp.data && /^\d{4}-\d{2}-\d{2}$/.test(sp.data) && sp.data <= hoje && competenciaDe(sp.data) === competencia ? sp.data : null;
  const existentes: VendaExistente[] = selecionada
    ? linhas
        .filter((l) => l.data === selecionada)
        .map((l) => ({
          turno: l.turno,
          origem: l.origem,
          fonte: l.fonte,
          qtdPedidos: l.qtd_pedidos,
          valores: Object.fromEntries(TODOS_CAMPOS.map((c) => [c, centavos(l[c])])) as Record<CampoValor, number>,
        }))
    : [];

  const totalMes = dias.reduce((a, d) => a + dia(d).total, 0);
  const mesFechado = mes?.status === "fechado";

  return (
    <main className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">Vendas</h1>
        <p className="text-sm text-neutral-600">
          Total no mês <strong className="tabular-nums">{formatarBRL(totalMes)}</strong>
        </p>
      </div>
      <section className="rounded-2xl border border-neutral-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Planilha de fechamento de caixa</h2>
          {!mesFechado && <BotaoSincronizar />}
        </div>
        <p className="mt-1 text-sm text-neutral-600">
          As vendas são lidas da planilha (soma das partes de cada origem). Lançamentos manuais nunca são sobrescritos: se a planilha trouxer outro
          valor, aparece um conflito para o administrador decidir.
        </p>
        {syncs && syncs.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-neutral-600">
            {syncs.map((s) => (
              <li key={s.id}>
                <span className={s.status === "erro" ? "text-red-700" : s.status === "ok" ? "text-green-700" : ""}>●</span> {quando(s.iniciado_em)} ·{" "}
                {GATILHO[s.gatilho] ?? s.gatilho} · {s.status === "erro" ? s.erro : (s.resumo as { mensagem?: string } | null)?.mensagem ?? s.status}
              </li>
            ))}
          </ul>
        )}
        {ehAdmin && (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium">Planilha do mês</summary>
            <div className="mt-2">
              <ConfigPlanilha competencia={competencia} url={mes?.planilha_url ?? planilhaAnterior?.planilha_url ?? ""} emailServico={emailContaServico()} />
            </div>
          </details>
        )}
      </section>

      {conflitos.length > 0 && (
        <section id="conflitos" className="space-y-2">
          <h2 className="font-semibold">Conflitos: venda manual × planilha ({conflitos.length})</h2>
          <ListaConflitos conflitos={conflitos} ehAdmin={ehAdmin} />
        </section>
      )}

      <div className={`grid gap-4 ${selecionada ? "lg:grid-cols-[1fr_1.2fr]" : ""}`}>
        <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-medium">Dia</th>
                <th className="px-3 py-2 text-right font-medium">Turno 1</th>
                <th className="px-3 py-2 text-right font-medium">Turno 2</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 text-right font-medium">Meta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {dias.map((d) => {
                const x = dia(d);
                const falta = d <= ontem && !diasRegistrados.has(d);
                const sel = d === selecionada;
                return (
                  <tr key={d} className={sel ? "bg-neutral-900 text-white" : falta ? "bg-amber-50" : ""}>
                    <td className="px-3 py-2">
                      <Link href={`/painel/cmv/vendas?data=${d}`} className="block font-medium underline-offset-2 hover:underline">
                        {dataBR(d)} <span className={sel ? "text-neutral-300" : "text-neutral-500"}>{SEMANA[new Date(`${d}T12:00:00Z`).getUTCDay()]}</span>
                        {falta && <span className="ml-1 text-xs text-amber-800">sem venda</span>}
                        {x.fontes.has("planilha") && <span className="ml-1 text-xs text-blue-700">planilha</span>}
                        {x.fontes.has("manual") && <span className={`ml-1 text-xs ${sel ? "text-neutral-300" : "text-neutral-500"}`}>manual</span>}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{x.t1 ? formatarBRL(x.t1) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{x.t2 ? formatarBRL(x.t2) : "—"}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{diasRegistrados.has(d) ? formatarBRL(x.total) : "—"}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${sel ? "text-neutral-300" : "text-neutral-500"}`}>{formatarBRL(metas.get(d) ?? 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {selecionada && (
          <div>
            <h2 className="mb-3 text-lg font-semibold">Vendas de {dataBR(selecionada)}</h2>
            {mesFechado ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">Mês fechado: vendas não podem ser alteradas.</p>
            ) : (
              <EditorDia key={selecionada} data={selecionada} existentes={existentes} ehAdmin={ehAdmin} />
            )}
          </div>
        )}
      </div>
    </main>
  );
}
