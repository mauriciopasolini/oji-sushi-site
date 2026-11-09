"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { justificarPendencia } from "../actions";

/** Admin: justificativa para fechar o mês com a compra ainda sem nota fiscal. */
export function JustificarPendencia({ id, atual }: { id: string; atual: string | null }) {
  const router = useRouter();
  const [texto, setTexto] = useState(atual ?? "");
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  async function salvar(valor: string) {
    setEnviando(true);
    setMsg(null);
    const r = await justificarPendencia(id, valor);
    setEnviando(false);
    if (!r.ok) return setMsg({ ok: false, texto: r.erro });
    setMsg({ ok: true, texto: valor.trim() ? "Justificativa salva." : "Justificativa removida." });
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium" htmlFor="justificativa">
        Justificativa para o fechamento do mês (administrador)
      </label>
      <textarea
        id="justificativa"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={2}
        placeholder="Ex.: fornecedor informal, compra paga no caixa; não emite nota"
        className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-base"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={enviando || !texto.trim() || texto.trim() === (atual ?? "")}
          onClick={() => salvar(texto)}
          className="rounded-lg bg-neutral-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Salvar justificativa
        </button>
        {atual && (
          <button type="button" disabled={enviando} onClick={() => { setTexto(""); salvar(""); }} className="rounded-lg border border-neutral-300 px-3 py-2 text-sm">
            Remover
          </button>
        )}
        {msg && <span className={`text-sm ${msg.ok ? "text-green-700" : "text-red-700"}`}>{msg.texto}</span>}
      </div>
    </div>
  );
}
