"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatarQuantidade, tentarLerQuantidade, totalDaContagem, valorDoItem } from "@/lib/cmv/contagem";
import { centavos, formatarBRL } from "@/lib/cmv/dinheiro";
import { reabrirContagem, salvarContagem } from "./actions";

export type ItemForm = {
  id: string;
  nome: string;
  unidade: string;
  categoriaId: string;
  categoriaNome: string;
  quantidade: string;
  custo: string;
  inativo: boolean;
};

type Props = {
  competencia: string;
  contagemId: string | null;
  finalizada: boolean;
  bloqueio: string | null;
  dataInicial: string;
  hoje: string;
  itens: ItemForm[];
  categorias: { id: string; nome: string }[];
  ehAdmin: boolean;
  salvoEm: string | null;
};

const tentarCentavos = (s: string) => {
  try {
    return s.trim() ? centavos(s) : null;
  } catch {
    return undefined;
  }
};
const hora = (ts: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
const AUTOSALVAR_MS = 2500;

/** Contagem pensada para o celular: um cartão por item, total ao vivo, rascunho salvo sozinho. */
export function FormContagem(p: Props) {
  const router = useRouter();
  const [data, setData] = useState(p.dataInicial);
  const [valores, setValores] = useState(() => new Map(p.itens.map((i) => [i.id, { quantidade: i.quantidade, custo: i.custo }])));
  const [categoria, setCategoria] = useState("");
  const [soFaltando, setSoFaltando] = useState(false);
  const [busca, setBusca] = useState("");
  const [sujo, setSujo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [salvoEm, setSalvoEm] = useState(p.salvoEm);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmarFinal, setConfirmarFinal] = useState(false);
  const [reabrindo, setReabrindo] = useState(false);
  const [motivo, setMotivo] = useState("");
  const versao = useRef(0);
  const campos = useRef(new Map<string, HTMLInputElement>());
  const somenteLeitura = p.finalizada || Boolean(p.bloqueio);

  const linhas = useMemo(
    () =>
      p.itens.map((i) => {
        const v = valores.get(i.id)!;
        const q = tentarLerQuantidade(v.quantidade);
        const c = tentarCentavos(v.custo);
        return { item: i, v, q, c, valor: q != null && c != null ? valorDoItem(q, c) : null };
      }),
    [p.itens, valores],
  );
  const resumo = totalDaContagem(linhas.map((l) => ({ quantidade: l.q ?? null, custo: l.c ?? null })));
  const invalidos = linhas.filter((l) => l.q === undefined || l.c === undefined);
  const porCategoria = p.categorias.map((c) => ({
    ...c,
    total: linhas.filter((l) => l.item.categoriaId === c.id).reduce((a, l) => a + (l.valor ?? 0), 0),
  }));

  const visiveis = linhas.filter(
    (l) =>
      (!categoria || l.item.categoriaId === categoria) &&
      (!soFaltando || l.q === null) &&
      (!busca.trim() || l.item.nome.toLowerCase().includes(busca.trim().toLowerCase())),
  );

  const salvar = useCallback(
    async (finalizar: boolean) => {
      if (somenteLeitura) return false;
      const minha = ++versao.current;
      setSalvando(true);
      setErro(null);
      const enviadas = p.itens.map((i) => {
        const v = valores.get(i.id)!;
        // Ao finalizar, item em branco vira 0 (o usuário confirmou).
        return { itemId: i.id, quantidade: finalizar && !v.quantidade.trim() ? "0" : v.quantidade, custo: v.custo };
      });
      const r = await salvarContagem({ competencia: p.competencia, data, linhas: enviadas, finalizar });
      setSalvando(false);
      if (!r.ok) {
        setErro(r.erro);
        return false;
      }
      setSalvoEm(r.dados.salvoEm);
      if (minha === versao.current) setSujo(false);
      if (finalizar) router.refresh();
      return true;
    },
    [somenteLeitura, p.itens, p.competencia, valores, data, router],
  );

  // Rascunho salvo sozinho, alguns segundos depois da última digitação.
  useEffect(() => {
    if (!sujo || somenteLeitura || invalidos.length) return;
    const t = setTimeout(() => salvar(false), AUTOSALVAR_MS);
    return () => clearTimeout(t);
  }, [sujo, valores, data, somenteLeitura, invalidos.length, salvar]);

  // Avisa antes de sair com alterações não salvas.
  useEffect(() => {
    if (!sujo) return;
    const antes = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", antes);
    return () => window.removeEventListener("beforeunload", antes);
  }, [sujo]);

  function alterar(id: string, campo: "quantidade" | "custo", texto: string) {
    versao.current++;
    setValores((m) => new Map(m).set(id, { ...m.get(id)!, [campo]: texto }));
    setSujo(true);
    setConfirmarFinal(false);
  }

  function proximoCampo(id: string) {
    const i = visiveis.findIndex((l) => l.item.id === id);
    const prox = visiveis[i + 1];
    if (prox) campos.current.get(prox.item.id)?.focus();
    else (document.activeElement as HTMLElement | null)?.blur();
  }

  const estadoSalvo = salvando ? "Salvando…" : sujo ? (invalidos.length ? "Corrija os campos em vermelho" : "Alterações não salvas") : salvoEm ? `Rascunho salvo às ${hora(salvoEm)}` : "";

  return (
    <div className="space-y-3">
      {p.bloqueio && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{p.bloqueio}</p>}
      {p.finalizada && (
        <div className="space-y-2 rounded-2xl border border-green-200 bg-green-50 p-4 text-green-950">
          <p className="font-semibold">Contagem finalizada.</p>
          <p className="text-sm">Ela é o estoque final deste mês e o estoque inicial do mês seguinte.</p>
          {p.ehAdmin && !p.bloqueio && p.contagemId && (
            <>
              {!reabrindo ? (
                <button type="button" onClick={() => setReabrindo(true)} className="rounded-lg border border-green-700 px-3 py-1.5 text-sm font-medium">
                  Reabrir contagem
                </button>
              ) : (
                <form
                  className="flex flex-wrap gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setErro(null);
                    const r = await reabrirContagem(p.contagemId!, motivo);
                    if (!r.ok) return setErro(r.erro);
                    router.refresh();
                  }}
                >
                  <input
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Motivo (obrigatório)"
                    aria-label="Motivo para reabrir"
                    className="min-w-0 flex-1 rounded-lg border border-green-300 bg-white px-3 py-1.5 text-base"
                    autoFocus
                  />
                  <button disabled={!motivo.trim()} className="rounded-lg bg-green-800 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
                    Reabrir
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-sm text-neutral-600">Data da contagem</span>
          <input
            type="date"
            value={data}
            max={p.hoje}
            disabled={somenteLeitura}
            onChange={(e) => {
              setData(e.target.value);
              setSujo(true);
            }}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base disabled:bg-neutral-100"
          />
        </label>
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar item"
          aria-label="Buscar item"
          className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {[{ id: "", nome: "Todas" }, ...p.categorias].map((c) => (
          <button
            key={c.id || "todas"}
            type="button"
            onClick={() => setCategoria(c.id)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${categoria === c.id ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-700"}`}
          >
            {c.nome.split(" ")[0]}
          </button>
        ))}
        {!somenteLeitura && (
          <label className="ml-auto flex items-center gap-1.5 text-sm text-neutral-700">
            <input type="checkbox" checked={soFaltando} onChange={(e) => setSoFaltando(e.target.checked)} /> só os que faltam
          </label>
        )}
      </div>

      <ul className="space-y-2">
        {visiveis.map(({ item, v, q, c, valor }) => (
          <li key={item.id} className={`rounded-2xl border bg-white p-3 ${q === null && !somenteLeitura ? "border-neutral-200" : "border-neutral-300"}`}>
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-medium">
                {item.nome}
                {item.inativo && <span className="ml-1.5 text-xs text-neutral-500">(inativo)</span>}
              </p>
              <span className="text-xs text-neutral-500">{item.categoriaNome.split(" ")[0]}</span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <label className="flex flex-1 items-center gap-1.5">
                <span className="sr-only">Quantidade de {item.nome}</span>
                <input
                  ref={(el) => {
                    if (el) campos.current.set(item.id, el);
                    else campos.current.delete(item.id);
                  }}
                  value={v.quantidade}
                  onChange={(e) => alterar(item.id, "quantidade", e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      proximoCampo(item.id);
                    }
                  }}
                  onBlur={() => {
                    if (q != null && formatarQuantidade(q) !== v.quantidade) alterar(item.id, "quantidade", formatarQuantidade(q));
                  }}
                  inputMode="decimal"
                  enterKeyHint="next"
                  placeholder="qtd."
                  disabled={somenteLeitura}
                  className={`w-full min-w-0 rounded-xl border px-3 py-2.5 text-right text-xl font-semibold tabular-nums disabled:bg-neutral-50 ${q === undefined ? "border-red-500 bg-red-50" : "border-neutral-300"}`}
                />
                <span className="w-8 text-sm text-neutral-600">{item.unidade}</span>
              </label>
              <span className="text-neutral-400">×</span>
              <label className="flex w-32 items-center gap-1">
                <span className="text-sm text-neutral-500">R$</span>
                <span className="sr-only">Custo unitário de {item.nome}</span>
                <input
                  value={v.custo}
                  onChange={(e) => alterar(item.id, "custo", e.target.value)}
                  inputMode="decimal"
                  placeholder="custo"
                  disabled={somenteLeitura}
                  className={`w-full min-w-0 rounded-xl border px-2 py-2.5 text-right tabular-nums disabled:bg-neutral-50 ${c === undefined ? "border-red-500 bg-red-50" : "border-neutral-300"}`}
                />
              </label>
            </div>
            <p className="mt-1 text-right text-sm text-neutral-600 tabular-nums">
              {valor !== null ? `= ${formatarBRL(valor)}` : q === null ? "não contado" : "—"}
              {q != null && q > 0 && c === null && <span className="text-amber-700"> · falta o custo</span>}
            </p>
          </li>
        ))}
        {!visiveis.length && <li className="rounded-2xl border border-neutral-200 bg-white px-4 py-6 text-center text-neutral-500">Nenhum item neste filtro.</li>}
      </ul>

      <details className="rounded-2xl border border-neutral-200 bg-white px-4 py-2 text-sm">
        <summary className="cursor-pointer font-medium">Total por categoria</summary>
        <ul className="mt-2 space-y-1 tabular-nums">
          {porCategoria.map((c) => (
            <li key={c.id} className="flex justify-between">
              <span>{c.nome}</span>
              <span>{formatarBRL(c.total)}</span>
            </li>
          ))}
        </ul>
      </details>

      {/* Barra fixa: total ao vivo e ações */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-200 bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto max-w-5xl space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <p className="text-2xl font-bold tabular-nums">{formatarBRL(resumo.total)}</p>
              <p className="text-xs text-neutral-600">
                {resumo.preenchidos} de {p.itens.length} itens contados{estadoSalvo && ` · ${estadoSalvo}`}
              </p>
            </div>
            {!somenteLeitura && (
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={salvando || Boolean(invalidos.length)}
                  onClick={() => salvar(false)}
                  className="rounded-xl border border-neutral-300 px-3 py-2.5 text-sm font-semibold disabled:opacity-50"
                >
                  Salvar rascunho
                </button>
                <button
                  type="button"
                  disabled={salvando || Boolean(invalidos.length) || resumo.preenchidos === 0}
                  onClick={() => setConfirmarFinal(true)}
                  className="rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Finalizar
                </button>
              </div>
            )}
          </div>
          {confirmarFinal && !somenteLeitura && (
            <div className="space-y-2 rounded-xl border border-neutral-300 bg-neutral-50 p-3 text-sm">
              <p>
                Finalizar a contagem com total de <strong>{formatarBRL(resumo.total)}</strong>?
                {resumo.vazios > 0 && (
                  <>
                    {" "}
                    <strong className="text-amber-800">{resumo.vazios} item(ns) sem quantidade serão gravados como 0.</strong>
                  </>
                )}{" "}
                Depois de finalizada, só o administrador pode reabrir.
              </p>
              <div className="flex gap-2">
                <button type="button" disabled={salvando} onClick={() => salvar(true)} className="rounded-lg bg-neutral-900 px-3 py-2 font-semibold text-white disabled:opacity-50">
                  Confirmar e finalizar
                </button>
                <button type="button" onClick={() => setConfirmarFinal(false)} className="rounded-lg border border-neutral-300 px-3 py-2">
                  Voltar
                </button>
              </div>
            </div>
          )}
          {erro && (
            <p role="alert" className="text-sm text-red-700">
              {erro}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
