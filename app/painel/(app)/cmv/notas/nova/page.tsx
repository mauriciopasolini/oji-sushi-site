import type { Metadata } from "next";
import Link from "next/link";
import { hojeSP } from "@/lib/cmv/datas";
import { RE_UUID } from "@/lib/cmv/tipos";
import { createClient } from "@/lib/supabase/server";
import { FormNota } from "../form-nota";
import { carregarOpcoesNota } from "../opcoes";

export const metadata: Metadata = { title: "Lançar nota" };

export default async function NovaNotaPage({ searchParams }: { searchParams: Promise<{ fornecedor?: string }> }) {
  const { fornecedor } = await searchParams;
  const hoje = hojeSP();
  const supabase = await createClient();
  const opcoes = await carregarOpcoesNota(supabase, hoje);
  const fornecedorInicialId = fornecedor && RE_UUID.test(fornecedor) && opcoes.fornecedores.some((f) => f.id === fornecedor) ? fornecedor : undefined;
  const fruteira = opcoes.fornecedores.find((f) => f.nome.toLowerCase() === "fruteira");

  return (
    <main className="mx-auto max-w-xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Lançar nota</h1>
        {fruteira && !fornecedorInicialId && (
          <Link href={`/painel/cmv/notas/nova?fornecedor=${fruteira.id}`} className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium">
            Fruteira de hoje
          </Link>
        )}
      </div>
      {/* key força um formulário novo ao trocar o atalho */}
      <FormNota key={fornecedorInicialId ?? "livre"} modo="criar" hoje={hoje} fornecedorInicialId={fornecedorInicialId} {...opcoes} />
    </main>
  );
}
