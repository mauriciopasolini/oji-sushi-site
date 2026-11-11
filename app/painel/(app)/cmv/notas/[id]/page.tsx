import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { centavos, formatarBRL } from "@/lib/cmv/dinheiro";
import { getSessao } from "@/lib/cmv/sessao";
import { FORMAS_PAGAMENTO, type NotaRow, RE_UUID, ROTULO_CONFERENCIA, TIPOS_NOTA, ehPendenteNF } from "@/lib/cmv/tipos";
import { createClient } from "@/lib/supabase/server";
import { CancelarNota } from "./cancelar-nota";
import { StatusConferencia } from "../status-conferencia";
import { JustificarPendencia } from "./justificar-pendencia";

export const metadata: Metadata = { title: "Nota" };

const dataBR = (d?: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");
const quando = (ts: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(ts));

const ROTULO_ACAO: Record<string, string> = { insert: "Lançada", update: "Editada", cancel: "Cancelada", reopen: "Reaberta", close: "Fechada" };
const CAMPOS: Record<string, string> = {
  valor: "valor", data_emissao: "data", fornecedor_id: "fornecedor", categoria_id: "categoria", numero: "número",
  vencimento: "vencimento", forma_pagamento: "pagamento", descricao: "descrição", observacao: "observação",
  foto_path: "foto", tipo: "tipo", conferencia: "conferência", conferencia_obs: "obs. conferência", status: "situação",
  pendencia_justificativa: "justificativa (sem nota)",
};

export default async function NotaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ editada?: string }> }) {
  const { id } = await params;
  const { editada } = await searchParams;
  if (!RE_UUID.test(id)) notFound();

  const supabase = await createClient();
  const { data } = await supabase
    .from("notas")
    .select("*, fornecedores(nome, revisado_em, categoria_padrao_id), categorias_cmv(nome), meses(status)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const nota = data as NotaRow & {
    fornecedores: { nome: string; revisado_em: string | null } | null;
    categorias_cmv: { nome: string } | null;
    meses: { status: string } | null;
  };

  const [{ data: assinada }, { data: historico }, { data: perfis }, sessao] = await Promise.all([
    supabase.storage.from("notas").createSignedUrl(nota.foto_path, 600),
    supabase.from("auditoria").select("id, acao, antes, depois, motivo, usuario_id, em").eq("tabela", "notas").eq("registro_id", id).order("em", { ascending: false }),
    supabase.from("perfis").select("id, nome"),
    getSessao(),
  ]);
  const ehAdmin = sessao?.perfil?.papel === "admin";
  const pendenteNF = ehPendenteNF(nota);

  // Fotos substituídas (a antiga fica no bucket e na auditoria): mais recente primeiro.
  const fotosAnteriores = (historico ?? [])
    .filter((h) => h.acao === "update" && h.antes?.foto_path && h.antes.foto_path !== h.depois?.foto_path)
    .map((h) => ({ path: h.antes.foto_path as string, ate: h.em as string, tipo: h.antes.tipo as string }));
  const urlsAnteriores = new Map<string, string>();
  if (fotosAnteriores.length) {
    const { data: us } = await supabase.storage.from("notas").createSignedUrls(fotosAnteriores.map((f) => f.path), 600);
    for (const u of us ?? []) if (u.signedUrl && u.path) urlsAnteriores.set(u.path, u.signedUrl);
  }
  const nomeUsuario = new Map((perfis ?? []).map((p) => [p.id, p.nome]));
  const ehPdf = nota.foto_path.endsWith(".pdf");
  const mesFechado = nota.meses?.status === "fechado";
  const editavel = nota.status === "ativa" && !mesFechado;

  const linha = (r: string, v: React.ReactNode) => (
    <div className="flex justify-between gap-4 py-2">
      <dt className="text-neutral-500">{r}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );

  return (
    <main className="mx-auto max-w-3xl space-y-5">
      <Link href="/painel/cmv/notas" className="text-sm text-neutral-600 underline-offset-2 hover:underline">
        ← Notas
      </Link>

      {editada && <p className="rounded-lg bg-green-50 px-3 py-2 text-green-800">Alterações salvas e registradas na auditoria.</p>}
      {nota.status === "cancelada" && (
        <p className="rounded-lg bg-neutral-100 px-3 py-2 text-neutral-700">
          <strong>Nota cancelada.</strong> Motivo: {nota.motivo_cancelamento}
        </p>
      )}
      {mesFechado && <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">O mês desta nota está fechado: ela não pode ser alterada.</p>}
      {pendenteNF && (
        <section className="space-y-3 rounded-2xl border border-amber-400 bg-amber-50 p-4 text-amber-950">
          <div>
            <p className="font-semibold">⏳ Pendente de nota fiscal</p>
            <p className="mt-0.5 text-sm">
              A mercadoria chegou sem nota. A compra já conta no orçamento pela data de chegada. Quando a nota fiscal chegar, lance-a nesta mesma entrada (a
              foto atual fica no histórico).
            </p>
          </div>
          {editavel && (
            <Link href={`/painel/cmv/notas/${id}/editar?nf=1`} className="inline-block rounded-xl bg-amber-600 px-4 py-2.5 font-semibold text-white">
              A nota fiscal chegou
            </Link>
          )}
          {nota.pendencia_justificativa && !ehAdmin && (
            <p className="text-sm">
              <strong>Justificativa para o fechamento:</strong> {nota.pendencia_justificativa}
            </p>
          )}
          {ehAdmin && !mesFechado && <JustificarPendencia id={id} atual={nota.pendencia_justificativa} />}
        </section>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <div>
          {assinada?.signedUrl ? (
            ehPdf ? (
              <a href={assinada.signedUrl} target="_blank" rel="noopener" className="flex h-48 items-center justify-center rounded-2xl border border-neutral-200 bg-white font-medium underline">
                Abrir PDF da nota
              </a>
            ) : (
              <a href={assinada.signedUrl} target="_blank" rel="noopener" title="Abrir em tamanho real">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={assinada.signedUrl} alt="Foto da nota" className="w-full rounded-2xl border border-neutral-200 bg-white object-contain" />
              </a>
            )
          ) : (
            <p className="rounded-2xl border border-neutral-200 bg-white p-6 text-neutral-500">Foto indisponível.</p>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <p className="text-3xl font-bold tabular-nums">{formatarBRL(centavos(nota.valor))}</p>
            <p className="text-lg">
              {nota.fornecedores?.nome}
              {nota.fornecedores?.revisado_em === null && (
                <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">fornecedor novo</span>
              )}
            </p>
          </div>
          <dl className="divide-y divide-neutral-100 rounded-2xl border border-neutral-200 bg-white px-4 text-sm">
            {linha(nota.tipo === "sem_nota" ? "Data de chegada" : "Data", dataBR(nota.data_emissao))}
            {linha(
              "Categoria",
              <>
                {nota.categorias_cmv?.nome}
                {nota.categoria_fora_do_padrao && <span className="block text-xs font-normal text-amber-700">diferente da padrão do fornecedor</span>}
              </>,
            )}
            {linha(
              "Tipo",
              <span className={pendenteNF ? "rounded bg-amber-100 px-1.5 py-0.5 text-amber-900" : ""}>{TIPOS_NOTA.find((t) => t.valor === nota.tipo)?.rotulo}</span>,
            )}
            {linha("Número", nota.numero ?? "—")}
            {linha("Vencimento", dataBR(nota.vencimento))}
            {linha("Pagamento", FORMAS_PAGAMENTO.find((f) => f.valor === nota.forma_pagamento)?.rotulo)}
            {nota.descricao && linha("Descrição", nota.descricao)}
            {nota.observacao && linha("Observação", nota.observacao)}
            {linha(
              "Conferência",
              ehAdmin && nota.status === "ativa" && !mesFechado ? (
                <span className="inline-flex flex-col items-end gap-0.5">
                  <StatusConferencia id={id} conferencia={nota.conferencia} observacao={nota.conferencia_obs} />
                  {nota.conferencia_obs && <span className="text-xs font-normal text-neutral-600">{nota.conferencia_obs}</span>}
                </span>
              ) : (
                ROTULO_CONFERENCIA[nota.conferencia] + (nota.conferencia_obs ? ` · ${nota.conferencia_obs}` : "")
              ),
            )}
          </dl>
          {editavel && (
            <div className="flex flex-wrap gap-2">
              <Link href={`/painel/cmv/notas/${id}/editar`} className="rounded-xl bg-neutral-900 px-4 py-2.5 font-semibold text-white">
                Editar
              </Link>
              <CancelarNota id={id} />
            </div>
          )}
        </div>
      </div>

      {fotosAnteriores.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Fotos anteriores ({fotosAnteriores.length})</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {fotosAnteriores.map((f) => {
              const u = urlsAnteriores.get(f.path);
              return (
                <li key={f.path} className="rounded-xl border border-neutral-200 bg-white p-2 text-xs text-neutral-600">
                  {u ? (
                    <a href={u} target="_blank" rel="noopener" className="block">
                      {f.path.endsWith(".pdf") ? (
                        <span className="flex h-24 items-center justify-center font-medium underline">PDF</span>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={u} alt="Foto anterior" loading="lazy" className="h-24 w-full rounded object-cover" />
                      )}
                    </a>
                  ) : (
                    <span className="flex h-24 items-center justify-center">indisponível</span>
                  )}
                  <span className="mt-1 block">
                    {f.tipo === "sem_nota" ? "Sem nota · " : ""}substituída em {quando(f.ate)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 font-semibold">Histórico</h2>
        <ol className="space-y-2">
          {(historico ?? []).map((h) => {
            const mudou =
              h.acao === "update" && h.antes && h.depois
                ? Object.keys(CAMPOS).filter((k) => JSON.stringify(h.antes[k]) !== JSON.stringify(h.depois[k])).map((k) => CAMPOS[k])
                : [];
            return (
              <li key={h.id} className="rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm">
                <span className="font-medium">{ROTULO_ACAO[h.acao] ?? h.acao}</span> por {nomeUsuario.get(h.usuario_id) ?? "sistema"} · {quando(h.em)}
                {mudou.length > 0 && <span className="text-neutral-600"> · alterou {mudou.join(", ")}</span>}
                {h.acao === "update" && h.antes?.valor !== h.depois?.valor && (
                  <span className="text-neutral-600">
                    {" "}
                    ({formatarBRL(centavos(h.antes.valor))} → {formatarBRL(centavos(h.depois.valor))})
                  </span>
                )}
                {h.motivo && <p className="text-neutral-600">Motivo: {h.motivo}</p>}
              </li>
            );
          })}
        </ol>
      </section>
    </main>
  );
}
