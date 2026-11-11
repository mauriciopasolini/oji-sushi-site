import type { Metadata } from "next";
import Link from "next/link";
import { type Alerta, gerarAlertas, listarDias } from "@/lib/cmv/alertas";
import { carregarCaixa, carregarPainel } from "@/lib/cmv/dados";
import { mesclarDiaAtual, textoDiaAtual } from "@/lib/cmv/dia-atual";
import { competenciaDe, hojeSP, montar, partes, rotuloSemana } from "@/lib/cmv/datas";
import { centavos, formatarBRL, formatarPct } from "@/lib/cmv/dinheiro";
import { type CorSemaforo, type OrcamentoCategoria, corVendas } from "@/lib/cmv/engine";
import { getSessao } from "@/lib/cmv/sessao";
import { RE_UUID } from "@/lib/cmv/tipos";
import { createClient } from "@/lib/supabase/server";
import { TabelaCmvSemanas } from "./cmv-semanas";
import { BotaoSincronizar, SincronizacaoAutomatica } from "./sincronizacao/componentes";

export const metadata: Metadata = { title: "CMV" };

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const dataBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const quando = (ts: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(ts));

const SEMAFORO: Record<CorSemaforo, { rotulo: string; ponto: string; texto: string }> = {
  verde: { rotulo: "No ritmo", ponto: "bg-green-500", texto: "text-green-800" },
  amarelo: { rotulo: "Acima do ritmo (até 10%)", ponto: "bg-amber-400", texto: "text-amber-800" },
  vermelho: { rotulo: "Acima do ritmo", ponto: "bg-red-500", texto: "text-red-700" },
};

const ESTILO_ALERTA: Record<Alerta["nivel"], string> = {
  erro: "border-red-200 bg-red-50 text-red-900",
  aviso: "border-amber-200 bg-amber-50 text-amber-900",
  info: "border-blue-200 bg-blue-50 text-blue-900",
};

function mesVizinho(competencia: string, delta: number) {
  const { ano, mes } = partes(competencia);
  const d = new Date(Date.UTC(ano, mes - 1 + delta, 1));
  return montar(d.getUTCFullYear(), d.getUTCMonth() + 1, 1).slice(0, 7);
}

function Semaforo({ cor }: { cor: CorSemaforo }) {
  const s = SEMAFORO[cor];
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${s.texto}`}>
      <span className={`h-2.5 w-2.5 rounded-full ${s.ponto}`} aria-hidden />
      {s.rotulo}
    </span>
  );
}

const COR_BARRA: Record<CorSemaforo, string> = { verde: "bg-green-500", amarelo: "bg-amber-400", vermelho: "bg-red-500" };
const COR_TEXTO_VENDAS: Record<CorSemaforo, string> = { verde: "text-green-700", amarelo: "text-amber-700", vermelho: "text-red-700" };

/** Barra de consumo (compras × orçamento): passar do total é ruim. `cor` substitui essa lógica (ex.: vendas). */
function Barra({ valor, total, escuro = false, cor }: { valor: number; total: number; escuro?: boolean; cor?: CorSemaforo }) {
  const pct = total > 0 ? Math.min(100, (valor / total) * 100) : valor > 0 ? 100 : 0;
  const estourou = valor > total;
  const preenchimento = cor ? COR_BARRA[cor] : estourou ? "bg-red-500" : pct > 85 ? "bg-amber-400" : escuro ? "bg-white" : "bg-neutral-900";
  return (
    <div className={`h-3 w-full overflow-hidden rounded-full ${escuro ? "bg-white/15" : "bg-neutral-200"}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${preenchimento}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function CardPrincipal({ c, provisorio }: { c: OrcamentoCategoria & { nome: string }; provisorio: boolean }) {
  const semana = c.semanaAtual ? c.semanas[c.semanaAtual - 1] : null;
  const negativo = c.disponivelAgora < 0;
  return (
    <section className="rounded-3xl bg-neutral-900 p-5 text-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-neutral-300">
          {c.nome} · disponível nesta semana
          {provisorio && <span className="ml-2 rounded bg-amber-400/20 px-1.5 py-0.5 text-xs text-amber-200">provisório</span>}
        </p>
        {semana && (
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs">
            S{semana.numero} · {rotuloSemana(semana)}
          </span>
        )}
      </div>
      {semana ? (
        <>
          <p className={`mt-2 text-5xl font-bold tracking-tight tabular-nums ${negativo ? "text-red-300" : ""}`}>{formatarBRL(c.disponivelAgora)}</p>
          {negativo && <p className="text-sm text-red-200">Semana estourada: o excesso já saiu das próximas semanas.</p>}
          {c.semSaldo && !negativo && <p className="text-sm text-red-200">Sem saldo no mês para esta categoria.</p>}
          <div className="mt-4 space-y-2">
            <Barra valor={c.compradoSemana} total={c.orcamentoSemana} escuro />
            <div className="flex flex-wrap justify-between gap-2 text-sm text-neutral-300">
              <span className="tabular-nums">
                Comprado {formatarBRL(c.compradoSemana)} de {formatarBRL(c.orcamentoSemana)}
              </span>
              <span className="rounded-full bg-white px-2 py-0.5">
                <Semaforo cor={c.ritmo.cor} />
              </span>
            </div>
          </div>
        </>
      ) : (
        <p className="mt-2 text-lg">Mês encerrado.</p>
      )}
      <p className="mt-3 text-xs text-neutral-400 tabular-nums">
        Mês: teto {formatarBRL(c.teto)} · comprado {formatarBRL(c.compradoMes)} · saldo {formatarBRL(c.saldo)}
      </p>
    </section>
  );
}

function CardCategoria({ c }: { c: OrcamentoCategoria & { nome: string } }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">{c.nome}</p>
        <Semaforo cor={c.ritmo.cor} />
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-neutral-500">Teto</dt>
          <dd className="font-semibold tabular-nums">{formatarBRL(c.teto)}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Comprado</dt>
          <dd className="font-semibold tabular-nums">{formatarBRL(c.compradoMes)}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Saldo</dt>
          <dd className={`font-semibold tabular-nums ${c.saldo < 0 ? "text-red-700" : ""}`}>{formatarBRL(c.saldo)}</dd>
        </div>
      </dl>
      <div className="mt-3">
        <Barra valor={c.compradoMes} total={c.teto} />
      </div>
      {c.semanaAtual && (
        <p className={`mt-2 text-sm tabular-nums ${c.disponivelAgora < 0 ? "text-red-700" : "text-neutral-600"}`}>
          Nesta semana: {formatarBRL(c.disponivelAgora)} disponível
        </p>
      )}
    </div>
  );
}

