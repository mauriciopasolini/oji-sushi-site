"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { type DadosFornecedor, definirAtivo, marcarRevisado, mesclarFornecedores, salvarFornecedor } from "./actions";

export type FornecedorLinha = {
  id: string;
  nome: string;
  cnpj: string | null;
  categoria_padrao_id: string;
  prazo_vencimento_dias: number | null;
  ativo: boolean;
  revisado_em: string | null;
  criado_em: string;
  mesclado_em_id: string | null;
  categoriaNome: string;
  notasMes: number;
  notasTotal: number;
  criadoPorNome: string | null;
  mescladoEmNome: string | null;
};

type Opcao = { id: string; nome: string };

const cnpjFormatado = (c: string | null) => (c && c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : (c ?? "—"));
const campo = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base";
const botao = "rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50";

function Formulario({
  inicial,
  categorias,
  onSalvar,
  onCancelar,
  rotulo,
}: {
  inicial: DadosFornecedor;
  categorias: Opcao[];
  onSalvar: (d: DadosFornecedor) => Promise<string | null>;
  onCancelar: () => void;
  rotulo: string;
}) {
  const [d, setD] = useState(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const set = (k: keyof DadosFornecedor) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD({ ...d, [k]: e.target.value });

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setEnviando(true);
        setErro(null);
        const r = await onSalvar(d);
        setEnviando(false);
        if (r) setErro(r);
      }}
    >
      <label className="block sm:col-span-2">
        <span className="mb-1 block text-sm text-neutral-600">Nome</span>
        <input value={d.nome} onChange={set("nome")} className={campo} required autoFocus />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-neutral-600">Categoria padrão</span>
        <select value={d.categoria_padrao_id} onChange={set("categoria_padrao_id")} className={campo} required>
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
      <label className="block">
        <span className="mb-1 block text-sm text-neutral-600">Prazo de vencimento (dias)</span>
        <input value={d.prazo_vencimento_dias} onChange={set("prazo_vencimento_dias")} inputMode="numeric" placeholder="vazio = paga no ato" className={campo} />
      </label>
      <label className="block sm:col-span-2">
        <span className="mb-1 block text-sm text-neutral-600">CNPJ</span>
        <input value={d.cnpj} onChange={set("cnpj")} inputMode="numeric" placeholder="00.000.000/0000-00" className={campo} />
      </label>
      {erro && (
        <p role="alert" className="text-sm text-red-700 sm:col-span-2">
          {erro}
        </p>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <button disabled={enviando} className={`${botao} bg-neutral-900 text-white`}>
          {rotulo}
        </button>
        <button type="button" onClick={onCancelar} className={`${botao} border border-neutral-300`}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function NovoFornecedor({ categorias }: { categorias: Opcao[] }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} className="rounded-xl bg-neutral-900 px-4 py-2 font-semibold text-white">
        + Novo fornecedor
      </button>
    );
  }
  return (
    <div className="w-full rounded-2xl border border-neutral-200 bg-white p-4">
      <h2 className="mb-3 font-semibold">Novo fornecedor</h2>
      <Formulario
        rotulo="Cadastrar"
        inicial={{ nome: "", categoria_padrao_id: "", prazo_vencimento_dias: "", cnpj: "" }}
        categorias={categorias}
        onCancelar={() => setAberto(false)}
        onSalvar={async (d) => {
          const r = await salvarFornecedor(null, d);
          if (!r.ok) return r.erro;
          setAberto(false);
          router.refresh();
          return null;
        }}
      />
    </div>
  );
}

