"use server";
import { revalidatePath } from "next/cache";
import { lerQuantidade, quantidadeParaDecimal, UNIDADES } from "@/lib/cmv/contagem";
import { hojeSP } from "@/lib/cmv/datas";
import { centavos, paraDecimal } from "@/lib/cmv/dinheiro";
import { getSessao } from "@/lib/cmv/sessao";
import { RE_UUID } from "@/lib/cmv/tipos";
import { createClient } from "@/lib/supabase/server";

export type Resultado<T = undefined> = { ok: true; dados: T } | { ok: false; erro: string };

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_COMP = /^\d{4}-\d{2}-01$/;

function mensagem(msg: string) {
  if (/row-level security|permission denied/i.test(msg)) return "Você não tem permissão para esta ação.";
  if (/itens_contagem_nome_normalizado_uk|itens_contagem_nome_key/.test(msg)) return "Já existe um item com esse nome.";
  if (/contagens_mes_id_tipo_key/.test(msg)) return "Já existe uma contagem de fechamento neste mês. Recarregue a página.";
  return msg; // triggers já respondem em português
}

export type LinhaEnviada = { itemId: string; quantidade: string; custo: string };

/**
 * Grava a contagem de fechamento do mês (cria se não existir). Itens sem quantidade
 * ficam fora (e são removidos se estavam gravados). Com `finalizar`, todos os itens
 * enviados precisam de quantidade, e quem tem quantidade > 0 precisa de custo.
 */
export async function salvarContagem(p: { competencia: string; data: string; linhas: LinhaEnviada[]; finalizar: boolean }): Promise<Resultado<{ id: string; salvoEm: string }>> {
  const sessao = await getSessao();
  if (!sessao?.perfil?.ativo) return { ok: false, erro: "Sessão expirada. Entre novamente." };
  if (!RE_COMP.test(p.competencia ?? "")) return { ok: false, erro: "Mês inválido." };
  if (!RE_DATA.test(p.data ?? "")) return { ok: false, erro: "Data da contagem inválida." };
  if (p.data > hojeSP()) return { ok: false, erro: "A data da contagem não pode ser no futuro." };
  if (!Array.isArray(p.linhas) || p.linhas.length > 2000) return { ok: false, erro: "Itens inválidos." };

  const gravar: { item_id: string; quantidade: string; custo_unitario: string }[] = [];
  const vazios: string[] = [];
  const semCusto: string[] = [];
  for (const l of p.linhas) {
    if (!RE_UUID.test(l.itemId ?? "")) return { ok: false, erro: "Item inválido." };
    let q: number | null;
    let c: number;
    try {
      q = lerQuantidade(l.quantidade);
    } catch {
      return { ok: false, erro: `Quantidade inválida: "${l.quantidade}". Use até 3 casas decimais.` };
    }
    try {
      c = centavos(l.custo);
    } catch {
      return { ok: false, erro: `Custo inválido: "${l.custo}".` };
    }
    if (c < 0 || c > 100_000_000) return { ok: false, erro: `Custo inválido: "${l.custo}".` };
    if (q === null) {
      vazios.push(l.itemId);
      continue;
    }
    if (q > 0 && c === 0) semCusto.push(l.itemId);
    gravar.push({ item_id: l.itemId, quantidade: quantidadeParaDecimal(q), custo_unitario: paraDecimal(c) });
  }
  if (p.finalizar && vazios.length) return { ok: false, erro: `${vazios.length} item(ns) sem quantidade. Preencha (0 se não houver) antes de finalizar.` };
  if (p.finalizar && semCusto.length) return { ok: false, erro: `${semCusto.length} item(ns) com quantidade e sem custo unitário.` };

  const supabase = await createClient();
  const { data: mes } = await supabase.from("meses").select("id, status").eq("competencia", p.competencia).maybeSingle();
  if (!mes) return { ok: false, erro: "Este mês ainda não existe no sistema." };
  if (mes.status === "fechado") return { ok: false, erro: "O mês está fechado: a contagem não pode mais ser alterada." };

  let { data: cont } = await supabase.from("contagens").select("id, status, data").eq("mes_id", mes.id).eq("tipo", "fechamento").maybeSingle();
  if (cont?.status === "finalizada") return { ok: false, erro: "A contagem já foi finalizada. Peça ao administrador para reabri-la." };
  if (!cont) {
    const ins = await supabase.from("contagens").insert({ mes_id: mes.id, data: p.data }).select("id, status, data").single();
    if (ins.error) return { ok: false, erro: mensagem(ins.error.message) };
    cont = ins.data;
  } else if (cont.data !== p.data) {
    const up = await supabase.from("contagens").update({ data: p.data }).eq("id", cont.id);
    if (up.error) return { ok: false, erro: mensagem(up.error.message) };
  }

  if (gravar.length) {
    const up = await supabase
      .from("contagem_itens")
      .upsert(gravar.map((g) => ({ ...g, contagem_id: cont!.id })), { onConflict: "contagem_id,item_id" });
    if (up.error) return { ok: false, erro: mensagem(up.error.message) };
  }
  // Itens apagados no formulário (quantidade em branco) saem da contagem.
  if (vazios.length) {
    const del = await supabase.from("contagem_itens").delete().eq("contagem_id", cont.id).in("item_id", vazios);
    if (del.error) return { ok: false, erro: mensagem(del.error.message) };
  }

  if (p.finalizar) {
    const fin = await supabase.from("contagens").update({ status: "finalizada" }).eq("id", cont.id).select("id");
    if (fin.error) return { ok: false, erro: mensagem(fin.error.message) };
    if (!fin.data?.length) return { ok: false, erro: "Não foi possível finalizar a contagem." };
  }

  revalidatePath("/painel/cmv", "layout");
  return { ok: true, dados: { id: cont.id, salvoEm: new Date().toISOString() } };
}