export default async function CmvPage({ searchParams }: { searchParams: Promise<{ nota?: string; mes?: string; cat?: string }> }) {
  const sp = await searchParams;
  const hoje = hojeSP();
  const competencia = /^\d{4}-\d{2}$/.test(sp.mes ?? "") ? `${sp.mes}-01` : competenciaDe(hoje);
  const ehMesAtual = competencia === competenciaDe(hoje);
  const sessao = await getSessao();
  const ehAdmin = sessao?.perfil?.papel === "admin";
  const supabase = await createClient();

  const [painel, caixa, notaQ, fruteiraQ, novosQ, semNotaQ] = await Promise.all([
    carregarPainel(supabase, competencia, hoje),
    carregarCaixa(supabase, competencia),
    sp.nota && RE_UUID.test(sp.nota)
      ? supabase.from("notas").select("valor, data_emissao, categoria_id, fornecedores(nome)").eq("id", sp.nota).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("fornecedores").select("id").ilike("nome", "fruteira").eq("ativo", true).maybeSingle(),
    ehAdmin ? supabase.from("fornecedores").select("id", { count: "exact", head: true }).is("revisado_em", null) : Promise.resolve({ count: 0 }),
    supabase.from("notas").select("id", { count: "exact", head: true }).eq("tipo", "sem_nota").eq("status", "ativa"),
  ]);
  const { resultado: r, mes } = painel;
  const mesFechado = mes.status === "fechado";
  const provisorio = r.vendasIncompletas && !mesFechado;
  const alertas = gerarAlertas({ painel: r, ehAdmin, fornecedoresNovos: novosQ.count ?? 0, mesFechado, caixa, comprasSemNota: semNotaQ.count ?? 0 });

  const [principal, ...outras] = r.categorias;
  const nova = notaQ.data as { valor: number; data_emissao: string; categoria_id: string; fornecedores: { nome: string } | null } | null;
  const catNova = nova ? r.categorias.find((c) => c.categoriaId === nova.categoria_id) : undefined;
  const catTabela = r.categorias.find((c) => c.categoriaId === sp.cat) ?? principal;
  const p = r.projecao;
  const cp = r.cmvProjetado;
  const meta = mes.metaCmvPct;
  const { ano, mes: m } = partes(competencia);
  // Dia em andamento: só exibição, fora do cálculo enquanto os dois turnos não estiverem preenchidos.
  const diaAtual = ehMesAtual ? mesclarDiaAtual(hoje, painel.hojeNoBanco, caixa.diaAtual) : null;
  const mostrarParcial = diaAtual && !diaAtual.completo && diaAtual.turnos.some((t) => t.total !== null);

  return (
    <main className="space-y-5 pb-28">
      <div className="flex items-center justify-between gap-2">
        <Link href={`/painel/cmv?mes=${mesVizinho(competencia, -1)}`} className="rounded-lg px-2 py-1 text-neutral-500 hover:bg-neutral-100" aria-label="Mês anterior">
          ←
        </Link>
        <h1 className="text-xl font-bold capitalize">
          {MESES[m - 1]} {ano}
          {mesFechado && <span className="ml-2 rounded bg-neutral-200 px-2 py-0.5 align-middle text-xs font-medium normal-case">fechado</span>}
        </h1>
        {ehMesAtual ? (
          <span className="w-8" />
        ) : (
          <Link href={`/painel/cmv?mes=${mesVizinho(competencia, 1)}`} className="rounded-lg px-2 py-1 text-neutral-500 hover:bg-neutral-100" aria-label="Próximo mês">
            →
          </Link>
        )}
      </div>

      {nova && (
        <div role="status" className="rounded-2xl border border-green-200 bg-green-50 p-4">
          <p className="font-semibold text-green-900">
            Nota lançada: {formatarBRL(centavos(nova.valor))} · {nova.fornecedores?.nome}
          </p>
          {catNova && competenciaDe(nova.data_emissao) === competencia && catNova.semanaAtual && (
            <p className="mt-1 text-green-900">
              {catNova.nome}: disponível nesta semana <strong className="tabular-nums">{formatarBRL(catNova.disponivelAgora)}</strong>
            </p>
          )}
        </div>
      )}

      {provisorio && (
        <Link href="/painel/cmv/vendas" className="block rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
          <p className="font-semibold">⚠ Dados de venda incompletos: orçamento provisório</p>
          <p className="mt-0.5 text-sm">
            Sem venda registrada em {listarDias(r.diasSemVenda)}. Os valores abaixo podem mudar quando as vendas entrarem.
          </p>
        </Link>
      )}

      {principal && <CardPrincipal c={principal} provisorio={provisorio} />}

      <section className="grid gap-3 md:grid-cols-3">
        {outras.map((c) => (
          <CardCategoria key={c.categoriaId} c={c} />
        ))}
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        {/* Vendas */}
        <div className="rounded-2xl border border-neutral-200 bg-white p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold">Vendas</h2>
            <Link href="/painel/cmv/vendas" className="text-sm font-medium text-neutral-600 underline-offset-2 hover:underline">
              Ver / lançar
            </Link>
          </div>
          <p className="mt-3 text-sm text-neutral-500">Projeção conservadora do mês</p>
          <p className="text-3xl font-bold tabular-nums">{formatarBRL(p.projecao)}</p>
          <p className="text-sm text-neutral-500 tabular-nums">
            Meta {formatarBRL(mes.metaVenda)}
            {p.projecaoTendencia !== null && <> · tendência {formatarBRL(p.projecaoTendencia)}</>}
          </p>
          <div className="mt-3 space-y-1">
            <Barra valor={p.realizado} total={p.metaAcumulada || 1} cor={corVendas(p.realizado, p.metaAcumulada)} />
            <p className="text-sm tabular-nums">
              Realizado <strong>{formatarBRL(p.realizado)}</strong> × meta acumulada {formatarBRL(p.metaAcumulada)}
              {p.metaAcumulada > 0 && (
                <span className={COR_TEXTO_VENDAS[corVendas(p.realizado, p.metaAcumulada)]}> ({formatarPct(p.fatorRitmo - 1, 1).replace(/^(?!-)/, "+")})</span>
              )}
            </p>
            <p className="text-xs text-neutral-500">{p.hojeRef ? `Vendas até ${dataBR(p.hojeRef)}` : "Nenhuma venda registrada no mês"}</p>
            {mostrarParcial && (
              <p className="text-xs text-neutral-600 tabular-nums">
                <span className="mr-1 rounded bg-neutral-100 px-1.5 py-0.5 font-medium text-neutral-600">parcial</span>
                {textoDiaAtual(diaAtual)}
                <span className="text-neutral-500"> (fora da projeção até fechar o dia)</span>
              </p>
            )}
          </div>
          <div className="mt-3 space-y-2 border-t border-neutral-100 pt-2 text-xs text-neutral-500">
            <p>
              {caixa.ultimaOk ? <>Planilha sincronizada em {quando(caixa.ultimaOk)}.</> : <>Planilha ainda não sincronizada.</>}
              {caixa.ultimaSync?.status === "erro" && <span className="text-red-700"> Última tentativa falhou ({quando(caixa.ultimaSync.em)}).</span>}
              {painel.ultimaVendaManual && <> Último lançamento manual: {quando(painel.ultimaVendaManual)}.</>}
            </p>
            {ehMesAtual && !mesFechado && (
              <div className="flex flex-wrap items-center gap-2">
                <BotaoSincronizar />
                <SincronizacaoAutomatica />
              </div>
            )}
          </div>
        </div>

        {/* CMV */}
        <div className="rounded-2xl border border-neutral-200 bg-white p-4">
          <h2 className="font-semibold">CMV projetado de fechamento</h2>
          <div className="mt-3 flex items-end gap-3">
            <p className="text-3xl font-bold tabular-nums">{cp.pct !== null ? formatarPct(cp.pct) : "—"}</p>
            {cp.faixa && (
              <span className="mb-1 rounded-full px-2.5 py-0.5 text-sm font-semibold text-white" style={{ backgroundColor: cp.faixa.cor }}>
                {cp.faixa.faixa}
              </span>
            )}
          </div>
          <p className="text-sm text-neutral-500 tabular-nums">
            (compras {formatarBRL(cp.compras)} + planejado restante {formatarBRL(cp.planejadoRestante)}) ÷ projeção {formatarBRL(p.projecao)} · meta{" "}
            {formatarPct(meta, 0)}
          </p>
          <p className="mt-3 text-sm tabular-nums">
            {cp.podeComprar >= 0 ? (
              <>
                Para fechar em {formatarPct(meta, 0)}, ainda pode comprar até <strong>{formatarBRL(cp.podeComprar)}</strong> no mês
              </>
            ) : (
              <span className="text-red-700">
                As compras já passaram <strong>{formatarBRL(-cp.podeComprar)}</strong> do teto de {formatarPct(meta, 0)} do mês
              </span>
            )}
          </p>
          <p className="text-xs text-neutral-500 tabular-nums">
            Teto total ({formatarPct(meta, 0)} da projeção) {formatarBRL(r.tetoTotal)} · comprado {formatarBRL(r.compradoTotal)}
          </p>

          <div className="mt-4 border-t border-neutral-100 pt-3">
            <p className="text-sm text-neutral-500">{r.cmv.tipo === "real" ? "CMV real" : "CMV parcial"} (informativo)</p>
            <p className="text-xl font-semibold text-neutral-700 tabular-nums">
              {r.cmv.cmvPct !== null ? formatarPct(r.cmv.cmvPct) : "—"}
              <span className="ml-2 text-sm font-normal text-neutral-500">
                {r.cmv.compras === 0 ? "sem compras lançadas no mês" : `${formatarBRL(r.cmv.compras)} ÷ ${formatarBRL(r.cmv.vendaBase)}`}
              </span>
            </p>
            <p className="mt-1 text-xs text-neutral-500">Compras ÷ venda até ontem. Sobe após cada compra grande e se dilui até o fim do mês.</p>
          </div>
        </div>
      </section>

      {principal && (
        <TabelaCmvSemanas
          dados={r.cmvSemanas}
          categorias={r.categorias.map((c) => ({ categoriaId: c.categoriaId, nome: c.nome }))}
          principal={{ categoriaId: principal.categoriaId, nome: principal.nome }}
          metaCmvPct={meta}
        />
      )}

      {/* Tabela semanal */}
      {catTabela && (
        <section className="rounded-2xl border border-neutral-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Semanas · {catTabela.nome}</h2>
            <div className="flex flex-wrap gap-1">
              {r.categorias.map((c) => (
                <Link
                  key={c.categoriaId}
                  href={`/painel/cmv?${new URLSearchParams({ ...(sp.mes ? { mes: sp.mes } : {}), cat: c.categoriaId })}`}
                  scroll={false}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${c.categoriaId === catTabela.categoriaId ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-700"}`}
                >
                  {c.nome.split(" ")[0]}
                </Link>
              ))}
            </div>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[30rem] text-sm">
              <thead className="text-left text-neutral-500">
                <tr>
                  <th className="py-2 font-medium">Semana</th>
                  <th className="py-2 text-right font-medium">Planejado original</th>
                  <th className="py-2 text-right font-medium">Orçamento atual</th>
                  <th className="py-2 text-right font-medium">Comprado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {catTabela.semanas.map((s) => (
                  <tr key={s.numero} className={s.situacao === "atual" ? "font-semibold" : s.situacao === "encerrada" ? "text-neutral-500" : ""}>
                    <td className="py-2">
                      S{s.numero} <span className="font-normal text-neutral-500">· {rotuloSemana(s)}</span>
                      {s.situacao === "atual" && <span className="ml-1 rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] text-white">atual</span>}
                    </td>
                    <td className="py-2 text-right tabular-nums">{formatarBRL(s.planejadoOriginal)}</td>
                    <td
                      className={`py-2 text-right tabular-nums ${
                        s.situacao === "encerrada" ? "font-normal text-neutral-400" : s.orcamentoAtual < s.planejadoOriginal ? "text-red-700" : ""
                      }`}
                      title={s.situacao === "encerrada" ? "Semana encerrada: vale o que foi comprado; a sobra já foi redistribuída" : undefined}
                    >
                      {formatarBRL(s.orcamentoAtual)}
                    </td>
                    <td className={`py-2 text-right tabular-nums ${s.comprado > s.orcamento ? "text-red-700" : ""}`}>{formatarBRL(s.comprado)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-neutral-200">
                <tr className="font-semibold">
                  <td className="py-2">Mês</td>
                  <td className="py-2 text-right tabular-nums">{formatarBRL(catTabela.semanas.reduce((a, s) => a + s.planejadoOriginal, 0))}</td>
                  <td className="py-2 text-right tabular-nums">{formatarBRL(catTabela.alocadoMes)}</td>
                  <td className="py-2 text-right tabular-nums">{formatarBRL(catTabela.compradoMes)}</td>
                </tr>
                <tr className={catTabela.reserva < 0 ? "text-red-700" : "text-neutral-600"}>
                  <td className="py-2">{catTabela.reserva < 0 ? "Compras acima do teto" : "Reserva (não alocado pela trava de 125%)"}</td>
                  <td className="py-2 text-right">—</td>
                  <td className="py-2 text-right tabular-nums">{formatarBRL(catTabela.reserva)}</td>
                  <td className="py-2 text-right">—</td>
                </tr>
                <tr className="border-t border-neutral-200 font-semibold">
                  <td className="py-2">Teto do mês</td>
                  <td className="py-2 text-right tabular-nums">{formatarBRL(catTabela.teto)}</td>
                  <td className="py-2 text-right tabular-nums">{formatarBRL(catTabela.alocadoMes + catTabela.reserva)}</td>
                  <td className="py-2 text-right" />
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            Semanas encerradas valem pelo que foi comprado (a sobra já foi redistribuída). O saldo é redistribuído pelas semanas que faltam, com
            limite de 125% do planejado; o que a trava não deixa alocar fica na reserva. Estouros reduzem as semanas seguintes.
          </p>
        </section>
      )}

      {/* Alertas */}
      <section>
        <h2 className="mb-2 font-semibold">Alertas</h2>
        {alertas.length ? (
          <ul className="space-y-2">
            {alertas.map((a) => (
              <li key={a.id} className={`rounded-xl border px-4 py-3 ${ESTILO_ALERTA[a.nivel]}`}>
                {a.href ? (
                  <Link href={a.href} className="block">
                    <p className="font-medium">{a.titulo}</p>
                    {a.detalhe && <p className="text-sm opacity-90">{a.detalhe}</p>}
                  </Link>
                ) : (
                  <>
                    <p className="font-medium">{a.titulo}</p>
                    {a.detalhe && <p className="text-sm opacity-90">{a.detalhe}</p>}
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-neutral-200 bg-white px-4 py-3 text-neutral-500">Nenhum alerta.</p>
        )}
      </section>

      {ehMesAtual && !mesFechado && (
        <div className="fixed inset-x-0 bottom-0 z-20 flex justify-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {fruteiraQ.data && (
            <Link href={`/painel/cmv/notas/nova?fornecedor=${fruteiraQ.data.id}`} className="rounded-full border border-neutral-300 bg-white px-4 py-3 font-semibold shadow-lg">
              Fruteira de hoje
            </Link>
          )}
          <Link href="/painel/cmv/notas/nova" className="rounded-full bg-red-600 px-6 py-3 font-bold text-white shadow-lg">
            + Lançar nota
          </Link>
        </div>
      )}
    </main>
  );
}
