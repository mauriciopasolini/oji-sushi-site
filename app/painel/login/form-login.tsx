"use client";
import { useActionState } from "react";
import { entrar, type EstadoLogin } from "./actions";

const campo =
  "w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-base outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10";

export function FormLogin({ next }: { next?: string }) {
  const [estado, acao, enviando] = useActionState<EstadoLogin, FormData>(entrar, {});

  return (
    <form action={acao} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-neutral-700">E-mail</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          defaultValue={estado.email}
          className={campo}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-neutral-700">Senha</span>
        <input name="senha" type="password" autoComplete="current-password" required className={campo} />
      </label>
      {estado.erro && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {estado.erro}
        </p>
      )}
      <button
        type="submit"
        disabled={enviando}
        className="w-full rounded-xl bg-neutral-900 px-4 py-3 text-base font-semibold text-white transition active:scale-[.99] disabled:opacity-60"
      >
        {enviando ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
