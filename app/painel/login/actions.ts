"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type EstadoLogin = { erro?: string; email?: string };

function destinoSeguro(next: FormDataEntryValue | null) {
  const s = typeof next === "string" ? next : "";
  // Só aceita caminhos internos do painel (evita open redirect).
  const ok = s.startsWith("/painel/") && !s.startsWith("/painel/login") && !s.includes("//") && !s.includes("\\");
  return ok ? s : "/painel/cmv";
}

export async function entrar(_prev: EstadoLogin, formData: FormData): Promise<EstadoLogin> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const senha = String(formData.get("senha") ?? "");
  if (!email || !senha) return { erro: "Informe e-mail e senha.", email };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
  if (error || !data.user) return { erro: "E-mail ou senha incorretos.", email };

  const { data: perfil } = await supabase.from("perfis").select("ativo").eq("id", data.user.id).maybeSingle();
  if (!perfil?.ativo) {
    await supabase.auth.signOut();
    return { erro: "Seu acesso ao painel não está liberado. Fale com o administrador.", email };
  }

  redirect(destinoSeguro(formData.get("next")));
}

export async function sair() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/painel/login");
}
