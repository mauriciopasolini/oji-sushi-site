import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  type ContextoCaixa,
  type Destaque,
  FILTROS_CONFERENCIA,
  destaquesDaNota,
  filtroValido,
  passaNoFiltro,
  progressoConferencia,
  proximaDepoisDeMarcar,
  vizinhas,
} from "@/lib/cmv/conferencia";
import { fimDoMes, listarCategorias, listarFornecedores } from "@/lib/cmv/dados";
import { competenciaDe, hojeSP, montar, partes, somarDias } from "@/lib/cmv/datas";
import { centavos, formatarBRL } from "@/lib/cmv/dinheiro";
import { DUPLICIDADE } from "@/lib/cmv/duplicidade";
import { getSessao } from "@/lib/cmv/sessao";
import { FORMAS_PAGAMENTO, type NotaRow, RE_UUID, TIPOS_NOTA } from "@/lib/cmv/tipos";
import { createClient } from "@/lib/supabase/server";
import { AcoesConferencia } from "./acoes-conferencia";
import { AjusteDocumento } from "./ajuste-documento";
import { VisorFoto } from "./visor-foto";

export const metadata: Metadata = { title: "Conferência" };

type Params = { mes?: string; filtro?: string; categoria?: string; fornecedor?: string; nota?: string };

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const dataBR = (d?: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");
const diaMes = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

const ESTILO_DESTAQUE: Record<Destaque["nivel"], string> = {
  erro: "border-red-300 bg-red-50 text-red-900",
  aviso: "border-amber-300 bg-amber-50 text-amber-950",
  info: "border-neutral-300 bg-neutral-50 text-neutral-800",
  ok: "border-green-200 bg-green-50 text-green-900",
};

export default async function ConferenciaPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sessao = await getSessao();
  if (sessao?.perfil?.papel !== "admin") redirect("/painel/cmv");

  const sp = await searchParams;
  const hoje = hojeSP();
  const competencia = /^\d{4}-\d{2}$/.test(sp.mes ?? "") ? `${sp.mes}-01` : competenciaDe(hoje);
  const ini = competencia;
  const fim = fimDoMes(competencia);
  const filtro = filtroValido(sp.filtro);
  const categoria = RE_UUID.test(sp.categoria ?? "") ? sp.categoria! : "";
  const fornecedor = RE_UUID.test(sp.fornecedor ?? "") ? sp.fornecedor! : "";

  const supabase = await createClient();
  const [notasQ, mesQ, categorias, fornecedores, catMercadoQ, fechQ, vizinhasQ] = await Promise.all([
    supabase
      .from("notas")
      .select("*, fornecedores(nome, revisado_em), categorias_cmv(nome)")
      .gte("data_emissao", ini)
      .lte("data_emissao", fim)
      .order("data_emissao")
      .order("criado_em")
      .limit(2000),
    supabase.from("meses").select("status").eq("competencia", ini).maybeSingle(),
    listarCategorias(supabase),
    listarFornecedores(supabase, { incluirInativos: true }),
    supabase.from("categorias_cmv").select("id").eq("slug", "mercado").maybeSingle(),
    supabase.from("fechamento_turno").select("data, despesa_mercado").gte("data", ini).lte("data", fim),
    // Notas ativas dos 15 dias em volta do mês, para a duplicidade na virada do mês.
    supabase
      .from("notas")
      .select("id, fornecedor_id, data_emissao, valor, tipo, status")
      .eq("status", "ativa")
      .or(`data_emissao.lt.${ini},data_emissao.gt.${fim}`)
      .gte("data_emissao", somarDias(ini, -DUPLICIDADE.janelaDias))
      .lte("data_emissao", somarDias(fim, DUPLICIDADE.janelaDias)),
  ]);
  if (notasQ.error) throw new Error(notasQ.error.message);

  type Linha = NotaRow & { fornecedores: { nome: string; revisado_em: string | null } | null; categorias_cmv: { nome: string } | null };
  const todas = (notasQ.data ?? []) as Linha[];
  const ativas = todas.filter((n) => n.status === "ativa");
  const progresso = progressoConferencia(todas);
  const mesFechado = mesQ.data?.status === "fechado";

  // Lista navegável: ativas do mês, no filtro.
  const lista = ativas.filter(
    (n) => passaNoFiltro(n.conferencia, filtro) && (!categoria || n.categoria_id === categoria) && (!fornecedor || n.fornecedor_id === fornecedor),
  );
  const ids = lista.map((n) => n.id);
  const pedida = RE_UUID.test(sp.nota ?? "") ? todas.find((n) => n.id === sp.nota) : undefined;
  const atual = pedida ?? lista[0];
  const viz = vizinhas(ids, atual?.id ?? null);
  const foraDoFiltro = Boolean(atual && viz.indice < 0);

  const href = (extra: Partial<Params>) => {
    const q = new URLSearchParams();
    const v = { mes: competencia.slice(0, 7), filtro, categoria, fornecedor, ...extra };
    for (const [k, x] of Object.entries(v)) if (x) q.set(k, x);
    return `/painel/cmv/conferencia?${q}`;
  };
  const notaHref = (id: string | null) => (id ? href({ nota: id }) : null);
  const depoisSai = atual ? proximaDepoisDeMarcar(ids, atual.id) : null;

  // Contexto de caixa e duplicidade.
  const despesaMercadoPorDia = new Map<string, number>();
  for (const f of fechQ.data ?? []) despesaMercadoPorDia.set(f.data, (despesaMercadoPorDia.get(f.data) ?? 0) + centavos(f.despesa_mercado));
  const notasMercadoPorDia = new Map<string, number>();
  const mercadoId = catMercadoQ.data?.id ?? null;
  for (const n of ativas) if (n.categoria_id === mercadoId) notasMercadoPorDia.set(n.data_emissao, (notasMercadoPorDia.get(n.data_emissao) ?? 0) + centavos(n.valor));
  const caixa: ContextoCaixa = { categoriaMercadoId: mercadoId, despesaMercadoPorDia, notasMercadoPorDia };
  const mercadoSemNota = [...despesaMercadoPorDia.entries()].filter(([d, v]) => v > 0 && !notasMercadoPorDia.has(d)).sort(([a], [b]) => a.localeCompare(b));

  const comparaveis = [
    ...ativas.map((n) => ({ id: n.id, fornecedorId: n.fornecedor_id, data: n.data_emissao, valor: centavos(n.valor), tipo: n.tipo, status: n.status })),
    ...((vizinhasQ.data ?? []) as { id: string; fornecedor_id: string; data_emissao: string; valor: number; tipo: NotaRow["tipo"]; status: "ativa" }[]).map((n) => ({
      id: n.id, fornecedorId: n.fornecedor_id, data: n.data_emissao, valor: centavos(n.valor), tipo: n.tipo, status: n.status,
    })),
  ];

  const destaques = atual
    ? destaquesDaNota(
        {
          id: atual.id, fornecedorId: atual.fornecedor_id, categoriaId: atual.categoria_id, data: atual.data_emissao, valor: centavos(atual.valor),
          tipo: atual.tipo, status: atual.status, formaPagamento: atual.forma_pagamento, categoriaForaDoPadrao: atual.categoria_fora_do_padrao,
          fornecedorNovo: atual.fornecedores?.revisado_em === null, observacao: atual.observacao, pendenciaJustificativa: atual.pendencia_justificativa,
        },
        { outras: comparaveis, caixa, nomeFornecedor: atual.fornecedores?.nome },
      )
    : [];

  const { data: assinada } = atual ? await supabase.storage.from("notas").createSignedUrl(atual.foto_path, 600) : { data: null };
  const ehPdf = atual?.foto_path.endsWith(".pdf");

  const { ano, mes } = partes(competenciaDe(hoje));
  const opcoesMes = Array.from({ length: 13 }, (_, i) => {
    const d = new Date(Date.UTC(ano, mes - 1 - i, 1));
    return { v: montar(d.getUTCFullYear(), d.getUTCMonth() + 1, 1).slice(0, 7), r: `${MESES[d.getUTCMonth()]}/${d.getUTCFullYear()}` };
  });
  const sel = "rounded-lg border border-neutral-300 bg-white px-2 py-2 text-sm";
  const revisadas = progresso.conferidas + progresso.divergentes;

  const linha = (r: string, v: React.ReactNode) => (
    <div className="flex justify-between gap-4 py-1.5">
      <dt className="text-neutral-500">{r}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );

  return (
    <main className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Conferência</h1>
          <p className="text-sm text-neutral-600 tabular-nums">
            <strong>
              {progresso.conferidas} de {progresso.total} conferidas
            </strong>
            {progresso.divergentes > 0 && <span className="text-red-700"> · {progresso.divergentes} divergente(s)</span>} · {progresso.pendentes} pendente(s)
          </p>
        </div>
        <form method="get" className="flex flex-wrap gap-2">
          <select name="mes" defaultValue={competencia.slice(0, 7)} className={sel} aria-label="Mês">
            {opcoesMes.map((m) => (
              <option key={m.v} value={m.v}>
                {m.r}
              </option>
            ))}
          </select>
          <select name="filtro" defaultValue={filtro} className={sel} aria-label="Situação">
            {FILTROS_CONFERENCIA.map((f) => (
              <option key={f.valor} value={f.valor}>
                {f.rotulo}
              </option>
            ))}
          </select>
          <select name="categoria" defaultValue={categoria} className={sel} aria-label="Categoria">
            <option value="">Todas as categorias</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
          <select name="fornecedor" defaultValue={fornecedor} className={sel} aria-label="Fornecedor">
            <option value="">Todos os fornecedores</option>
            {fornecedores.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
                {f.ativo ? "" : " (inativo)"}
              </option>
            ))}
          </select>
          <button className="rounded-lg bg-neutral-900 px-3 text-sm font-medium text-white">Filtrar</button>
        </form>
      </div>

      <div
        className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-200"
        role="progressbar"
        aria-label="Notas revisadas"
        aria-valuenow={revisadas}
        aria-valuemin={0}
        aria-valuemax={progresso.total}
      >
        <div className="flex h-full">
          <div className="h-full bg-green-500" style={{ width: `${progresso.total ? (progresso.conferidas / progresso.total) * 100 : 0}%` }} />
          <div className="h-full bg-red-500" style={{ width: `${progresso.total ? (progresso.divergentes / progresso.total) * 100 : 0}%` }} />
        </div>
      </div>

      {mercadoSemNota.length > 0 && (
        <details className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-amber-950">
          <summary className="cursor-pointer font-medium">
            {mercadoSemNota.length} dia(s) com despesa de Mercado no caixa e nenhuma nota de Mercado
          </summary>
          <ul className="mt-2 space-y-0.5 text-sm tabular-nums">
            {mercadoSemNota.map(([d, v]) => (
              <li key={d}>
                {diaMes(d)}: caixa {formatarBRL(v)} · possível cupom não lançado
              </li>
            ))}
          </ul>
        </details>
      )}

      {!atual ? (
        <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-12 text-center">
          <p className="text-lg font-medium">{progresso.total === 0 ? "Nenhuma nota lançada neste mês." : "Nenhuma nota neste filtro."}</p>
          {filtro === "pendentes" && progresso.total > 0 && progresso.pendentes === 0 && <p className="mt-1 text-green-700">Todas as notas do mês foram revisadas. ✓</p>}
          {filtro !== "todas" && progresso.total > 0 && (
            <Link href={href({ filtro: "todas" })} className="mt-3 inline-block text-sm underline">
              Ver todas
            </Link>
          )}
        </div>
      ) : (
        <>
          <nav className="flex items-center justify-between gap-2" aria-label="Navegação entre notas">
            {viz.anterior ? (
              <Link href={notaHref(viz.anterior)!} scroll={false} className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium">
                ← Anterior
              </Link>
            ) : (
              <span className="rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-400">← Anterior</span>
            )}
            <span className="text-sm text-neutral-600 tabular-nums">
              {foraDoFiltro ? "fora do filtro atual" : `${viz.indice + 1} de ${ids.length}`} · {FILTROS_CONFERENCIA.find((f) => f.valor === filtro)?.rotulo.toLowerCase()}
            </span>
            {viz.proxima ? (
              <Link href={notaHref(viz.proxima)!} scroll={false} className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium">
                Próxima →
              </Link>
            ) : (
              <span className="rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-400">Próxima →</span>
            )}
          </nav>

          <div className="grid gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="md:sticky md:top-20 md:self-start">
              {assinada?.signedUrl ? (
                ehPdf ? (
                  <div className="space-y-2">
                    <iframe src={assinada.signedUrl} title="PDF da nota" className="h-[60vh] w-full rounded-2xl border border-neutral-200 bg-white md:h-[calc(100vh-11rem)]" />
                    <a href={assinada.signedUrl} target="_blank" rel="noopener" className="text-sm underline">
                      Abrir PDF em outra aba
                    </a>
                  </div>
                ) : (
                  <VisorFoto src={assinada.signedUrl} alt={`Foto da nota de ${atual.fornecedores?.nome ?? ""}`} original={assinada.signedUrl} />
                )
              ) : (
                <p className="rounded-2xl border border-neutral-200 bg-white p-6 text-neutral-500">Foto indisponível.</p>
              )}
              <p className="mt-1 hidden text-xs text-neutral-500 md:block">Roda do mouse: zoom no ponto do cursor · arraste para mover · duplo clique aproxima/volta</p>
            </div>

            <div className="space-y-3">
              {destaques.length > 0 && (
                <ul className="space-y-2">
                  {destaques.map((d) => (
                    <li key={d.id} className={`rounded-xl border px-3 py-2 text-sm ${ESTILO_DESTAQUE[d.nivel]}`}>
                      <p className="font-semibold">{d.titulo}</p>
                      {d.detalhe && <p className="opacity-90">{d.detalhe}</p>}
                      {d.notaId && (
                        <Link href={notaHref(d.notaId) ?? `/painel/cmv/notas/${d.notaId}`} className="underline underline-offset-2">
                          Ver a outra nota
                        </Link>
                      )}
                      {d.id === "fornecedor-novo" && (
                        <Link href="/painel/cmv/fornecedores?filtro=novos" className="underline underline-offset-2">
                          Revisar em Fornecedores
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <div>
                <p className={`text-3xl font-bold tabular-nums ${atual.status === "cancelada" ? "text-neutral-400 line-through" : ""}`}>{formatarBRL(centavos(atual.valor))}</p>
                <p className="text-lg">{atual.fornecedores?.nome ?? "?"}</p>
              </div>
              <dl className="divide-y divide-neutral-100 rounded-2xl border border-neutral-200 bg-white px-4 text-sm">
                {linha(atual.tipo === "sem_nota" ? "Data de chegada" : "Data", dataBR(atual.data_emissao))}
                {linha("Categoria", atual.categorias_cmv?.nome)}
                {linha("Tipo", TIPOS_NOTA.find((t) => t.valor === atual.tipo)?.rotulo)}
                {linha("Número", atual.numero ?? "—")}
                {linha("Vencimento", dataBR(atual.vencimento))}
                {linha("Pagamento", FORMAS_PAGAMENTO.find((f) => f.valor === atual.forma_pagamento)?.rotulo)}
                {atual.descricao && linha("Descrição", atual.descricao)}
                {atual.observacao && linha("Observação", atual.observacao)}
              </dl>

              {atual.status === "ativa" && <AjusteDocumento notaId={atual.id} tipo={atual.tipo} forma={atual.forma_pagamento} bloqueado={mesFechado} />}

              {atual.status === "ativa" ? (
                <AcoesConferencia
                  notaId={atual.id}
                  conferencia={atual.conferencia}
                  observacao={atual.conferencia_obs}
                  filtro={filtro}
                  anteriorHref={notaHref(viz.anterior)}
                  proximaHref={notaHref(viz.proxima)}
                  depoisSaiHref={notaHref(depoisSai) ?? href({})}
                  bloqueado={mesFechado ? "O mês está fechado: a conferência não pode mais ser alterada. Reabra o mês para mudar." : null}
                />
              ) : (
                <p className="rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-700">Nota cancelada: {atual.motivo_cancelamento}</p>
              )}

              <Link href={`/painel/cmv/notas/${atual.id}`} className="inline-block text-sm text-neutral-600 underline underline-offset-2">
                Abrir a nota (editar, histórico)
              </Link>
            </div>
          </div>
        </>
      )}
    </main>
  );
}

