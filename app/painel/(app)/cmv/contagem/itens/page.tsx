import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { listarCategorias } from "@/lib/cmv/dados";
import { getSessao } from "@/lib/cmv/sessao";
import { createClient } from "@/lib/supabase/server";
import { EditorItens, type ItemCadastro } from "./editor-itens";

export const metadata: Metadata = { title: "Itens de contagem" };

export default async function ItensContagemPage() {
  const sessao = await getSessao();
  if (sessao?.perfil?.papel !== "admin") redirect("/painel/cmv/contagem");
  const supabase = await createClient();
  const [itensQ, categorias] = await Promise.all([
    supabase.from("itens_contagem").select("id, nome, unidade, categoria_id, custo_unitario_ref, ordem, ativo").order("ordem").order("nome"),
    listarCategorias(supabase),
  ]);
  if (itensQ.error) throw new Error(itensQ.error.message);

  return (
    <main className="space-y-4">
      <Link href="/painel/cmv/contagem" className="text-sm text-neutral-600 underline-offset-2 hover:underline">
        ← Contagem de estoque
      </Link>
      <h1 className="text-2xl font-bold">Itens de contagem</h1>
      <p className="text-sm text-neutral-600">
        Os itens ativos aparecem na contagem, agrupados por categoria e na ordem definida aqui. O custo de referência só é usado enquanto o item não
        tiver custo em nenhuma contagem finalizada.
      </p>
      <EditorItens itens={(itensQ.data ?? []) as ItemCadastro[]} categorias={categorias.filter((c) => c.ativa).map((c) => ({ id: c.id, nome: c.nome }))} />
    </main>
  );
}