/** Admin: reabre a contagem finalizada (motivo obrigatório, auditado no banco). */
export async function reabrirContagem(id: string, motivo: string): Promise<Resultado> {
  const sessao = await getSessao();
  if (!sessao?.perfil?.ativo) return { ok: false, erro: "Sessão expirada. Entre novamente." };
  if (sessao.perfil.papel !== "admin") return { ok: false, erro: "Somente o administrador pode reabrir a contagem." };
  if (!RE_UUID.test(id)) return { ok: false, erro: "Contagem inválida." };
  if (!(motivo ?? "").trim()) return { ok: false, erro: "Informe o motivo para reabrir a contagem." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reabrir_contagem", { p_contagem_id: id, p_motivo: motivo.trim().slice(0, 500) });
  if (error) return { ok: false, erro: mensagem(error.message) };
  revalidatePath("/painel/cmv", "layout");
  return { ok: true, dados: undefined };
}

// ----------------------------------------------------------------------------- cadastro de itens (admin)

export type DadosItem = { nome: string; unidade: string; categoria_id: string; custo_ref: string; ordem: string };

export async function salvarItem(id: string | null, d: DadosItem): Promise<Resultado<{ id: string }>> {
  const sessao = await getSessao();
  if (!sessao?.perfil?.ativo) return { ok: false, erro: "Sessão expirada. Entre novamente." };
  if (sessao.perfil.papel !== "admin") return { ok: false, erro: "Somente o administrador cadastra itens de contagem." };
  const nome = (d.nome ?? "").replace(/\s+/g, " ").trim();
  if (nome.length < 2 || nome.length > 120) return { ok: false, erro: "Informe o nome do item (2 a 120 caracteres)." };
  if (!UNIDADES.some((u) => u.valor === d.unidade)) return { ok: false, erro: "Escolha a unidade." };
  if (!RE_UUID.test(d.categoria_id ?? "")) return { ok: false, erro: "Escolha a categoria." };
  let custo: number | null = null;
  if ((d.custo_ref ?? "").trim()) {
    try {
      custo = centavos(d.custo_ref);
    } catch {
      return { ok: false, erro: "Custo de referência inválido." };
    }
    if (custo < 0 || custo > 100_000_000) return { ok: false, erro: "Custo de referência inválido." };
  }
  const ordemTxt = (d.ordem ?? "").trim();
  if (ordemTxt && !/^\d{1,5}$/.test(ordemTxt)) return { ok: false, erro: "Ordem inválida: use um número inteiro." };
  const registro = { nome, unidade: d.unidade, categoria_id: d.categoria_id, custo_unitario_ref: custo === null ? null : paraDecimal(custo), ordem: ordemTxt ? Number(ordemTxt) : 0 };

  const supabase = await createClient();
  if (id) {
    if (!RE_UUID.test(id)) return { ok: false, erro: "Item inválido." };
    const { data, error } = await supabase.from("itens_contagem").update(registro).eq("id", id).select("id");
    if (error) return { ok: false, erro: mensagem(error.message) };
    if (!data?.length) return { ok: false, erro: "Item não encontrado." };
  } else {
    const { data, error } = await supabase.from("itens_contagem").insert(registro).select("id").single();
    if (error) return { ok: false, erro: mensagem(error.message) };
    id = data.id as string;
  }
  revalidatePath("/painel/cmv/contagem", "layout");
  return { ok: true, dados: { id } };
}

export async function definirItemAtivo(id: string, ativo: boolean): Promise<Resultado> {
  const sessao = await getSessao();
  if (sessao?.perfil?.papel !== "admin" || !sessao.perfil.ativo) return { ok: false, erro: "Somente o administrador altera itens de contagem." };
  if (!RE_UUID.test(id)) return { ok: false, erro: "Item inválido." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("itens_contagem").update({ ativo }).eq("id", id).select("id");
  if (error) return { ok: false, erro: mensagem(error.message) };
  if (!data?.length) return { ok: false, erro: "Item não encontrado." };
  revalidatePath("/painel/cmv/contagem", "layout");
  return { ok: true, dados: undefined };
}
