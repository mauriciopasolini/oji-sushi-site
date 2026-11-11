"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TIPOS_DOCUMENTO } from "@/lib/cmv/padroes-fornecedor";
import { FORMAS_PAGAMENTO, type FormaPagamento, type TipoNota } from "@/lib/cmv/tipos";
import { ajustarDocumentoPagamento } from "./actions";

/** Admin: corrige tipo e forma de pagamento sem abrir a edição completa. */
export function AjusteDocumento({ notaId, tipo, forma, bloqueado }: { notaId: string; tipo: TipoNota; forma: FormaPagamento; bloqueado: boolean }) {
  const router = useRouter();
  const [t, setT] = useState(tipo);
  const [f, setF] = useState(forma);
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const semNota = tipo === "sem_nota";
  const mudou = t !== tipo || f !== forma;

  useEffect(() => {
    setT(tipo);
    setF(forma);
    setMsg(null);
  }, [notaId, tipo, forma]);

  const sel = "w-full rounded-lg border border-neutral-300 bg-white px-2 py-2 text-sm disabled:bg-neutral-100";
  return (
    <form
      className="rounded-2xl border border-neutral-200 bg-white p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setEnviando(true);
        setMsg(null);
        const r = await ajustarDocumentoPagamento(notaId, t, f);
        setEnviando(false);
        if (!r.ok) return setMsg({ ok: false, texto: r.erro });
        setMsg({ ok: true, texto: "Ajuste salvo (auditoria: “ajuste na conferência”)." });
        router.refresh();
      }}
    >
      <p className="mb-2 text-sm font-medium">Corrigir documento e pagamento</p>
      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className="sr-only">Tipo de documento</span>
          {semNota ? (
            <select disabled className={sel} title="Compra sem nota: lance a nota fiscal pela edição da nota">
              <option>Sem nota (aguardando)</option>
            </select>
          ) : (
            <select value={t} onChange={(e) => setT(e.target.value as TipoNota)} disabled={bloqueado} className={sel}>
              {TIPOS_DOCUMENTO.map((x) => (
                <option key={x.valor} value={x.valor}>
                  {x.rotulo}
                </option>
              ))}
            </select>
          )}
        </label>
        <label>
          <span className="sr-only">Forma de pagamento</span>
          <select value={f} onChange={(e) => setF(e.target.value as FormaPagamento)} disabled={bloqueado} className={sel}>
            {FORMAS_PAGAMENTO.map((x) => (
              <option key={x.valor} value={x.valor}>
                {x.rotulo}
              </option>
            ))}
          </select>
        </label>
      </div>
      {mudou && !bloqueado && (
        <div className="mt-2 flex items-center gap-2">
          <button disabled={enviando} className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
            Salvar ajuste
          </button>
          <button type="button" onClick={() => { setT(tipo); setF(forma); }} className="rounded-lg px-3 py-1.5 text-sm text-neutral-700">
            Desfazer
          </button>
        </div>
      )}
      {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-green-700" : "text-red-700"}`}>{msg.texto}</p>}
      <p className="mt-1 text-xs text-neutral-500">Não muda a situação da conferência.</p>
    </form>
  );
}
