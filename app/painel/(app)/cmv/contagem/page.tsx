import type { Metadata } from "next";
import Link from "next/link";
import { custoSugerido, formatarQuantidade, milesimos } from "@/lib/cmv/contagem";
import { fimDoMes, listarCategorias } from "@/lib/cmv/dados";
import { competenciaDe, hojeSP, montar, partes } from "@/lib/cmv/datas";
import { centavos, formatarBRL } from "@/lib/cmv/dinheiro";
import { getSessao } from "@/lib/cmv/sessao";
import { createClient } from "@/lib/supabase/server";
import { FormContagem, type ItemForm } from "./form-contagem";

export const metadata: Metadata = { title: "Contagem de estoque" };

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const quando = (ts: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(ts));

function mesVizinho(competencia: string, delta: number) {
  const { ano, mes } = partes(competencia);
  const d = new Date(Date.UTC(ano, mes - 1 + delta, 1));
  return montar(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

/** Valor em centavos a partir do custo gravado, para exibir sem casas desnecessárias no campo. */
const custoParaCampo = (c: number | null) => (c === null || c === 0 ? "" : (c / 100).toFixed(2).replace(".", ","));

type ContagemRow = { id: string; status: "rascunho" | "finalizada"; data: string; finalizada_em: string | null; finalizada_por: string | null; realizada_por: string; atualizado_em: string };

export default async function ContagemPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const sp = await searchParams;
  const hoje = hojeSP();
  const competencia = /^\d{4}-\d{2}$/.test(sp.mes ?? "") ? `${sp.mes}-01` : competenciaDe(hoje);
  const anterior = mesVizinho(competencia, -1);
  const sessao = await getSessao();
  const ehAdmin = sessao?.perfil?.papel === "admin";
  const supabase = await createClient();

  const [mesesQ, itensQ, categorias, contagensQ, historicoQ, perfisQ] = await Promise.all([
    supabase.from("meses").select("id, competencia, status").in("competencia", [anterior, competencia]),
    supabase.from("itens_contagem").select("id, nome, unidade, categoria_id, custo_unitario_ref, ordem, ativo").order("ordem").order("nome"),
    listarCategorias(supabase),
    supabase
      .from("contagens")
      .select("id, status, data, finalizada_em, finalizada_por, realizada_por, atualizado_em, mes_id, contagem_itens(item_id, quantidade, custo_unitario, valor)")
      .eq("tipo", "fechamento"),
    // Custos usados em contagens finalizadas (para pré-preencher com o último).
    supabase.from("contagem_itens").select("item_id, custo_unitario, contagens!inner(data, status)").eq("contagens.status", "finalizada").limit(5000),
    supabase.from("perfis").select("id, nome"),
  ]);
  if (itensQ.error) throw new Error(itensQ.error.message);

  const mes = (mesesQ.data ?? []).find((m) => m.competencia === competencia) ?? null;
  const mesAnt = (mesesQ.data ?? []).find((m) => m.competencia === anterior) ?? null;
  type ContagemComItens = ContagemRow & { mes_id: string; contagem_itens: { item_id: string; quantidade: number; custo_unitario: number; valor: number }[] };
  const contagens = (contagensQ.data ?? []) as ContagemComItens[];
  const contagem = mes ? (contagens.find((c) => c.mes_id === mes.id) ?? null) : null;
  const contagemAnt = mesAnt ? (contagens.find((c) => c.mes_id === mesAnt.id && c.status === "finalizada") ?? null) : null;
  const totalDe = (c: ContagemComItens | null) => (c ? c.contagem_itens.reduce((a, i) => a + centavos(i.valor), 0) : null);
  const estoqueInicial = totalDe(contagemAnt);

  const historico = ((historicoQ.data ?? []) as unknown as { item_id: string; custo_unitario: number; contagens: { data: string } }[]).map((h) => ({
    itemId: h.item_id,
    custo: centavos(h.custo_unitario),
    data: h.contagens.data,
  }));
  const nomeCat = new Map(categorias.map((c) => [c.id, c.nome]));
  const ordemCat = new Map(categorias.map((c) => [c.id, c.ordem]));
  const naContagem = new Map((contagem?.contagem_itens ?? []).map((i) => [i.item_id, i]));

  const itens: ItemForm[] = (itensQ.data ?? [])
    .filter((i) => i.ativo || naContagem.has(i.id))
    .sort((a, b) => (ordemCat.get(a.categoria_id) ?? 0) - (ordemCat.get(b.categoria_id) ?? 0) || a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR"))
    .map((i) => {
      const gravado = naContagem.get(i.id);
      const sugerido = custoSugerido(i.id, historico, i.custo_unitario_ref === null ? null : centavos(i.custo_unitario_ref));
      return {
        id: i.id,
        nome: i.nome,
        unidade: i.unidade,
        categoriaId: i.categoria_id,
        categoriaNome: nomeCat.get(i.categoria_id) ?? "?",
        quantidade: gravado ? formatarQuantidade(milesimos(gravado.quantidade)) : "",
        custo: gravado ? custoParaCampo(centavos(gravado.custo_unitario)) || custoParaCampo(sugerido) : custoParaCampo(sugerido),
        inativo: !i.ativo,
      };
    });

  const nomePerfil = new Map((perfisQ.data ?? []).map((p) => [p.id, p.nome]));
  const { ano, mes: m } = partes(competencia);
  const fim = fimDoMes(competencia);
  const dataPadrao = contagem?.data ?? (hoje < fim ? hoje : fim);
  const ehMesAtualOuAnterior = competencia === competenciaDe(hoje) || competencia === mesVizinho(competenciaDe(hoje), -1);
  const contagemAnteriorPendente =
    competencia === competenciaDe(hoje) && mesAnt && mesAnt.status === "aberto" && !contagens.some((c) => c.mes_id === mesAnt.id && c.status === "finalizada");

  return (
    <main className="space-y-4 pb-40">
      <div className="flex items-center justify-between gap-2">
        <Link href={`/painel/cmv/contagem?mes=${anterior.slice(0, 7)}`} className="rounded-lg px-2 py-1 text-neutral-500 hover:bg-neutral-100" aria-label="Mês anterior">
          ←
        </Link>
        <div className="text-center">
          <h1 className="text-xl font-bold">Contagem de estoque</h1>
          <p className="text-sm text-neutral-600 capitalize">
            Fechamento de {MESES[m - 1]} {ano}
          </p>
        </div>
        {competencia < competenciaDe(hoje) ? (
          <Link href={`/painel/cmv/contagem?mes=${mesVizinho(competencia, 1).slice(0, 7)}`} className="rounded-lg px-2 py-1 text-neutral-500 hover:bg-neutral-100" aria-label="Próximo mês">
            →
          </Link>
        ) : (
          <span className="w-8" />
        )}
      </div>

      {ehAdmin && (
        <div className="text-right">
          <Link href="/painel/cmv/contagem/itens" className="text-sm font-medium text-neutral-700 underline underline-offset-2">
            Cadastro de itens
          </Link>
        </div>
      )}

      {contagemAnteriorPendente && (
        <Link href={`/painel/cmv/contagem?mes=${anterior.slice(0, 7)}`} className="block rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950">
          A contagem de fechamento de <strong>{MESES[partes(anterior).mes - 1]}</strong> ainda não foi finalizada. <span className="underline">Abrir</span>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2">
          <p className="text-neutral-500">Estoque inicial</p>
          <p className="font-semibold tabular-nums">{estoqueInicial !== null ? formatarBRL(estoqueInicial) : "—"}</p>
          <p className="text-xs text-neutral-500">{contagemAnt ? `contagem de ${contagemAnt.data.slice(8, 10)}/${contagemAnt.data.slice(5, 7)}` : "sem contagem do mês anterior"}</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2">
          <p className="text-neutral-500">Esta contagem</p>
          <p className="font-semibold">
            {!contagem ? "não iniciada" : contagem.status === "finalizada" ? <span className="text-green-700">finalizada</span> : <span className="text-amber-700">rascunho</span>}
          </p>
          <p className="text-xs text-neutral-500">
            {contagem?.status === "finalizada" && contagem.finalizada_em
              ? `${quando(contagem.finalizada_em)} por ${nomePerfil.get(contagem.finalizada_por ?? "") ?? "?"}`
              : contagem
                ? `iniciada por ${nomePerfil.get(contagem.realizada_por) ?? "?"}`
                : "vira o estoque inicial do mês seguinte"}
          </p>
        </div>
      </div>

      {!mes ? (
        <p className="rounded-2xl border border-neutral-200 bg-white px-4 py-8 text-center text-neutral-500">Este mês ainda não existe no sistema.</p>
      ) : !itens.length ? (
        <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-8 text-center">
          <p className="font-medium">Nenhum item de contagem cadastrado.</p>
          {ehAdmin ? (
            <Link href="/painel/cmv/contagem/itens" className="mt-2 inline-block rounded-xl bg-neutral-900 px-4 py-2 font-semibold text-white">
              Cadastrar itens
            </Link>
          ) : (
            <p className="mt-1 text-sm text-neutral-600">Peça ao administrador para cadastrar os itens.</p>
          )}
        </div>
      ) : (
        <FormContagem
          key={`${competencia}-${contagem?.status ?? "nova"}`}
          competencia={competencia}
          contagemId={contagem?.id ?? null}
          finalizada={contagem?.status === "finalizada"}
          bloqueio={mes.status === "fechado" ? "O mês está fechado: a contagem não pode mais ser alterada." : !ehMesAtualOuAnterior && !contagem ? "Contagens só podem ser iniciadas para o mês atual ou o anterior." : null}
          dataInicial={dataPadrao}
          hoje={hoje}
          itens={itens}
          categorias={[...new Set(itens.map((i) => i.categoriaId))].map((id) => ({ id, nome: nomeCat.get(id) ?? "?" }))}
          ehAdmin={ehAdmin}
          salvoEm={contagem?.atualizado_em ?? null}
        />
      )}
    </main>
  );
}
