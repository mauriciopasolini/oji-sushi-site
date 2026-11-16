"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { fecharMes, reabrirMes, salvarErp } from "./actions";

const btn = "rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50";

export function FormErp({ competencia, valorInicial, bloqueado }: { competencia: string; valorInicial: string; bloqueado: boolean }) {
  const router = useRouter();
  const [valor, setValor] = useState(valorInicial);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [pendente, iniciar] = useTransition();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setErro(null);
        setSalvo(false);
        iniciar(async () => {
          const r = await salvarErp(competencia, valor);
          if (!r.ok) return setErro(r.erro);
          setSalvo(true);
          router.refresh();
        });
      }}
    >
      <label className="block">
        <span className="mb-1 block text-sm text-neutral-600">Total ERP + delivery (R$)</span>
        <input
          value={valor}
          onChange={(e) => {
            setValor(e.target.value);
            setSalvo(false);
          }}
          inputMode="decimal"
          placeholder="ex.: 87.953,44"
          disabled={bloqueado}
          className="w-48 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-right text-base tabular-nums disabled:bg-neutral-100"
        />
      </label>
      {!bloqueado && (
        <button disabled={pendente || valor === valorInicial} className={`${btn} bg-neutral-900 text-white`}>
          {pendente ? "Salvando…" : "Salvar"}
        </button>
      )}
      {salvo && <span className="pb-2 text-sm text-green-700">Salvo.</span>}
      {erro && (
        <p role="alert" className="w-full text-sm text-red-700">
          {erro}
        </p>
      )}
    </form>
  );
}

export function FecharMes({ competencia, nome, pronto }: { competencia: string; nome: string; pronto: boolean }) {
  const router = useRouter();
  const [confirmar, setConfirmar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  return (
    <div className="space-y-2">
      {!confirmar ? (
        <button type="button" disabled={!pronto} onClick={() => setConfirmar(true)} className={`${btn} bg-neutral-900 text-white`}>
          Fechar mês
        </button>
      ) : (
        <div className="space-y-2 rounded-xl border border-neutral-300 bg-neutral-50 p-3 text-sm">
          <p>
            Fechar <strong>{nome}</strong>? Notas, contagem e vendas do mês ficam travadas, e o relatório passa a sair do snapshot gravado agora. Para mexer depois, é preciso
            reabrir o mês com um motivo.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pendente}
              onClick={() =>
                iniciar(async () => {
                  setErro(null);
                  const r = await fecharMes(competencia);
                  if (!r.ok) return setErro(r.erro);
                  setConfirmar(false);
                  router.refresh();
                })
              }
              className={`${btn} bg-neutral-900 text-white`}
            >
              {pendente ? "Fechando…" : "Confirmar e fechar"}
            </button>
            <button type="button" onClick={() => setConfirmar(false)} className={`${btn} border border-neutral-300`}>
              Voltar
            </button>
          </div>
        </div>
      )}
      {!pronto && <p className="text-sm text-neutral-600">O botão libera quando todos os itens do checklist estiverem ok.</p>}
      {erro && (
        <p role="alert" className="text-sm text-red-700">
          {erro}
        </p>
      )}
    </div>
  );
}

export function ReabrirMes({ competencia }: { competencia: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  if (!aberto)
    return (
      <button type="button" onClick={() => setAberto(true)} className={`${btn} border border-neutral-300`}>
        Reabrir mês
      </button>
    );
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        iniciar(async () => {
          setErro(null);
          const r = await reabrirMes(competencia, motivo);
          if (!r.ok) return setErro(r.erro);
          setAberto(false);
          router.refresh();
        });
      }}
    >
      <label className="block">
        <span className="mb-1 block text-sm text-neutral-600">Motivo da reabertura (fica na auditoria)</span>
        <input value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base" />
      </label>
      <div className="flex gap-2">
        <button disabled={pendente || motivo.trim().length < 5} className={`${btn} bg-neutral-900 text-white`}>
          {pendente ? "Reabrindo…" : "Reabrir"}
        </button>
        <button type="button" onClick={() => setAberto(false)} className={`${btn} border border-neutral-300`}>
          Cancelar
        </button>
      </div>
      {erro && (
        <p role="alert" className="text-sm text-red-700">
          {erro}
        </p>
      )}
    </form>
  );
}
