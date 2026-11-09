"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cancelarNota } from "../actions";

export function CancelarNota({ id }: { id: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} className="rounded-xl border border-red-300 px-4 py-2.5 font-medium text-red-700">
        Cancelar nota
      </button>
    );
  }

  return (
    <div className="w-full space-y-3 rounded-xl border border-red-200 bg-red-50 p-4">
      <p className="font-medium text-red-900">Cancelar esta nota? Ela deixa de contar no CMV, mas continua registrada.</p>
      <label className="block">
        <span className="mb-1 block text-sm text-red-900">Motivo (obrigatório)</span>
        <input
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Ex.: nota lançada em duplicidade"
          className="w-full rounded-xl border border-red-300 bg-white px-3 py-2.5"
          autoFocus
        />
      </label>
      {erro && (
        <p role="alert" className="text-sm text-red-700">
          {erro}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={enviando || !motivo.trim()}
          onClick={async () => {
            setEnviando(true);
            setErro(null);
            const r = await cancelarNota(id, motivo);
            setEnviando(false);
            if (!r.ok) return setErro(r.erro);
            setAberto(false);
            router.refresh();
          }}
          className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 font-semibold text-white disabled:opacity-50"
        >
          {enviando ? "Cancelando…" : "Confirmar cancelamento"}
        </button>
        <button type="button" onClick={() => setAberto(false)} className="rounded-xl border border-neutral-300 bg-white px-4 py-2.5">
          Voltar
        </button>
      </div>
    </div>
  );
}
