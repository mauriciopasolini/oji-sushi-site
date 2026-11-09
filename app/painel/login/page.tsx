import type { Metadata } from "next";
import { FormLogin } from "./form-login";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-12">
      <div className="mb-8">
        <p className="text-sm font-medium tracking-wide text-red-600 uppercase">Oji · Shakai · Wabi</p>
        <h1 className="mt-1 text-2xl font-bold">Painel de gestão</h1>
        <p className="mt-1 text-sm text-neutral-500">Acesso restrito à gerência.</p>
      </div>
      <FormLogin next={next} />
    </main>
  );
}
