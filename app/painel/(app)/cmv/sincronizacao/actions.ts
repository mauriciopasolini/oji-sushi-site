"use server";
import { revalidatePath } from "next/cache";
import { competenciaDe, hojeSP } from "@/lib/cmv/datas";
import { paraDecimal } from "@/lib/cmv/dinheiro";
import { idDaPlanilha } from "@/lib/cmv/planilha/parser";
import { CAMPOS_PLANILHA } from "@/lib/cmv/planilha/planejar";
import { type ResumoSincronizacao, precisaSincronizar, sincronizarHoje } from "@/lib/cmv/planilha/sincronizar";
import { getSessao } from "@/lib/cmv/sessao";
import { RE_UUID } from "@/lib/cmv/tipos";
import { createClient } from "@/lib/supabase/server";

type Retorno<T = undefined> = { ok: true; dados: T } | { ok: false; erro: string };

/** Botão "Sincronizar agora" (qualquer membro ativo). */
export async function sincronizarAgora(): Promise<Retorno<ResumoSincronizacao[]>> {
  const sessao = await getSessao();
  if (!sessao?.perfil?.ativo) return { ok: false, erro: "Sessão expirada. Entre novamente." };
  try {
    const r = await sincronizarHoje({ hoje: hojeSP(), gatilho: "manual", usuarioId: sessao.user.id });
    revalidatePath("/painel/cmv", "layout");
    return { ok: true, dados: r };
  } catch (e) {
    return { ok: false, erro: (e as Error).message };
  }
}

/**
 * Chamada em segundo plano ao abrir o painel: sincroniza se a última sincronização
 * do mês tiver mais de 30 minutos, for de um dia anterior (virou a meia-noite: o dia
 * que estava parcial passa a contar) ou não existir.
 */
export async function sincronizarSeNecessario(): Promise<{ executou: boolean }> {
  const sessao = await getSessao();
  if (!sessao?.perfil?.ativo) return { executou: false };
  const hoje = hojeSP();
  const supabase = await createClient();
  const { data: ultima } = await supabase
    .from("sincronizacoes")
    .select("iniciado_em, status")
    .eq("competencia", competenciaDe(hoje))
    .in("status", ["ok", "executando", "erro"])
    .order("iniciado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!precisaSincronizar(ultima?.iniciado_em ?? null, Date.now())) return { executou: false };
  try {
    await sincronizarHoje({ hoje, gatilho: "automatica", usuarioId: sessao.user.id });
    revalidatePath("/painel/cmv", "layout");
    return { executou: true };
  } catch {
    return { executou: false };
  }
}

/** Admin decide um conflito entre venda manual e planilha. */
export async function resolverConflito(id: string, resolucao: "manter_manual" | "usar_planilha"): Promise<Retorno> {
  const sessao = await getSessao();
  if (sessao?.perfil?.papel !== "admin") return { ok: false, erro: "Somente o administrador resolve conflitos." };
  if (!RE_UUID.test(id) || !["manter_manual", "usar_planilha"].includes(resolucao)) return { ok: false, erro: "Pedido inválido." };

  const supabase = await createClient();
  const { data: c } = await supabase.from("conflitos_venda").select("*").eq("id", id).is("resolucao", null).maybeSingle();
  if (!c) return { ok: false, erro: "Conflito não encontrado ou já resolvido." };

  if (resolucao === "usar_planilha") {
    const v = c.valores_planilha as { campos: Record<string, number>; qtdPedidos: number | null };
    const { error } = await supabase
      .from("vendas_turno")
      .update({
        ...Object.fromEntries(CAMPOS_PLANILHA.map((k) => [k, paraDecimal(v.campos[k] ?? 0)])),
        qtd_pedidos: v.qtdPedidos,
        fonte: "planilha",
        sincronizado_em: new Date().toISOString(),
      })
      .eq("data", c.data)
      .eq("turno", c.turno)
      .eq("origem", c.origem);
    if (error) return { ok: false, erro: error.message };
  }
  const { error } = await supabase.from("conflitos_venda").update({ resolucao }).eq("id", id);
  if (error) return { ok: false, erro: error.message };
  revalidatePath("/painel/cmv", "layout");
  return { ok: true, dados: undefined };
}

/** Admin configura o link da planilha do mês. */
export async function salvarPlanilhaDoMes(competencia: string, url: string): Promise<Retorno> {
  const sessao = await getSessao();
  if (sessao?.perfil?.papel !== "admin") return { ok: false, erro: "Somente o administrador configura a planilha." };
  if (!/^\d{4}-\d{2}-01$/.test(competencia)) return { ok: false, erro: "Mês inválido." };
  const limpo = url.trim();
  if (!idDaPlanilha(limpo)) return { ok: false, erro: "Link inválido: cole o endereço da planilha do Google Sheets." };

  const supabase = await createClient();
  const { data: mes } = await supabase.from("meses").select("id").eq("competencia", competencia).maybeSingle();
  const r = mes
    ? await supabase.from("meses").update({ planilha_url: limpo }).eq("id", mes.id)
    : await supabase.from("meses").insert({ competencia, planilha_url: limpo });
  if (r.error) return { ok: false, erro: r.error.message };
  revalidatePath("/painel/cmv", "layout");
  return { ok: true, dados: undefined };
}