export function LinhaFornecedor({ f, categorias, outros, rotuloMes, mes }: { f: FornecedorLinha; categorias: Opcao[]; outros: Opcao[]; rotuloMes: string; mes: string }) {
  const router = useRouter();
  const [modo, setModo] = useState<"ver" | "editar" | "mesclar">("ver");
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [outro, setOutro] = useState("");
  const [fica, setFica] = useState<"este" | "outro">("outro");
  const [confirmando, setConfirmando] = useState(false);
  const novo = f.revisado_em === null;

  async function executar(fn: () => Promise<{ ok: true } | { ok: false; erro: string }>, msgOk?: string) {
    setEnviando(true);
    setErro(null);
    setOk(null);
    const r = await fn();
    setEnviando(false);
    if (!r.ok) return setErro(r.erro);
    if (msgOk) setOk(msgOk);
    router.refresh();
  }

  const nomeOutro = outros.find((o) => o.id === outro)?.nome ?? "";
  const [manter, remover] = fica === "este" ? [f.id, outro] : [outro, f.id];
  const nomeManter = fica === "este" ? f.nome : nomeOutro;
  const nomeRemover = fica === "este" ? nomeOutro : f.nome;

  return (
    <li className={`px-4 py-3 ${novo ? "bg-amber-50/60" : ""} ${!f.ativo ? "text-neutral-500" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">
            {f.nome}
            {novo && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">novo</span>}
            {!f.ativo && <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-xs font-medium text-neutral-700">{f.mesclado_em_id ? "mesclado" : "inativo"}</span>}
          </p>
          <p className="text-sm text-neutral-600">
            {f.categoriaNome} · prazo {f.prazo_vencimento_dias === null ? "—" : `${f.prazo_vencimento_dias} dias`} · CNPJ {cnpjFormatado(f.cnpj)}
          </p>
          <p className="text-xs text-neutral-500">
            <Link href={`/painel/cmv/notas?fornecedor=${f.id}&mes=${mes}`} className="underline-offset-2 hover:underline">
              {f.notasMes} nota(s) em {rotuloMes}
            </Link>
            {f.notasTotal !== f.notasMes && <> ({f.notasTotal} no total)</>}
            {novo && f.criadoPorNome && <> · cadastrado por {f.criadoPorNome}</>}
            {f.mescladoEmNome && <> · mesclado em “{f.mescladoEmNome}”</>}
          </p>
        </div>
        {modo === "ver" && !f.mesclado_em_id && (
          <div className="flex flex-wrap gap-1.5">
            {novo && (
              <button type="button" disabled={enviando} onClick={() => executar(() => marcarRevisado(f.id).then((r) => (r.ok ? { ok: true } : r)))} className={`${botao} bg-amber-600 text-white`}>
                Marcar como revisado
              </button>
            )}
            <button type="button" onClick={() => setModo("editar")} className={`${botao} border border-neutral-300 bg-white`}>
              Editar
            </button>
            {f.ativo && outros.length > 0 && (
              <button type="button" onClick={() => setModo("mesclar")} className={`${botao} border border-neutral-300 bg-white`}>
                Mesclar
              </button>
            )}
            <button
              type="button"
              disabled={enviando}
              onClick={() => executar(() => definirAtivo(f.id, !f.ativo).then((r) => (r.ok ? { ok: true } : r)))}
              className={`${botao} border ${f.ativo ? "border-red-300 text-red-700" : "border-neutral-300"} bg-white`}
            >
              {f.ativo ? "Desativar" : "Reativar"}
            </button>
          </div>
        )}
      </div>

      {modo === "editar" && (
        <div className="mt-3 rounded-xl border border-neutral-200 bg-white p-3">
          <Formulario
            rotulo="Salvar"
            inicial={{ nome: f.nome, categoria_padrao_id: f.categoria_padrao_id, prazo_vencimento_dias: f.prazo_vencimento_dias?.toString() ?? "", cnpj: f.cnpj ?? "" }}
            categorias={categorias}
            onCancelar={() => setModo("ver")}
            onSalvar={async (d) => {
              const r = await salvarFornecedor(f.id, d);
              if (!r.ok) return r.erro;
              setModo("ver");
              setOk("Alterações salvas.");
              router.refresh();
              return null;
            }}
          />
          <p className="mt-2 text-xs text-neutral-500">Mudar a categoria padrão não altera as notas já lançadas.</p>
        </div>
      )}

      {modo === "mesclar" && (
        <div className="mt-3 space-y-3 rounded-xl border border-neutral-300 bg-white p-3">
          <label className="block">
            <span className="mb-1 block text-sm text-neutral-600">Mesclar “{f.nome}” com</span>
            <select
              value={outro}
              onChange={(e) => {
                setOutro(e.target.value);
                setConfirmando(false);
              }}
              className={campo}
            >
              <option value="">Escolha o outro fornecedor…</option>
              {outros.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nome}
                </option>
              ))}
            </select>
          </label>
          {outro && (
            <fieldset className="space-y-1 text-sm">
              <legend className="mb-1 text-neutral-600">Qual fica?</legend>
              <label className="flex items-center gap-2">
                <input type="radio" checked={fica === "outro"} onChange={() => { setFica("outro"); setConfirmando(false); }} /> {nomeOutro}
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={fica === "este"} onChange={() => { setFica("este"); setConfirmando(false); }} /> {f.nome}
              </label>
            </fieldset>
          )}
          {outro && confirmando && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">
              As notas de <strong>{nomeRemover}</strong> em meses abertos passam para <strong>{nomeManter}</strong>, mantendo a conferência.{" "}
              <strong>{nomeRemover}</strong> será desativado. Isso não pode ser desfeito pela tela. Confirma?
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {!confirmando ? (
              <button type="button" disabled={!outro} onClick={() => setConfirmando(true)} className={`${botao} bg-neutral-900 text-white`}>
                Mesclar…
              </button>
            ) : (
              <button
                type="button"
                disabled={enviando}
                onClick={async () => {
                  setEnviando(true);
                  setErro(null);
                  const r = await mesclarFornecedores(manter, remover);
                  setEnviando(false);
                  if (!r.ok) return setErro(r.erro);
                  setModo("ver");
                  setConfirmando(false);
                  setOk(
                    `Mesclado: ${r.dados.movidas} nota(s) passaram para “${nomeManter}”` +
                      (r.dados.emMesFechado ? `; ${r.dados.emMesFechado} de meses fechados ficaram em “${nomeRemover}”.` : "."),
                  );
                  router.refresh();
                }}
                className={`${botao} bg-red-700 text-white`}
              >
                Confirmar mescla
              </button>
            )}
            <button type="button" onClick={() => { setModo("ver"); setConfirmando(false); }} className={`${botao} border border-neutral-300`}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {erro && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {erro}
        </p>
      )}
      {ok && <p className="mt-2 text-sm text-green-700">{ok}</p>}
    </li>
  );
}
