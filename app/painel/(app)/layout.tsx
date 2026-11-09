import { redirect } from "next/navigation";
import { getSessao } from "@/lib/cmv/sessao";
import { sair } from "../login/actions";

// Toda rota dentro de (app) exige usuário logado E perfil ativo.
export default async function AreaProtegidaLayout({ children }: { children: React.ReactNode }) {
  const sessao = await getSessao();
  if (!sessao) redirect("/painel/login");

  const { perfil } = sessao;
  if (!perfil?.ativo) {
    return (
      <main className="mx-auto max-w-sm px-6 py-16 text-center">
        <h1 className="text-xl font-bold">Acesso não liberado</h1>
        <p className="mt-2 text-neutral-600">Seu usuário existe, mas não tem perfil ativo no painel.</p>
        <form action={sair} className="mt-6">
          <button className="rounded-xl border border-neutral-300 px-4 py-2 font-medium">Sair</button>
        </form>
      </main>
    );
  }

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <span className="font-bold">Oji · CMV</span>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-neutral-600">
              {perfil.nome} <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs">{perfil.papel}</span>
            </span>
            <form action={sair}>
              <button className="font-medium text-neutral-900 underline-offset-2 hover:underline">Sair</button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-4 py-6">{children}</div>
    </>
  );
}
