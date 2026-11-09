"use client";
import Link from "next/link";
import { useActionState } from "react";
import { trocarSenha, type EstadoSenha } from "./actions";

const campo =
  "w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-base outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10";

export function FormSenha({ minimo }: { minimo: number }) {
  const [estado, acao, enviando] = useActionState<EstadoSenha, FormData>(trocarSenha, {});

  if (estado.ok) {
    return (
      <div className="space-y-4">
        <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-green-800">
          Senha trocada com sucesso.
        </p>
        <Link
          href="/painel/cmv"
          className="block w-full rounded-xl bg-neutral-900 px-4 py-3 text-center font-semibold text-white"
        >
          Ir para o painel
        </Link>
      </div>
    );
  }

  return (
    <form action={acao} className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-neutral-700">Senha atual</span>
        <input name="atual" type="password" autoComplete="current-password" required className={campo} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-neutral-700">Nova senha</span>
        <input name="nova" type="password" autoComplete="new-password" minLength={minimo} required className={campo} />
        <span className="mt-1 block text-xs text-neutral-500">Pelo menos {minimo} caracteres.</span>
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-neutral-700">Confirme a nova senha</span>
        <input name="confirmacao" type="password" autoComplete="new-password" minLength={minimo} required className={campo} />
      </label>
      {estado.erro && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {estado.erro}
        </p>
      )}
      <button
        type="submit"
        disabled={enviando}
        className="w-full rounded-xl bg-neutral-900 px-4 py-3 text-base font-semibold text-white disabled:opacity-60"
      >
        {enviando ? "Salvando…" : "Trocar senha"}
      </button>
    </form>
  );
}
