import type { Metadata } from "next";
import Link from "next/link";
import { carregarPainel } from "@/lib/cmv/dados";
import { competenciaDe, hojeSP, rotuloSemana } from "@/lib/cmv/datas";
import { centavos, formatarBRL } from "@/lib/cmv/dinheiro";
import { RE_UUID } from "@/lib/cmv/tipos";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "CMV" };

// Versão provisória (Etapa 3): mostra o "disponível" por categoria, já calculado
// pelo motor, e confirma a nota recém-lançada. O painel completo vem na Etapa 4.
export default async function CmvPage({ searchParams }: { searchParams: Promise<{ nota?: string }> }) {
  const { nota: notaId } = await searchParams;
  const hoje = hojeSP();
  const supabase = await createClient();

  const [{ resultado }, notaQ, fruteiraQ] = await Promise.all([
    carregarPainel(supabase, competenciaDe(hoje), hoje),
    notaId && RE_UUID.test(notaId)
      ? supabase.from("notas").select("valor, data_emissao, categoria_id, fornecedores(nome)").eq("id", notaId).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("fornecedores").select("id").ilike("nome", "fruteira").eq("ativo", true).maybeSingle(),
  ]);

  const nova = notaQ.data as { valor: string; data_emissao: string; categoria_id: string; fornecedores: { nome: string } | null } | null;
  const catNova = nova ? resultado.categorias.find((c) => c.categoriaId === nova.categoria_id) : undefined;
  const novaNoMes = nova && competenciaDe(nova.data_emissao) === competenciaDe(hoje);

  return (
    <main className="space-y-5 pb-24">
      {nova && (
        <div role="status" className="rounded-2xl border border-green-200 bg-green-50 p-4">
          <p className="font-semibold text-green-900">
            Nota lançada: {formatarBRL(centavos(nova.valor))} · {nova.fornecedores?.nome}
          </p>
          {catNova && novaNoMes && (
            <p className="mt-1 text-green-900">
              {catNova.nome}: disponível nesta semana <strong className="tabular-nums">{formatarBRL(catNova.disponivelAgora)}</strong>
            </p>
          )}
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2">
        {resultado.categorias.map((c) => {
          const semana = c.semanaAtual ? c.semanas[c.semanaAtual - 1] : null;
          const negativo = c.disponivelAgora < 0;
          return (
            <div key={c.categoriaId} className="rounded-2xl border border-neutral-200 bg-white p-4">
              <p className="text-sm text-neutral-500">
                {c.nome}
                {semana && ` · S${semana.numero} · ${rotuloSemana(semana)}`}
              </p>
              <p className={`mt-1 text-3xl font-bold tabular-nums ${negativo ? "text-red-700" : ""}`}>{formatarBRL(c.disponivelAgora)}</p>
              <p className="text-sm text-neutral-500">disponível nesta semana</p>
              <p className="mt-2 text-xs text-neutral-500 tabular-nums">
                Mês: teto {formatarBRL(c.teto)} · comprado {formatarBRL(c.compradoMes)} · saldo {formatarBRL(c.saldo)}
              </p>
            </div>
          );
        })}
      </section>

      <p className="text-xs text-neutral-500">
        Projeção de venda usada: {formatarBRL(resultado.projecao.projecao)} (meta do mês enquanto não houver vendas lançadas). Painel completo na
        próxima etapa.
      </p>

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
    </main>
  );
}
