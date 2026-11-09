import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessao } from "@/lib/cmv/sessao";
import { sair } from "../../login/actions";
import { SENHA_MINIMO } from "@/lib/cmv/senha";
import { FormSenha } from "./form-senha";

export const metadata: Metadata = { title: "Trocar senha" };

// Fica fora do grupo (app) de propósito: o layout de (app) redireciona para cá
// quando a troca é obrigatória, e esta página não pode redirecionar de volta.
export default async function TrocarSenhaPage() {
  const sessao = await getSessao();
  if (!sessao) redirect("/painel/login?next=%2Fpainel%2Fconta%2Fsenha");
  if (!sessao.perfil?.ativo) redirect("/painel/cmv"); // mostra a tela de acesso bloqueado

  const obrigatoria = sessao.perfil.deve_trocar_senha;

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-12">
      <div className="mb-8">
        <p className="text-sm text-neutral-500">{sessao.perfil.nome}</p>
        <h1 className="mt-1 text-2xl font-bold">Trocar senha</h1>
        {obrigatoria && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Primeiro acesso: troque a senha inicial antes de usar o painel.
          </p>
        )}
      </div>
      <FormSenha minimo={SENHA_MINIMO} />
      <div className="mt-6 flex justify-between text-sm">
        {obrigatoria ? (
          <span />
        ) : (
          <Link href="/painel/cmv" className="text-neutral-600 underline-offset-2 hover:underline">
            ← Voltar
          </Link>
        )}
        <form action={sair}>
          <button className="text-neutral-600 underline-offset-2 hover:underline">Sair</button>
        </form>
      </div>
    </main>
  );
}
