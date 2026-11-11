"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { type FiltroConferencia, passaNoFiltro } from "@/lib/cmv/conferencia";
import { type Conferencia, ROTULO_CONFERENCIA } from "@/lib/cmv/tipos";
import { marcarConferencia } from "./actions";

type Props = {
  notaId: string;
  conferencia: Conferencia;
  observacao: string | null;
  filtro: FiltroConferencia;
  /** links já com os filtros atuais */
  anteriorHref: string | null;
  proximaHref: string | null;
  /** para onde ir quando a nota marcada sai do filtro (ex.: em "pendentes") */
  depoisSaiHref: string;
  bloqueado: string | null;
};

const ehCampo = (el: Element | null) => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;

/** Botões Conferida / Divergente e atalhos de teclado: C, D, ← →. */
export function AcoesConferencia(p: Props) {
  const router = useRouter();
  const [divergindo, setDivergindo] = useState(false);
  const [obs, setObs] = useState(p.conferencia === "divergente" ? (p.observacao ?? "") : "");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const campoObs = useRef<HTMLTextAreaElement>(null);

  // Nova nota na tela: zera o estado local.
  useEffect(() => {
    setDivergindo(false);
    setObs(p.conferencia === "divergente" ? (p.observacao ?? "") : "");
    setErro(null);
  }, [p.notaId, p.conferencia, p.observacao]);

  const marcar = useCallback(
    async (c: Conferencia, texto?: string) => {
      if (p.bloqueado || enviando) return;
      setEnviando(true);
      setErro(null);
      const r = await marcarConferencia(p.notaId, c, texto);
      setEnviando(false);
      if (!r.ok) return setErro(r.erro);
      // "voltar para pendente" fica na mesma nota; marcar avança.
      const destino = c === "pendente" ? null : passaNoFiltro(c, p.filtro) ? (p.proximaHref ?? null) : p.depoisSaiHref;
      if (destino) router.push(destino, { scroll: false });
      else router.refresh();
    },
    [p.bloqueado, p.notaId, p.filtro, p.proximaHref, p.depoisSaiHref, enviando, router],
  );

  const abrirDivergente = useCallback(() => {
    if (p.bloqueado) return;
    setDivergindo(true);
    setTimeout(() => campoObs.current?.focus(), 0);
  }, [p.bloqueado]);

  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (ehCampo(document.activeElement)) {
        if (e.key === "Escape") {
          setDivergindo(false);
          (document.activeElement as HTMLElement).blur();
        }
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "c") {
        e.preventDefault();
        marcar("conferida");
      } else if (k === "d") {
        e.preventDefault();
        abrirDivergente();
      } else if (e.key === "ArrowLeft" && p.anteriorHref) {
        e.preventDefault();
        router.push(p.anteriorHref, { scroll: false });
      } else if (e.key === "ArrowRight" && p.proximaHref) {
        e.preventDefault();
        router.push(p.proximaHref, { scroll: false });
      }
    }
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [marcar, abrirDivergente, p.anteriorHref, p.proximaHref, router]);

  return (
    <div className="space-y-3">
      {p.bloqueado && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{p.bloqueado}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={Boolean(p.bloqueado) || enviando}
          onClick={() => marcar("conferida")}
          className={`rounded-xl px-4 py-3 text-lg font-bold disabled:opacity-50 ${p.conferencia === "conferida" ? "bg-green-700 text-white ring-2 ring-green-300" : "bg-green-600 text-white"}`}
        >
          ✓ Conferida <kbd className="ml-1 hidden rounded bg-white/20 px-1.5 text-xs font-medium md:inline">C</kbd>
        </button>
        <button
          type="button"
          disabled={Boolean(p.bloqueado) || enviando}
          onClick={abrirDivergente}
          className={`rounded-xl px-4 py-3 text-lg font-bold disabled:opacity-50 ${p.conferencia === "divergente" ? "bg-red-700 text-white ring-2 ring-red-300" : "border-2 border-red-600 bg-white text-red-700"}`}
        >
          ✗ Divergente <kbd className="ml-1 hidden rounded bg-red-100 px-1.5 text-xs font-medium text-red-800 md:inline">D</kbd>
        </button>
      </div>

      {divergindo && (
        <form
          className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            marcar("divergente", obs);
          }}
        >
          <label htmlFor="obs-divergente" className="block text-sm font-medium text-red-900">
            O que está divergente? (obrigatório)
          </label>
          <textarea
            id="obs-divergente"
            ref={campoObs}
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (obs.trim()) marcar("divergente", obs);
              }
            }}
            rows={2}
            placeholder="Ex.: valor da foto é R$ 1.230,00; lançado R$ 1.320,00"
            className="w-full rounded-lg border border-red-300 bg-white px-3 py-2 text-base"
          />
          <div className="flex items-center gap-2">
            <button disabled={!obs.trim() || enviando} className="rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
              Marcar divergente
            </button>
            <button type="button" onClick={() => setDivergindo(false)} className="rounded-lg px-3 py-2 text-sm text-neutral-700">
              Cancelar <span className="hidden text-xs text-neutral-500 md:inline">(Esc)</span>
            </button>
          </div>
        </form>
      )}

      {p.conferencia !== "pendente" && !divergindo && (
        <p className="text-sm text-neutral-600">
          Situação atual: <strong>{ROTULO_CONFERENCIA[p.conferencia]}</strong>
          {p.observacao ? ` · ${p.observacao}` : ""}{" "}
          {!p.bloqueado && (
            <button type="button" onClick={() => marcar("pendente")} className="ml-1 underline underline-offset-2">
              voltar para pendente
            </button>
          )}
        </p>
      )}
      {erro && (
        <p role="alert" className="text-sm text-red-700">
          {erro}
        </p>
      )}
      <p className="hidden text-xs text-neutral-500 md:block">
        Atalhos: <kbd>C</kbd> conferida · <kbd>D</kbd> divergente · <kbd>←</kbd> <kbd>→</kbd> anterior/próxima · <kbd>Enter</kbd> confirma a observação
      </p>
    </div>
  );
}
