import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type Papel = "admin" | "gestor";
export type Perfil = { id: string; nome: string; papel: Papel; ativo: boolean; deve_trocar_senha: boolean };

/**
 * Usuário autenticado + perfil do módulo, validado no servidor do Supabase Auth.
 * Memoizado por requisição. Retorna null se não houver sessão.
 */
export const getSessao = cache(async () => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data: perfil } = await supabase
    .from("perfis")
    .select("id, nome, papel, ativo, deve_trocar_senha")
    .eq("id", auth.user.id)
    .maybeSingle<Perfil>();

  return { user: auth.user, perfil: perfil ?? null };
});
