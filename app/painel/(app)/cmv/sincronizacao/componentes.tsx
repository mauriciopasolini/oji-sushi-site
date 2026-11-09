"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatarBRL } from "@/lib/cmv/dinheiro";
import { resolverConflito, salvarPlanilhaDoMes, sincronizarAgora, sincronizarSeNecessario } from "./actions";

/** Botão "Sincronizar agora". */
export function BotaoSincronizar() {
  const router = useRouter();
  const [estado, setEstado] = useState<{ rodando: boolean; msg?: string; erro?: boolean }>({ rodando: false });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={estado.rodando}
        onClick={async () => {
          setEstado({ rodando: true });
          const r = await sincronizarAgora();
          if (!r.ok) return setEstado({ rodando: false, msg: r.erro, erro: true });
          const erro = r.dados.find((x) => x.status === "erro");
          setEstado({ rodando: false, msg: (erro ?? r.dados.at(-1))?.mensagem, erro: Boolean(erro) });
          router.refresh();
        }}
        className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium disabled:opacity-60"
      >
        {estado.rodando ? "Sincronizando…" : "Sincronizar agora"}
      </button>
      {estado.msg && <span className={`text-xs ${estado.erro ? "text-red-700" : "text-neutral-600"}`}>{estado.msg}</span>}
    </div>
  );
}

/** Ao abrir o painel: sincroniza em segundo plano se a última tiver mais de 30 min (não trava a tela). */
export function SincronizacaoAutomatica() {
  const router = useRouter();
  const [rodando, setRodando] = useState(false);
  const disparou = useRef(false);
  useEffect(() => {
    if (disparou.current) return;
    disparou.current = true;
    setRodando(true);
    sincronizarSeNecessario()
      .then((r) => {
        if (r.executou) router.refresh();
      })
      .finally(() => setRodando(false));
  }, [router]);
  return rodando ? (
    <span className="text-xs text-neutral-500" aria-live="polite">
      verificando planilha…
    </span>
  ) : null;
}

type ValoresConflito = { campos: Record<string, number>; qtdPedidos: number | null };
export type ConflitoTela = {
  id: string;
  data: string;
  turno: number;
  origem: string;
  totalManual: number;
  totalPlanilha: number;
  manual: ValoresConflito;
  planilha: ValoresConflito;
};

const ROTULO_ORIGEM: Record<string, string> = { restaurante: "Restaurante", oji_tele: "Oji Tele", shakai_tele: "Shakai Tele", wabi_tele: "Wabi Tele" };
const ROTULO_CAMPO: Record<string, string> = {
  dinheiro: "Dinheiro", credito: "Crédito", debito: "Débito", pix: "Pix", loja_dinheiro: "Loja dinheiro", loja_cartao: "Loja cartão", online: "Online",
};

/** Lista de conflitos entre venda manual e planilha, com decisão do admin. */
export function ListaConflitos({ conflitos, ehAdmin }: { conflitos: ConflitoTela[]; ehAdmin: boolean }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {conflitos.map((c) => {
        const campos = Object.keys(ROTULO_CAMPO).filter((k) => (c.manual.campos[k] ?? 0) !== (c.planilha.campos[k] ?? 0));
        return (
          <div key={c.id} className="rounded-xl border border-amber-300 bg-amber-50 p-4">
            <p className="font-medium text-amber-950">
              {c.data.slice(8, 10)}/{c.data.slice(5, 7)} · Turno {c.turno} · {ROTULO_ORIGEM[c.origem] ?? c.origem}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg bg-white p-2">
                <p className="text-neutral-500">Lançamento manual</p>
                <p className="text-lg font-semibold tabular-nums">{formatarBRL(c.totalManual)}</p>
              </div>
              <div className="rounded-lg bg-white p-2">
                <p className="text-neutral-500">Planilha</p>
                <p className="text-lg font-semibold tabular-nums">{formatarBRL(c.totalPlanilha)}</p>
              </div>
            </div>
            {campos.length > 0 && (
              <p className="mt-2 text-xs text-amber-900">
                Diferenças:{" "}
                {campos.map((k) => `${ROTULO_CAMPO[k]} ${formatarBRL(c.manual.campos[k] ?? 0)} × ${formatarBRL(c.planilha.campos[k] ?? 0)}`).join(" · ")}
              </p>
            )}
            {ehAdmin ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {(["usar_planilha", "manter_manual"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    disabled={ocupado === c.id}
                    onClick={async () => {
                      setOcupado(c.id);
                      setErro(null);
                      const res = await resolverConflito(c.id, r);
                      setOcupado(null);
                      if (!res.ok) return setErro(res.erro);
                      router.refresh();
                    }}
                    className={`rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60 ${r === "usar_planilha" ? "bg-neutral-900 text-white" : "border border-neutral-300 bg-white"}`}
                  >
                    {r === "usar_planilha" ? "Usar a planilha" : "Manter o manual"}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-amber-900">Aguardando decisão do administrador. Enquanto isso, vale o lançamento manual.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Admin: link da planilha do mês. */
export function ConfigPlanilha({ competencia, url, emailServico }: { competencia: string; url: string; emailServico: string | null }) {
  const router = useRouter();
  const [valor, setValor] = useState(url);
  const [msg, setMsg] = useState<{ texto: string; erro?: boolean } | null>(null);
  return (
    <div className="space-y-2">
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Link da planilha do mês</span>
        <input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2" />
      </label>
      <p className="text-xs text-neutral-600">
        Compartilhe a planilha como <strong>Leitor</strong> com: <code className="rounded bg-neutral-100 px-1 py-0.5 break-all">{emailServico ?? "(conta de serviço não configurada)"}</code>. Se o mês não tiver link, vale o do mês anterior.
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={async () => {
            setMsg(null);
            const r = await salvarPlanilhaDoMes(competencia, valor);
            setMsg(r.ok ? { texto: "Salvo." } : { texto: r.erro, erro: true });
            if (r.ok) router.refresh();
          }}
          className="rounded-lg bg-neutral-900 px-3 py-2 text-sm font-semibold text-white"
        >
          Salvar link
        </button>
        {msg && <span className={`text-sm ${msg.erro ? "text-red-700" : "text-green-700"}`}>{msg.texto}</span>}
      </div>
    </div>
  );
}
