"use client";

import { useEffect, useRef, useState } from "react";
import type { ComparacaoMeta } from "@/lib/cmv/meta-dia";

// Mesmos tons do painel (semáforo/barra de vendas). Na linha selecionada (fundo escuro)
// usa a variante clara para manter o contraste.
const COR = {
  acima: { claro: "text-green-700", escuro: "text-green-300" },
  abaixo: { claro: "text-red-700", escuro: "text-red-300" },
} as const;

/**
 * Total do dia colorido pela meta, com ▲/▼ (não depende só da cor). A diferença aparece
 * ao passar o mouse (desktop) ou ao tocar (celular); toque fora ou Esc fecha.
 */
export function TotalDia({ valor, comparacao, selecionada }: { valor: string; comparacao: ComparacaoMeta; selecionada: boolean }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  const cor = COR[comparacao.sentido][selecionada ? "escuro" : "claro"];
  const seta = comparacao.sentido === "acima" ? "▲" : "▼";

  return (
    <span ref={ref} className="group relative inline-block">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        aria-label={`${valor}, ${comparacao.sentido} da meta: ${comparacao.texto}`}
        className={`inline-flex items-center gap-1 rounded font-semibold tabular-nums ${cor} focus-visible:outline-2 focus-visible:outline-offset-2`}
      >
        {valor}
        <span aria-hidden className="text-[0.65em] leading-none">
          {seta}
        </span>
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute right-0 bottom-full z-10 mb-1 whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 text-xs font-medium text-white shadow-lg ring-1 ring-white/10 ${
          aberto ? "block" : "hidden group-hover:block"
        }`}
      >
        {comparacao.texto}
      </span>
    </span>
  );
}
