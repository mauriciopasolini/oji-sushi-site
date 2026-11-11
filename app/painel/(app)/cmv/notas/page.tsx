import type { Metadata } from "next";
import Link from "next/link";
import { fimDoMes, listarCategorias, listarFornecedores } from "@/lib/cmv/dados";
import { competenciaDe, hojeSP, montar, partes, semanasDoMes } from "@/lib/cmv/datas";
import { centavos, formatarBRL } from "@/lib/cmv/dinheiro";
import { type Conferencia, type NotaRow, ROTULO_CONFERENCIA, ehPendenteNF } from "@/lib/cmv/tipos";
import { getSessao } from "@/lib/cmv/sessao";
import { createClient } from "@/lib/supabase/server";
import { StatusConferencia } from "./status-conferencia";

export const metadata: Metadata = { title: "Notas" };

type Filtros = { mes?: string; categoria?: string; semana?: string; fornecedor?: string; conferencia?: string; status?: string };

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const dataBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export default async function NotasPage({ searchParams }: { searchParams: Promise<Filtros> }) {
  const f = await searchParams;
  const hoje = hojeSP();
  const supabase = await createClient();

  const competencia = /^\d{4}-\d{2}$/.test(f.mes ?? "") ? `${f.mes}-01` : competenciaDe(hoje);
  const semanas = semanasDoMes(competencia);
  const semana = semanas.find((s) => String(s.numero) === f.semana);
  const status = f.status === "cancelada" || f.status === "todas" || f.status === "aguardando" ? f.status : "ativa";
  // "Aguardando nota fiscal" mostra todas as pendentes, de qualquer mês.
  const aguardando = status === "aguardando";

  let q = supabase
    .from("notas")
    .select("*, fornecedores(nome, revisado_em), categorias_cmv(nome)")
    .order("data_emissao", { ascending: false })
    .order("criado_em", { ascending: false })
    .limit(500);
  if (aguardando) q = q.eq("tipo", "sem_nota").eq("status", "ativa");
  else q = q.gte("data_emissao", semana?.inicio ?? competencia).lte("data_emissao", semana?.fim ?? fimDoMes(competencia));
  if (f.categoria) q = q.eq("categoria_id", f.categoria);
  if (f.fornecedor) q = q.eq("fornecedor_id", f.fornecedor);
  if (f.conferencia && f.conferencia in ROTULO_CONFERENCIA) q = q.eq("conferencia", f.conferencia);
  if (status === "ativa" || status === "cancelada") q = q.eq("status", status);

  const [{ data: notasRaw, error }, categorias, fornecedores, { count: pendentesNF }, sessao] = await Promise.all([
    q,
    listarCategorias(supabase),
    listarFornecedores(supabase, { incluirInativos: true }),
    supabase.from("notas").select("id", { count: "exact", head: true }).eq("tipo", "sem_nota").eq("status", "ativa"),
    getSessao(),
  ]);
  const ehAdmin = sessao?.perfil?.papel === "admin";
  type Linha = NotaRow & { fornecedores: { nome: string; revisado_em: string | null } | null; categorias_cmv: { nome: string } | null };
  const notas = (notasRaw ?? []) as Linha[];

  // Miniaturas: URLs assinadas de curta duração (10 min).
  const imagens = notas.filter((n) => !n.foto_path.endsWith(".pdf")).map((n) => n.foto_path);
  const urls = new Map<string, string>();
  if (imagens.length) {
    const { data } = await supabase.storage.from("notas").createSignedUrls(imagens, 600);
    for (const s of data ?? []) if (s.signedUrl && s.path) urls.set(s.path, s.signedUrl);
  }

  const total = notas.filter((n) => n.status === "ativa").reduce((a, n) => a + centavos(n.valor), 0);

  const { ano, mes } = partes(competenciaDe(hoje));
  const opcoesMes = Array.from({ length: 13 }, (_, i) => {
    const d = new Date(Date.UTC(ano, mes - 1 - i, 1));
    const v = montar(d.getUTCFullYear(), d.getUTCMonth() + 1, 1).slice(0, 7);
    return { v, r: `${MESES[d.getUTCMonth()]}/${d.getUTCFullYear()}` };
  });

  const sel = "rounded-lg border border-neutral-300 bg-white px-2 py-2 text-sm";

  return (
    <main className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Notas</h1>
        <Link href="/painel/cmv/notas/nova" className="rounded-xl bg-red-600 px-4 py-2 font-semibold text-white">
          + Lançar nota
        </Link>
      </div>

      {(pendentesNF ?? 0) > 0 && !aguardando && (
        <Link href="/painel/cmv/notas?status=aguardando" className="block rounded-2xl border border-amber-400 bg-amber-50 px-4 py-3 text-amber-950">
          <strong>⏳ {pendentesNF} compra(s) aguardando nota fiscal.</strong> <span className="text-sm underline">Ver pendentes</span>
        </Link>
      )}

      <form className="grid grid-cols-2 gap-2 sm:grid-cols-6" method="get">
        <select name="mes" defaultValue={competencia.slice(0, 7)} className={sel} aria-label="Mês">
          {opcoesMes.map((m) => (
            <option key={m.v} value={m.v}>
              {m.r}
            </option>
          ))}
        </select>
        <select name="semana" defaultValue={f.semana ?? ""} className={sel} aria-label="Semana">
          <option value="">Todas as semanas</option>
          {semanas.map((s) => (
            <option key={s.numero} value={s.numero}>
              S{s.numero} · {dataBR(s.inicio)}–{dataBR(s.fim)}
            </option>
          ))}
        </select>
        <select name="categoria" defaultValue={f.categoria ?? ""} className={sel} aria-label="Categoria">
          <option value="">Todas as categorias</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
        <select name="fornecedor" defaultValue={f.fornecedor ?? ""} className={sel} aria-label="Fornecedor">
          <option value="">Todos os fornecedores</option>
          {fornecedores.map((x) => (
            <option key={x.id} value={x.id}>
              {x.nome}
            </option>
          ))}
        </select>
        <select name="conferencia" defaultValue={f.conferencia ?? ""} className={sel} aria-label="Conferência">
          <option value="">Qualquer conferência</option>
          {(Object.keys(ROTULO_CONFERENCIA) as Conferencia[]).map((c) => (
            <option key={c} value={c}>
              {ROTULO_CONFERENCIA[c]}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <select name="status" defaultValue={status} className={`${sel} flex-1`} aria-label="Situação">
            <option value="ativa">Ativas</option>
            <option value="aguardando">Aguardando nota fiscal</option>
            <option value="cancelada">Canceladas</option>
            <option value="todas">Todas</option>
          </select>
          <button className="rounded-lg bg-neutral-900 px-3 text-sm font-medium text-white">Filtrar</button>
        </div>
      </form>

      {error && <p className="text-red-700">Erro ao carregar: {error.message}</p>}

      <p className="text-sm text-neutral-600">
        {aguardando && "Aguardando nota fiscal (todos os meses) · "}
        {notas.length} nota(s) · total ativo <strong className="tabular-nums">{formatarBRL(total)}</strong>
      </p>

      <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
        {notas.map((n) => (
          <li key={n.id} className={`flex items-center gap-2 pr-3 ${ehPendenteNF(n) ? "border-l-4 border-amber-500 bg-amber-50" : ""}`}>
            <Link
              href={`/painel/cmv/notas/${n.id}`}
              className={`flex min-w-0 flex-1 items-center gap-3 py-3 pl-3 ${ehPendenteNF(n) ? "hover:bg-amber-100" : "hover:bg-neutral-50"}`}
            >
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100">
                {urls.get(n.foto_path) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={urls.get(n.foto_path)} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-xs text-neutral-500">PDF</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {n.fornecedores?.nome ?? "?"}
                  {n.fornecedores && n.fornecedores.revisado_em === null && (
                    <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-900">novo</span>
                  )}
                </p>
                <p className="truncate text-sm text-neutral-500">
                  {dataBR(n.data_emissao)} · {n.categorias_cmv?.nome}
                  {n.categoria_fora_do_padrao && <span className="text-amber-700"> (categoria trocada)</span>}
                  {n.numero ? ` · nº ${n.numero}` : ""}
                  {ehPendenteNF(n) && n.observacao ? ` · ${n.observacao}` : ""}
                </p>
              </div>
              <div className="text-right">
                <p className={`font-semibold tabular-nums ${n.status === "cancelada" ? "text-neutral-400 line-through" : ""}`}>
                  {formatarBRL(centavos(n.valor))}
                </p>
                {ehPendenteNF(n) && <p className="text-xs font-semibold text-amber-800">⏳ Aguardando NF</p>}
                {!ehPendenteNF(n) && !(ehAdmin && n.status === "ativa") && (
                <p
                  className={`text-xs ${
                    n.status === "cancelada"
                      ? "text-neutral-500"
                      : n.conferencia === "conferida"
                        ? "text-green-700"
                        : n.conferencia === "divergente"
                          ? "text-red-700"
                          : "text-neutral-500"
                  }`}
                >
                  {n.status === "cancelada" ? "Cancelada" : ROTULO_CONFERENCIA[n.conferencia]}
                </p>
                )}
              </div>
            </Link>
            {ehAdmin && n.status === "ativa" && <StatusConferencia id={n.id} conferencia={n.conferencia} observacao={n.conferencia_obs} compacto />}
          </li>
        ))}
        {!notas.length && <li className="px-4 py-8 text-center text-neutral-500">Nenhuma nota com esses filtros.</li>}
      </ul>
    </main>
  );
}
