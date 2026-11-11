"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Estado = { s: number; x: number; y: number };
const MIN = 1;
const MAX = 8;
const limitar = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * Foto grande com zoom: roda do mouse (no ponto do cursor), pinça no celular,
 * arrastar para mover, duplo clique/toque para aproximar ou voltar.
 */
export function VisorFoto({ src, alt, original }: { src: string; alt: string; original?: string }) {
  const caixa = useRef<HTMLDivElement>(null);
  const [t, setT] = useState<Estado>({ s: 1, x: 0, y: 0 });
  const ponteiros = useRef(new Map<number, { x: number; y: number }>());
  const gesto = useRef<{ dist: number; meio: { x: number; y: number }; base: Estado } | null>(null);

  // Mantém a imagem cobrindo a área (sem "sair" do quadro).
  const ajustar = useCallback((e: Estado): Estado => {
    const el = caixa.current;
    if (!el) return e;
    const { width: w, height: h } = el.getBoundingClientRect();
    const s = limitar(e.s, MIN, MAX);
    return { s, x: limitar(e.x, w - w * s, 0), y: limitar(e.y, h - h * s, 0) };
  }, []);

  /** Zoom para `novo` mantendo fixo o ponto (px, py) da área. */
  const zoomEm = useCallback(
    (base: Estado, novo: number, px: number, py: number): Estado => {
      const s = limitar(novo, MIN, MAX);
      return ajustar({ s, x: px - ((px - base.x) * s) / base.s, y: py - ((py - base.y) * s) / base.s });
    },
    [ajustar],
  );

  const ponto = (e: { clientX: number; clientY: number }) => {
    const r = caixa.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // Roda do mouse: listener não-passivo para impedir a rolagem da página.
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const roda = (e: WheelEvent) => {
      e.preventDefault();
      const p = ponto(e);
      setT((atual) => zoomEm(atual, atual.s * Math.exp(-e.deltaY * 0.0015), p.x, p.y));
    };
    el.addEventListener("wheel", roda, { passive: false });
    return () => el.removeEventListener("wheel", roda);
  }, [zoomEm]);

  // Nova foto: volta ao tamanho original.
  useEffect(() => setT({ s: 1, x: 0, y: 0 }), [src]);

  function onPointerDown(e: React.PointerEvent) {
    caixa.current?.setPointerCapture(e.pointerId);
    ponteiros.current.set(e.pointerId, ponto(e));
    if (ponteiros.current.size === 2) {
      const [a, b] = [...ponteiros.current.values()];
      gesto.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), meio: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, base: t };
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const anterior = ponteiros.current.get(e.pointerId);
    if (!anterior) return;
    const atual = ponto(e);
    ponteiros.current.set(e.pointerId, atual);
    if (ponteiros.current.size === 2 && gesto.current) {
      const [a, b] = [...ponteiros.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const meio = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const g = gesto.current;
      const z = zoomEm(g.base, (g.base.s * dist) / (g.dist || 1), g.meio.x, g.meio.y);
      setT(ajustar({ ...z, x: z.x + meio.x - g.meio.x, y: z.y + meio.y - g.meio.y }));
    } else if (ponteiros.current.size === 1) {
      setT((x) => (x.s > 1 ? ajustar({ ...x, x: x.x + atual.x - anterior.x, y: x.y + atual.y - anterior.y }) : x));
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    ponteiros.current.delete(e.pointerId);
    if (ponteiros.current.size < 2) gesto.current = null;
  }

  function onDoubleClick(e: React.MouseEvent) {
    const p = ponto(e);
    setT((x) => (x.s > 1.05 ? { s: 1, x: 0, y: 0 } : zoomEm(x, 2.5, p.x, p.y)));
  }

  const centro = () => {
    const r = caixa.current?.getBoundingClientRect();
    return { x: (r?.width ?? 0) / 2, y: (r?.height ?? 0) / 2 };
  };
  const botao = "rounded-lg bg-white/90 px-3 py-1.5 text-sm font-semibold text-neutral-900 shadow";

  return (
    <div className="relative">
      <div
        ref={caixa}
        className={`relative h-[60vh] overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-800 md:h-[calc(100vh-11rem)] ${t.s > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"}`}
        style={{ touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="h-full w-full select-none object-contain"
          style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})`, transformOrigin: "0 0" }}
        />
      </div>
      <div className="absolute right-2 bottom-2 flex gap-1.5">
        <button type="button" className={botao} onClick={() => setT((x) => zoomEm(x, x.s / 1.5, centro().x, centro().y))} aria-label="Diminuir zoom">
          −
        </button>
        <button type="button" className={botao} onClick={() => setT({ s: 1, x: 0, y: 0 })} aria-label="Tamanho original">
          {Math.round(t.s * 100)}%
        </button>
        <button type="button" className={botao} onClick={() => setT((x) => zoomEm(x, x.s * 1.5, centro().x, centro().y))} aria-label="Aumentar zoom">
          +
        </button>
        {original && (
          <a href={original} target="_blank" rel="noopener" className={botao}>
            Abrir
          </a>
        )}
      </div>
    </div>
  );
}
