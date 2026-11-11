"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { UNIDADES } from "@/lib/cmv/contagem";
import { centavos, formatarBRL } from "@/lib/cmv/dinheiro";
import { type DadosItem, definirItemAtivo, salvarItem } from "../actions";

export type ItemCadastro = {
  id: string;
  nome: string;
  unidade: string;
  categoria_id: string;
  custo_unitario_ref: number | null;
  ordem: number;
  ativo: boolean;
};
type Opcao = { id: string; nome: string };

const campo = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base";
const botao = "rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const paraCampo = (c: number | null) => (c === null ? "" : (centavos(c) / 100).toFixed(2).replace(".", ","));

function FormItem({ inicial, categorias, rotulo, onSalvar, onCancelar }: { inicial: DadosItem; categorias: Opcao[]; rotulo: string; onSalvar: (d: DadosItem) => Promise<string | null>; onCancelar?: () => void }) {
  const [d, setD] = useState(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const set = (k: keyof DadosItem) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD({ ...d, [k]: e.target.value });
  return (
    <form
      className="grid grid-cols-2 gap-2 sm:grid-cols-6"
      onSubmit={async (e) => {
        e.preventDefault();
        setEnviando(true);
        setErro(null);
        const r = await onSalvar(d);
        setEnviando(false);
        if (r) setErro(r);
        else if (!onCancelar) setD({ ...inicial, categoria_id: d.categoria_id, unidade: d.unidade });
      }}
    >
      <label className="col-span-2">
        <span className="mb-1 block text-xs text-neutral-600">Nome</span>
        <input value={d.nome} onChange={set("nome")} className={campo} required placeholder="Ex.: Salmão" />
      </label>
      <label>
        <span className="mb-1 block text-xs text-neutral-600">Unidade</span>
        <select value={d.unidade} onChange={set("unidade")} className={campo}>
          {UNIDADES.map((u) => (
            <option key={u.valor} value={u.valor}>
              {u.rotulo}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="mb-1 block text-xs text-neutral-600">Categoria</span>
        <select value={d.categoria_id} onChange={set("categoria_id")} className={campo} required>
          <option value="" disabled>
            Escolha…
          </option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="mb-1 block text-xs text-neutral-600">Custo de referência (R$)</span>
        <input value={d.custo_ref} onChange={set("custo_ref")} inputMode="decimal" placeholder="opcional" className={campo} />
      </label>
      <label>
        <span className="mb-1 block text-xs text-neutral-600">Ordem</span>
        <input value={d.ordem} onChange={set("ordem")} inputMode="numeric" placeholder="0" className={campo} />
      </label>
      {erro && (
        <p role="alert" className="col-span-2 text-sm text-red-700 sm:col-span-6">
          {erro}
        </p>
      )}
      <div className="col-span-2 flex gap-2 sm:col-span-6">
        <button disabled={enviando} className={`${botao} bg-neutral-900 text-white`}>
          {rotulo}
        </button>
        {onCancelar && (
          <button type="button" onClick={onCancelar} className={`${botao} border border-neutral-300`}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}

function LinhaItem({ item, categorias }: { item: ItemCadastro; categorias: Opcao[] }) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  if (editando) {
    return (
      <li className="px-4 py-3">
        <FormItem
          rotulo="Salvar"
          categorias={categorias}
          inicial={{ nome: item.nome, unidade: item.unidade, categoria_id: item.categoria_id, custo_ref: paraCampo(item.custo_unitario_ref), ordem: String(item.ordem) }}
          onCancelar={() => setEditando(false)}
          onSalvar={async (d) => {
            const r = await salvarItem(item.id, d);
            if (!r.ok) return r.erro;
            setEditando(false);
            router.refresh();
            return null;
          }}
        />
      </li>
    );
  }
  return (
    <li className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 ${item.ativo ? "" : "text-neutral-400"}`}>
      <div>
        <p className="font-medium">
          {item.nome} <span className="text-sm font-normal text-neutral-500">({item.unidade})</span>
          {!item.ativo && <span className="ml-1.5 rounded bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-700">inativo</span>}
        </p>
        <p className="text-xs text-neutral-500">
          ordem {item.ordem} · referência {item.custo_unitario_ref === null ? "—" : formatarBRL(centavos(item.custo_unitario_ref))}
        </p>
      </div>
      <div className="flex gap-1.5">
        <button type="button" onClick={() => setEditando(true)} className={`${botao} border border-neutral-300`}>
          Editar
        </button>
        <button
          type="button"
          onClick={async () => {
            setErro(null);
            const r = await definirItemAtivo(item.id, !item.ativo);
            if (!r.ok) return setErro(r.erro);
            router.refresh();
          }}
          className={`${botao} border ${item.ativo ? "border-red-300 text-red-700" : "border-neutral-300"}`}
        >
          {item.ativo ? "Desativar" : "Reativar"}
        </button>
      </div>
      {erro && <p className="w-full text-sm text-red-700">{erro}</p>}
    </li>
  );
}

export function EditorItens({ itens, categorias }: { itens: ItemCadastro[]; categorias: Opcao[] }) {
  const router = useRouter();
  const [ok, setOk] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-neutral-200 bg-white p-4">
        <h2 className="mb-2 font-semibold">Novo item</h2>
        <FormItem
          rotulo="Adicionar"
          categorias={categorias}
          inicial={{ nome: "", unidade: "kg", categoria_id: categorias[0]?.id ?? "", custo_ref: "", ordem: "" }}
          onSalvar={async (d) => {
            setOk(null);
            const r = await salvarItem(null, d);
            if (!r.ok) return r.erro;
            setOk(`“${d.nome.trim()}” adicionado.`);
            router.refresh();
            return null;
          }}
        />
        {ok && <p className="mt-2 text-sm text-green-700">{ok}</p>}
      </section>

      {categorias.map((c) => {
        const daCat = itens.filter((i) => i.categoria_id === c.id);
        return (
          <section key={c.id}>
            <h2 className="mb-1.5 font-semibold">
              {c.nome} <span className="text-sm font-normal text-neutral-500">({daCat.filter((i) => i.ativo).length} ativos)</span>
            </h2>
            <ul className="divide-y divide-neutral-100 rounded-2xl border border-neutral-200 bg-white">
              {daCat.map((i) => (
                <LinhaItem key={i.id} item={i} categorias={categorias} />
              ))}
              {!daCat.length && <li className="px-4 py-3 text-sm text-neutral-500">Nenhum item.</li>}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
