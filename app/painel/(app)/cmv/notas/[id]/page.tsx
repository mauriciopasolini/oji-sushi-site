import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { centavos, formatarBRL } from "@/lib/cmv/dinheiro";
import { FORMAS_PAGAMENTO, type NotaRow, RE_UUID, ROTULO_CONFERENCIA, TIPOS_NOTA } from "@/lib/cmv/tipos";
import { createClient } from "@/lib/supabase/server";
import { CancelarNota } from "./cancelar-nota";

export const metadata: Metadata = { title: "Nota" };

const dataBR = (d?: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");
const quando = (ts: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(ts));

const ROTULO_ACAO: Record<string, string> = { insert: "Lançada", update: "Editada", cancel: "Cancelada", reopen: "Reaberta", close: "Fechada" };
const CAMPOS: Record<string, string> = {
  valor: "valor", data_emissao: "data", fornecedor_id: "fornecedor", categoria_id: "categoria", numero: "número",
  vencimento: "vencimento", forma_pagamento: "pagamento", descricao: "descrição", observacao: "observação",
  foto_path: "foto", tipo: "tipo", conferencia: "conferência", conferencia_obs: "obs. conferência", status: "situação",
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

  const [{ data: assinada }, { data: historico }, { data: perfis }] = await Promise.all([
    supabase.storage.from("notas").createSignedUrl(nota.foto_path, 600),
    supabase.from("auditoria").select("id, acao, antes, depois, motivo, usuario_id, em").eq("tabela", "notas").eq("registro_id", id).order("em", { ascending: false }),
    supabase.from("perfis").select("id, nome"),
  ]);
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
            {linha("Data", dataBR(nota.data_emissao))}
            {linha(
              "Categoria",
              <>
                {nota.categorias_cmv?.nome}
                {nota.categoria_fora_do_padrao && <span className="block text-xs font-normal text-amber-700">diferente da padrão do fornecedor</span>}
              </>,
            )}
            {linha("Tipo", TIPOS_NOTA.find((t) => t.valor === nota.tipo)?.rotulo)}
            {linha("Número", nota.numero ?? "—")}
            {linha("Vencimento", dataBR(nota.vencimento))}
            {linha("Pagamento", FORMAS_PAGAMENTO.find((f) => f.valor === nota.forma_pagamento)?.rotulo)}
            {nota.descricao && linha("Descrição", nota.descricao)}
            {nota.observacao && linha("Observação", nota.observacao)}
            {linha("Conferência", ROTULO_CONFERENCIA[nota.conferencia] + (nota.conferencia_obs ? ` · ${nota.conferencia_obs}` : ""))}
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
