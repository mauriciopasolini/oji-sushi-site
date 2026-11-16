import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { carregarEntrada, dadosDoRelatorio, listarVersoes } from "@/lib/cmv/fechamento/carregar";
import { checklistCompleto } from "@/lib/cmv/fechamento/checklist";
import { brl, nomeMes, pct } from "@/lib/cmv/fechamento/formatos";
import { montarFechamento } from "@/lib/cmv/fechamento/montar";
import { competenciaDe, hojeSP, INICIO_SISTEMA, somarMeses } from "@/lib/cmv/datas";
import { getSessao } from "@/lib/cmv/sessao";
import { createClient } from "@/lib/supabase/server";
import { FecharMes, FormErp, ReabrirMes } from "./acoes";

export const metadata: Metadata = { title: "Fechamento do mês" };

const quando = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
const valorCampo = (c: number | null) => (c === null ? "" : (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export default async function FechamentoPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const sessao = await getSessao();
  if (sessao?.perfil?.papel !== "admin") redirect("/painel/cmv");

  const sp = await searchParams;
  const hoje = hojeSP();
  const atual = competenciaDe(hoje);
  const supabase = await createClient();

  // Sem mês na URL: o mês anterior enquanto estiver aberto (o fechamento acontece no início do mês seguinte).
  let competencia = /^\d{4}-\d{2}$/.test(sp.mes ?? "") ? `${sp.mes}-01` : null;
  if (!competencia) {
    const anterior = somarMeses(atual, -1);
    const { data } = await supabase.from("meses").select("status").eq("competencia", anterior).maybeSingle();
    competencia = anterior >= INICIO_SISTEMA && data?.status === "aberto" ? anterior : atual;
  }
  if (competencia < INICIO_SISTEMA) competencia = INICIO_SISTEMA;
  if (competencia > atual) competencia = atual;

  const { entrada, mes } = await carregarEntrada(supabase, competencia, hoje);
  const fechado = mes.status === "fechado";
  // Mês fechado: o resumo vem do snapshot gravado. Aberto: prévia com os dados de agora.
  const dados = fechado ? await dadosDoRelatorio(supabase, competencia, hoje) : montarFechamento(entrada, { previa: true });
  const versoes = await listarVersoes(supabase, mes.id);
  const pronto = checklistCompleto(dados.checklist);
  const nome = nomeMes(competencia);
  const mesUrl = competencia.slice(0, 7);
  const anterior = somarMeses(competencia, -1);
  const proximo = somarMeses(competencia, 1);
  const exportar = (formato: "pdf" | "xlsx") => `/painel/cmv/fechamento/exportar?mes=${mesUrl}&formato=${formato}`;

  return (
    <main className="space-y-5 pb-16">
      <div className="flex items-center justify-between gap-2">
        {anterior >= INICIO_SISTEMA ? (
          <Link href={`/painel/cmv/fechamento?mes=${anterior.slice(0, 7)}`} className="rounded-lg px-2 py-1 text-neutral-500 hover:bg-neutral-100" aria-label="Mês anterior">
            ←
          </Link>
        ) : (
          <span className="w-8" />
        )}
        <div className="text-center">
          <h1 className="text-xl font-bold">Fechamento do mês</h1>
          <p className="text-sm text-neutral-600">Fechamento de {nome}</p>
        </div>
        {proximo <= atual ? (
          <Link href={`/painel/cmv/fechamento?mes=${proximo.slice(0, 7)}`} className="rounded-lg px-2 py-1 text-neutral-500 hover:bg-neutral-100" aria-label="Próximo mês">
            →
          </Link>
        ) : (
          <span className="w-8" />
        )}
      </div>

      {!mes.id ? (
        <p className="rounded-2xl border border-neutral-200 bg-white px-4 py-8 text-center text-neutral-500">Este mês ainda não existe no sistema.</p>
      ) : (
        <>
          {/* Situação */}
          <section className={`rounded-2xl border px-4 py-3 ${fechado ? "border-green-200 bg-green-50 text-green-950" : "border-neutral-200 bg-white"}`}>
            {fechado ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">Mês fechado</p>
                  <p className="text-sm">
                    {dados.fechamento ? `Em ${quando(dados.fechamento.fechadoEm)} por ${dados.fechamento.fechadoPor} · versão ${dados.fechamento.versao}` : mes.fechadoEm ? `Em ${quando(mes.fechadoEm)}` : ""}.
                    Notas, contagem e vendas do mês estão travadas.
                  </p>
                </div>
                <ReabrirMes competencia={competencia} />
              </div>
            ) : (
              <p className="text-sm text-neutral-700">
                <strong>Mês aberto.</strong> Os números abaixo são uma prévia e mudam a cada nota, contagem ou sincronização.
                {versoes.length > 0 && ` Foi fechado e reaberto (${versoes.length} fechamento(s) anterior(es)).`}
              </p>
            )}
          </section>

          {/* Resumo */}
          <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Venda base", brl(dados.base.base), dados.base.origem === "erp" ? "ERP + delivery (menor)" : dados.base.origem === "caixa" ? "caixa (menor)" : "caixa (ERP não informado)"],
              [dados.cmv.tipo === "real" ? "CMV real" : "CMV de compras", brl(dados.cmv.valor), `${dados.notas.length} nota(s)`],
              ["CMV %", pct(dados.cmv.pct), `meta ${pct(dados.cmv.metaPct)}`],
              ["Faixa da régua", dados.cmv.faixa?.faixa ?? "—", dados.cmv.tipo === "real" ? `compras: ${pct(dados.cmv.comprasPct)}` : "sem estoque inicial"],
            ].map(([t, v, sub]) => (
              <div key={t} className="rounded-xl border border-neutral-200 bg-white px-3 py-2">
                <p className="text-sm text-neutral-500">{t}</p>
                <p className="text-lg font-bold tabular-nums" style={t === "CMV %" || t === "Faixa da régua" ? { color: dados.cmv.faixa?.cor } : undefined}>
                  {v}
                </p>
                <p className="text-xs text-neutral-500">{sub}</p>
              </div>
            ))}
          </section>

          {/* Checklist */}
          {!fechado && (
            <section className="space-y-2">
              <h2 className="font-semibold">Checklist do fechamento</h2>
              <ul className="space-y-2">
                {dados.checklist.map((i) => (
                  <li key={i.id} id={i.id === "erp" ? "erp" : undefined} className={`rounded-2xl border bg-white px-4 py-3 ${i.ok ? "border-neutral-200" : "border-amber-300"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">
                          <span aria-hidden className={i.ok ? "text-green-700" : "text-amber-700"}>
                            {i.ok ? "✓" : "○"}
                          </span>{" "}
                          {i.titulo}
                          <span className="sr-only">{i.ok ? " (ok)" : " (pendente)"}</span>
                        </p>
                        <p className="text-sm text-neutral-600">{i.resumo}</p>
                        {i.detalhes.length > 0 && (
                          <ul className="mt-1 list-disc pl-5 text-sm text-neutral-600">
                            {i.detalhes.map((d) => (
                              <li key={d}>{d}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                      {i.href && !i.ok && (
                        <Link href={i.href} className="shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-50">
                          {i.acao}
                        </Link>
                      )}
                    </div>
                    {i.id === "erp" && (
                      <div className="mt-3 space-y-2">
                        <FormErp competencia={competencia} valorInicial={valorCampo(entrada.mes.vendaBaseErp)} bloqueado={fechado} />
                        <p className="text-sm text-neutral-600">
                          Caixa: {brl(dados.base.caixa)}
                          {dados.base.divergencia !== null && ` · diferença caixa - ERP: ${brl(dados.base.divergencia)}`} · base: {brl(dados.base.base)}
                        </p>
                        <p className="text-xs text-neutral-500">{dados.base.nota}</p>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {fechado && (
            <section className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-700">
              <p className="font-medium">Base de cálculo</p>
              <p>{dados.base.nota}</p>
              {dados.estoque.nota && <p className="mt-2">{dados.estoque.nota}</p>}
            </section>
          )}

          {/* Ações */}
          <section className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-neutral-200 bg-white px-4 py-4">
            {!fechado ? <FecharMes competencia={competencia} nome={nome} pronto={pronto} /> : <span />}
            <div className="space-y-1 text-right">
              <div className="flex flex-wrap justify-end gap-2">
                <a href={exportar("pdf")} className="rounded-xl border border-neutral-300 px-4 py-2.5 text-sm font-semibold hover:bg-neutral-50">
                  {fechado ? "Baixar PDF" : "Baixar PDF (prévia)"}
                </a>
                <a href={exportar("xlsx")} className="rounded-xl border border-neutral-300 px-4 py-2.5 text-sm font-semibold hover:bg-neutral-50">
                  {fechado ? "Baixar Excel" : "Baixar Excel (prévia)"}
                </a>
              </div>
              <p className="text-xs text-neutral-500">{fechado ? "A partir do snapshot do fechamento." : "Com os dados de agora; marcado como prévia."}</p>
            </div>
          </section>

          {versoes.length > 0 && (
            <section className="space-y-1 text-sm">
              <h2 className="font-semibold">Fechamentos gravados</h2>
              <ul className="divide-y divide-neutral-200 rounded-2xl border border-neutral-200 bg-white">
                {versoes.map((v) => (
                  <li key={v.versao} className="flex flex-wrap justify-between gap-2 px-4 py-2">
                    <span>
                      Versão {v.versao} · {quando(v.criadoEm)} · {v.criadoPor}
                    </span>
                    <span className="tabular-nums text-neutral-600">
                      {brl(v.vendaBase)} · CMV {v.cmvTipo === "real" ? "real" : "de compras"} {brl(v.cmvValor)} ({pct(v.cmvPct)})
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
