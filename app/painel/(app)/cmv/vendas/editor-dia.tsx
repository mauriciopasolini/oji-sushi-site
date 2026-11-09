"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { centavos, formatarBRL } from "@/lib/cmv/dinheiro";
import { type CampoValor, ORIGENS, type Origem } from "@/lib/cmv/vendas";
import { type LinhaVenda, removerVendasManuaisDia, salvarVendasDia } from "./actions";

export type VendaExistente = {
  turno: 1 | 2;
  origem: Origem;
  fonte: "manual" | "planilha";
  valores: Record<CampoValor, number>;
  qtdPedidos: number | null;
};

const chave = (t: number, o: string) => `${t}-${o}`;
const paraTela = (v: number) => (v ? (v / 100).toFixed(2).replace(".", ",") : "");

export function EditorDia({ data, existentes, ehAdmin }: { data: string; existentes: VendaExistente[]; ehAdmin: boolean }) {
  const router = useRouter();
  const porChave = useMemo(() => new Map(existentes.map((e) => [chave(e.turno, e.origem), e])), [existentes]);

  const [form, setForm] = useState<Record<string, { valores: Record<string, string>; qtd: string }>>(() => {
    const f: Record<string, { valores: Record<string, string>; qtd: string }> = {};
    for (const turno of [1, 2])
      for (const o of ORIGENS) {
        const e = porChave.get(chave(turno, o.valor));
        f[chave(turno, o.valor)] = {
          valores: Object.fromEntries(o.campos.map((c) => [c.campo, e ? paraTela(e.valores[c.campo]) : ""])),
          qtd: e?.qtdPedidos != null ? String(e.qtdPedidos) : "",
        };
      }
    return f;
  });
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const totalDe = (k: string) =>
    Object.values(form[k].valores).reduce((a, v) => {
      try {
        return a + centavos(v);
      } catch {
        return a;
      }
    }, 0);
  const totalTurno = (t: number) => ORIGENS.reduce((a, o) => a + totalDe(chave(t, o.valor)), 0);

  async function salvar(diaFechado = false) {
    setErro(null);
    setOk(false);
    setEnviando(true);
    const linhas: LinhaVenda[] = [];
    for (const turno of [1, 2] as const)
      for (const o of ORIGENS) {
        const k = chave(turno, o.valor);
        if (porChave.get(k)?.fonte === "planilha") continue;
        const temAlgo = Object.values(form[k].valores).some((v) => v.trim()) || form[k].qtd.trim();
        // Linhas vazias não são gravadas, a não ser que já existam (para permitir zerar)
        // ou que o dia esteja sendo registrado como sem movimento.
        if (!temAlgo && !porChave.has(k) && !(diaFechado && turno === 1 && o.valor === "restaurante")) continue;
        linhas.push({ turno, origem: o.valor, valores: diaFechado ? {} : form[k].valores, qtdPedidos: diaFechado ? "" : form[k].qtd });
      }
    const r = await salvarVendasDia(data, linhas);
    setEnviando(false);
    if (!r.ok) return setErro(r.erro);
    setOk(true);
    router.refresh();
  }

  const entrada = "w-full rounded-lg border border-neutral-300 bg-white px-2 py-2 text-right tabular-nums disabled:bg-neutral-100";

  return (
    <div className="space-y-4">
      {[1, 2].map((turno) => (
        <section key={turno} className="rounded-2xl border border-neutral-200 bg-white p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="font-semibold">Turno {turno}</h3>
            <span className="text-sm tabular-nums text-neutral-600">Total {formatarBRL(totalTurno(turno))}</span>
          </div>
          <div className="space-y-4">
            {ORIGENS.map((o) => {
              const k = chave(turno, o.valor);
              const planilha = porChave.get(k)?.fonte === "planilha";
              return (
                <fieldset key={o.valor} disabled={planilha} className="space-y-2">
                  <legend className="flex w-full justify-between text-sm font-medium">
                    <span>
                      {o.rotulo}
                      {planilha && <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-800">da planilha</span>}
                    </span>
                    <span className="tabular-nums text-neutral-500">{formatarBRL(totalDe(k))}</span>
                  </legend>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {o.campos.map((c) => (
                      <label key={c.campo} className="block text-xs text-neutral-600">
                        {c.rotulo}
                        <input
                          inputMode="decimal"
                          placeholder="0,00"
                          className={entrada}
                          value={form[k].valores[c.campo]}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, [k]: { ...f[k], valores: { ...f[k].valores, [c.campo]: e.target.value.replace(/[^\d.,]/g, "") } } }))
                          }
                        />
                      </label>
                    ))}
                    {o.temPedidos && (
                      <label className="block text-xs text-neutral-600">
                        Qtd. pedidos
                        <input
                          inputMode="numeric"
                          className={entrada}
                          value={form[k].qtd}
                          onChange={(e) => setForm((f) => ({ ...f, [k]: { ...f[k], qtd: e.target.value.replace(/\D/g, "") } }))}
                        />
                      </label>
                    )}
                  </div>
                </fieldset>
              );
            })}
          </div>
        </section>
      ))}

      <p className="text-right font-semibold tabular-nums">Total do dia {formatarBRL(totalTurno(1) + totalTurno(2))}</p>
      {erro && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {erro}
        </p>
      )}
      {ok && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">Vendas salvas.</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={enviando} onClick={() => salvar(false)} className="flex-1 rounded-xl bg-neutral-900 px-4 py-3 font-semibold text-white disabled:opacity-60">
          {enviando ? "Salvando…" : "Salvar vendas do dia"}
        </button>
        {existentes.length === 0 && (
          <button type="button" disabled={enviando} onClick={() => salvar(true)} className="rounded-xl border border-neutral-300 bg-white px-4 py-3 text-sm">
            Sem movimento neste dia
          </button>
        )}
        {ehAdmin && existentes.some((e) => e.fonte === "manual") && (
          <button
            type="button"
            disabled={enviando}
            onClick={async () => {
              setEnviando(true);
              const r = await removerVendasManuaisDia(data);
              setEnviando(false);
              if (!r.ok) return setErro(r.erro);
              router.refresh();
            }}
            className="rounded-xl border border-red-300 px-4 py-3 text-sm text-red-700"
          >
            Remover lançamentos manuais
          </button>
        )}
      </div>
    </div>
  );
}
