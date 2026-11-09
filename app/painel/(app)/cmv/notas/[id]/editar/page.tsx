import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { hojeSP } from "@/lib/cmv/datas";
import { type NotaRow, RE_UUID } from "@/lib/cmv/tipos";
import { createClient } from "@/lib/supabase/server";
import { FormNota } from "../../form-nota";
import { carregarOpcoesNota } from "../../opcoes";

export const metadata: Metadata = { title: "Editar nota" };

export default async function EditarNotaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!RE_UUID.test(id)) notFound();

  const supabase = await createClient();
  const { data } = await supabase.from("notas").select("*, meses(status)").eq("id", id).maybeSingle();
  if (!data) notFound();
  const nota = data as NotaRow & { meses: { status: string } | null };
  if (nota.status === "cancelada" || nota.meses?.status === "fechado") redirect(`/painel/cmv/notas/${id}`);

  const hoje = hojeSP();
  const [opcoes, { data: assinada }] = await Promise.all([
    carregarOpcoesNota(supabase, hoje, nota.fornecedor_id),
    nota.foto_path.endsWith(".pdf") ? Promise.resolve({ data: null }) : supabase.storage.from("notas").createSignedUrl(nota.foto_path, 600),
  ]);

  return (
    <main className="mx-auto max-w-xl">
      <Link href={`/painel/cmv/notas/${id}`} className="text-sm text-neutral-600 underline-offset-2 hover:underline">
        ← Voltar
      </Link>
      <h1 className="mt-2 mb-4 text-2xl font-bold">Editar nota</h1>
      <FormNota
        modo="editar"
        hoje={hoje}
        {...opcoes}
        inicial={{
          id: nota.id,
          dataEmissao: nota.data_emissao,
          fornecedorId: nota.fornecedor_id,
          categoriaId: nota.categoria_id,
          valor: nota.valor,
          fotoPath: nota.foto_path,
          fotoUrl: assinada?.signedUrl ?? null,
          tipo: nota.tipo,
          numero: nota.numero ?? "",
          vencimento: nota.vencimento ?? "",
          formaPagamento: nota.forma_pagamento,
          descricao: nota.descricao ?? "",
          observacao: nota.observacao ?? "",
        }}
      />
    </main>
  );
}
