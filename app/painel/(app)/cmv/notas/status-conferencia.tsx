"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { type Conferencia, ROTULO_CONFERENCIA } from "@/lib/cmv/tipos";
import { marcarConferencia } from "../conferencia/actions";

const COR: Record<Conferencia, string> = {
  pendente: "text-neutral-600 border-neutral-300",
  conferida: "text-green-700 border-green-300",
  divergente: "text-red-700 border-red-300",
};

/** Admin: status de conferência clicável (lista de notas e página da nota). */
export function StatusConferencia({ id, conferencia, observacao, compacto = false }: { id: string; conferencia: Conferencia; observacao: string | null; compacto?: boolean }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [obs, setObs] = useState(observacao ?? "");
  const [divergindo, setDivergindo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const raiz = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  async function marcar(c: Conferencia) {
    setEnviando(true);
    setErro(null);
    const r = await marcarConferencia(id, c, c === "divergente" ? obs : undefined);
    setEnviando(false);
    if (!r.ok) return setErro(r.erro);
    setAberto(false);
    setDivergindo(false);
    router.refresh();
  }

  const opcao = "block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-neutral-100 disabled:opacity-50";

  return (
    <div ref={raiz} className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setAberto((x) => !x)}
        aria-haspopup="menu"
        aria-expanded={aberto}
        title={observacao ?? "Alterar conferência"}
        className={`rounded-md border border-dashed px-1.5 py-0.5 ${compacto ? "text-xs" : "text-sm font-medium"} ${COR[conferencia]}`}
      >
        {ROTULO_CONFERENCIA[conferencia]} ▾
      </button>
      {aberto && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-64 rounded-xl border border-neutral-200 bg-white p-1.5 text-neutral-900 shadow-lg">
          {conferencia !== "conferida" && (
            <button type="button" disabled={enviando} onClick={() => marcar("conferida")} className={`${opcao} text-green-800`}>
              ✓ Conferida
            </button>
          )}
          {!divergindo ? (
            <button type="button" disabled={enviando} onClick={() => setDivergindo(true)} className={`${opcao} text-red-700`}>
              ✗ Divergente{conferencia === "divergente" ? " (editar observação)" : ""}
            </button>
          ) : (
            <form
              className="space-y-1.5 p-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                marcar("divergente");
              }}
            >
              <textarea
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                rows={2}
                autoFocus
                placeholder="O que está divergente? (obrigatório)"
                aria-label="Observação da divergência"
                className="w-full rounded-lg border border-red-300 px-2 py-1.5 text-sm"
              />
              <button disabled={!obs.trim() || enviando} className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
                Marcar divergente
              </button>
            </form>
          )}
          {conferencia !== "pendente" && (
            <button type="button" disabled={enviando} onClick={() => marcar("pendente")} className={opcao}>
              Voltar para pendente
            </button>
          )}
          {erro && <p className="px-3 py-1 text-xs text-red-700">{erro}</p>}
        </div>
      )}
    </div>
  );
}
