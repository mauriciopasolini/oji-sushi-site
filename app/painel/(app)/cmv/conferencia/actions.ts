"use server";
import { revalidatePath } from "next/cache";
import { getSessao } from "@/lib/cmv/sessao";
import { type Conferencia, RE_UUID, ROTULO_CONFERENCIA } from "@/lib/cmv/tipos";
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
