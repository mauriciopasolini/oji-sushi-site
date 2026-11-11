"use server";
import { revalidatePath } from "next/cache";
import { getSessao } from "@/lib/cmv/sessao";
import { type Conferencia, FORMAS_PAGAMENTO, type FormaPagamento, RE_UUID, ROTULO_CONFERENCIA, TIPOS_NOTA, type TipoNota } from "@/lib/cmv/tipos";
import { createClient } from "@/lib/supabase/server";

export type Resultado = { ok: true } | { ok: false; erro: string };

/** Admin: marca a conferência de uma nota (divergente exige observação). */
export async function marcarConferencia(id: string, conferencia: Conferencia, observacao?: string): Promise<Resultado> {
  const sessao = await getSessao();
  if (!sessao?.perfil?.ativo) return { ok: false, erro: "Sessão expirada. Entre novamente." };
  if (sessao.perfil.papel !== "admin") return { ok: false, erro: "Somente o administrador confere notas." };
  if (!RE_UUID.test(id ?? "")) return { ok: false, erro: "Nota inválida." };
  if (!(conferencia in ROTULO_CONFERENCIA)) return { ok: false, erro: "Situação inválida." };
  const obs = (observacao ?? "").trim().slice(0, 500) || null;
  if (conferencia === "divergente" && !obs) return { ok: false, erro: "Divergente: escreva o que está errado." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notas")
    .update({ conferencia, conferencia_obs: conferencia === "pendente" ? null : obs })
    .eq("id", id)
    .eq("status", "ativa")
    .select("id");
  if (error) {
    if (/notas_divergente_com_obs/.test(error.message)) return { ok: false, erro: "Divergente: escreva o que está errado." };
    if (/row-level security|permission denied/i.test(error.message)) return { ok: false, erro: "Você não tem permissão para esta ação." };
    return { ok: false, erro: error.message };
  }
  if (!data?.length) return { ok: false, erro: "Nota não encontrada ou cancelada." };
  revalidatePath("/painel/cmv", "layout");
  return { ok: true };
}

/**
 * Admin: corrige tipo de documento e forma de pagamento na conferência, sem a edição
 * completa. Auditado com o motivo "ajuste na conferência"; a conferência não volta a pendente.
 */
export async function ajustarDocumentoPagamento(id: string, tipo: TipoNota, forma: FormaPagamento): Promise<Resultado> {
  const sessao = await getSessao();
  if (!sessao?.perfil?.ativo) return { ok: false, erro: "Sessão expirada. Entre novamente." };
  if (sessao.perfil.papel !== "admin") return { ok: false, erro: "Somente o administrador ajusta notas na conferência." };
  if (!RE_UUID.test(id ?? "")) return { ok: false, erro: "Nota inválida." };
  if (!TIPOS_NOTA.some((t) => t.valor === tipo)) return { ok: false, erro: "Tipo de documento inválido." };
  if (!FORMAS_PAGAMENTO.some((f) => f.valor === forma)) return { ok: false, erro: "Forma de pagamento inválida." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("ajustar_nota_conferencia", { p_nota_id: id, p_tipo: tipo, p_forma_pagamento: forma });
  if (error) {
    if (/row-level security|permission denied/i.test(error.message)) return { ok: false, erro: "Você não tem permissão para esta ação." };
    return { ok: false, erro: error.message };
  }
  revalidatePath("/painel/cmv", "layout");
  return { ok: true };
}
