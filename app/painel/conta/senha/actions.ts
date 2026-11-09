"use server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { SENHA_MINIMO } from "@/lib/cmv/senha";
import { getSessao } from "@/lib/cmv/sessao";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export type EstadoSenha = { erro?: string; ok?: boolean };

export async function trocarSenha(_prev: EstadoSenha, formData: FormData): Promise<EstadoSenha> {
  const atual = String(formData.get("atual") ?? "");
  const nova = String(formData.get("nova") ?? "");
  const confirmacao = String(formData.get("confirmacao") ?? "");

  const sessao = await getSessao();
  if (!sessao?.user.email) return { erro: "Sessão expirada. Entre novamente." };

  if (!atual || !nova) return { erro: "Preencha todos os campos." };
  if (nova.length < SENHA_MINIMO) return { erro: `A nova senha precisa ter pelo menos ${SENHA_MINIMO} caracteres.` };
  if (nova !== confirmacao) return { erro: "A confirmação não confere com a nova senha." };
  if (nova === atual) return { erro: "A nova senha precisa ser diferente da atual." };

  // Confere a senha atual num cliente isolado (não mexe nos cookies da sessão).
  const verificador = createSupabaseClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: errAtual } = await verificador.auth.signInWithPassword({ email: sessao.user.email, password: atual });
  if (errAtual) return { erro: "Senha atual incorreta." };
  await verificador.auth.signOut({ scope: "local" });

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: nova });
  if (error) {
    if (/weak|pwned|leaked/i.test(error.message)) return { erro: "Essa senha é fraca ou já apareceu em vazamentos. Escolha outra." };
    return { erro: `Não foi possível trocar a senha: ${error.message}` };
  }

  const { error: errPerfil } = await supabase.rpc("confirmar_troca_senha");
  if (errPerfil) return { erro: `Senha trocada, mas houve um erro ao atualizar o perfil: ${errPerfil.message}` };

  return { ok: true };
}
