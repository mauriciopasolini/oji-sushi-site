import type { Metadata } from "next";
import { getSessao } from "@/lib/cmv/sessao";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "CMV" };

// Placeholder da Etapa 1: confirma login, papel e leitura via RLS. O painel real vem na Etapa 4.
export default async function CmvPage() {
  const sessao = await getSessao();
  const supabase = await createClient();
  const { data: categorias, error } = await supabase.from("categorias_cmv").select("nome, pct_meta").order("ordem");

  return (
    <main className="space-y-6">
      <h1 className="text-2xl font-bold">Olá, {sessao?.perfil?.nome}</h1>
      <p className="text-neutral-600">
        Você entrou como <strong>{sessao?.perfil?.papel}</strong>. O painel de CMV será construído nas próximas etapas.
      </p>
      <section className="rounded-2xl border border-neutral-200 bg-white p-4">
        <h2 className="mb-2 font-semibold">Teste de leitura (RLS): categorias</h2>
        {error ? (
          <p className="text-red-700">Erro: {error.message}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {categorias?.map((c) => (
              <li key={c.nome} className="flex justify-between">
                <span>{c.nome}</span>
                <span className="tabular-nums">{(Number(c.pct_meta) * 100).toFixed(2).replace(".", ",")}%</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
