import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { fimDoMes, listarCategorias } from "@/lib/cmv/dados";
import { competenciaDe, hojeSP, montar, partes } from "@/lib/cmv/datas";
import { getSessao } from "@/lib/cmv/sessao";
import { createClient } from "@/lib/supabase/server";
import { type FornecedorLinha, LinhaFornecedor, NovoFornecedor } from "./editor-fornecedor";

export const metadata: Metadata = { title: "Fornecedores" };

const FILTROS = [
  { valor: "ativos", rotulo: "Ativos" },
  { valor: "novos", rotulo: "Novos" },
  { valor: "inativos", rotulo: "Inativos" },
  { valor: "todos", rotulo: "Todos" },
] as const;
type Filtro = (typeof FILTROS)[number]["valor"];
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export default async function FornecedoresPage({ searchParams }: { searchParams: Promise<{ filtro?: string; mes?: string }> }) {
  const sessao = await getSessao();
  if (sessao?.perfil?.papel !== "admin") redirect("/painel/cmv");

  const sp = await searchParams;
  const filtro: Filtro = FILTROS.some((f) => f.valor === sp.filtro) ? (sp.filtro as Filtro) : "ativos";
  const hoje = hojeSP();
  const competencia = /^\d{4}-\d{2}$/.test(sp.mes ?? "") ? `${sp.mes}-01` : competenciaDe(hoje);

  const supabase = await createClient();
  const [fornQ, categorias, notasMesQ, notasTodasQ, perfisQ] = await Promise.all([
    supabase
      .from("fornecedores")
      .select("id, nome, cnpj, categoria_padrao_id, prazo_vencimento_dias, tipo_padrao, forma_pagamento_padrao, ativo, revisado_em, criado_por, criado_em, mesclado_em_id")
      .order("nome"),
    listarCategorias(supabase),
    supabase.from("notas").select("fornecedor_id").eq("status", "ativa").gte("data_emissao", competencia).lte("data_emissao", fimDoMes(competencia)).limit(5000),
    supabase.from("notas").select("fornecedor_id").limit(20000),
    supabase.from("perfis").select("id, nome"),
  ]);
  if (fornQ.error) throw new Error(fornQ.error.message);

  const contar = (linhas: { fornecedor_id: string }[] | null) => {
    const m = new Map<string, number>();
    for (const l of linhas ?? []) m.set(l.fornecedor_id, (m.get(l.fornecedor_id) ?? 0) + 1);
    return m;
  };
  const noMes = contar(notasMesQ.data);
  const total = contar(notasTodasQ.data);
  const nomePerfil = new Map((perfisQ.data ?? []).map((p) => [p.id, p.nome]));
  const nomeCat = new Map(categorias.map((c) => [c.id, c.nome]));
  const todos = (fornQ.data ?? []) as (Omit<FornecedorLinha, "notasMes" | "notasTotal" | "criadoPorNome" | "categoriaNome" | "mescladoEmNome"> & { criado_por: string | null })[];
  const nomeForn = new Map(todos.map((f) => [f.id, f.nome]));

  const linhas: FornecedorLinha[] = todos
    .filter((f) => (filtro === "ativos" ? f.ativo : filtro === "novos" ? f.revisado_em === null : filtro === "inativos" ? !f.ativo : true))
    .map((f) => ({
      ...f,
      categoriaNome: nomeCat.get(f.categoria_padrao_id) ?? "?",
      notasMes: noMes.get(f.id) ?? 0,
      notasTotal: total.get(f.id) ?? 0,
      criadoPorNome: f.criado_por ? (nomePerfil.get(f.criado_por) ?? null) : null,
      mescladoEmNome: f.mesclado_em_id ? (nomeForn.get(f.mesclado_em_id) ?? null) : null,
    }));
  // Novos primeiro.
  linhas.sort((a, b) => Number(a.revisado_em !== null) - Number(b.revisado_em !== null) || a.nome.localeCompare(b.nome, "pt-BR"));

  const ativosParaMescla = todos.filter((f) => f.ativo).map((f) => ({ id: f.id, nome: f.nome }));
  const qtdNovos = todos.filter((f) => f.revisado_em === null).length;
  const { ano, mes } = partes(competencia);

  const hrefFiltro = (v: Filtro) => `/painel/cmv/fornecedores?${new URLSearchParams({ filtro: v, ...(sp.mes ? { mes: sp.mes } : {}) })}`;
  const { ano: aH, mes: mH } = partes(competenciaDe(hoje));
  const opcoesMes = Array.from({ length: 13 }, (_, i) => {
    const d = new Date(Date.UTC(aH, mH - 1 - i, 1));
    return { v: montar(d.getUTCFullYear(), d.getUTCMonth() + 1, 1).slice(0, 7), r: `${MESES[d.getUTCMonth()]}/${d.getUTCFullYear()}` };
  });

  return (
    <main className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Fornecedores</h1>
        <NovoFornecedor categorias={categorias.filter((c) => c.ativa).map((c) => ({ id: c.id, nome: c.nome }))} />
      </div>

      {qtdNovos > 0 && filtro !== "novos" && (
        <Link href={hrefFiltro("novos")} className="block rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950">
          <strong>{qtdNovos} fornecedor(es) novo(s)</strong> cadastrado(s) pelo gestor. <span className="text-sm underline">Revisar</span>
        </Link>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {FILTROS.map((f) => (
            <Link
              key={f.valor}
              href={hrefFiltro(f.valor)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${f.valor === filtro ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-700"}`}
            >
              {f.rotulo}
              {f.valor === "novos" && qtdNovos > 0 ? ` (${qtdNovos})` : ""}
            </Link>
          ))}
        </div>
        <form method="get" className="flex items-center gap-2 text-sm">
          <input type="hidden" name="filtro" value={filtro} />
          <label htmlFor="mes" className="text-neutral-600">
            Notas no mês
          </label>
          <select id="mes" name="mes" defaultValue={competencia.slice(0, 7)} className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5">
            {opcoesMes.map((m) => (
              <option key={m.v} value={m.v}>
                {m.r}
              </option>
            ))}
          </select>
          <button className="rounded-lg bg-neutral-900 px-3 py-1.5 font-medium text-white">Ver</button>
        </form>
      </div>

      <ul className="divide-y divide-neutral-100 rounded-2xl border border-neutral-200 bg-white">
        {linhas.map((f) => (
          <LinhaFornecedor
            key={f.id}
            f={f}
            categorias={categorias.filter((c) => c.ativa || c.id === f.categoria_padrao_id).map((c) => ({ id: c.id, nome: c.nome }))}
            outros={ativosParaMescla.filter((o) => o.id !== f.id)}
            rotuloMes={`${MESES[mes - 1]}/${ano}`}
            mes={competencia.slice(0, 7)}
          />
        ))}
        {!linhas.length && <li className="px-4 py-8 text-center text-neutral-500">Nenhum fornecedor neste filtro.</li>}
      </ul>
      <p className="text-xs text-neutral-500">
        Mesclar: as notas de meses abertos passam para o fornecedor que fica (a conferência é mantida); notas de meses fechados continuam no fornecedor
        antigo, que é desativado e passa a apontar para o que fica. Tudo fica na auditoria.
      </p>
    </main>
  );
}
