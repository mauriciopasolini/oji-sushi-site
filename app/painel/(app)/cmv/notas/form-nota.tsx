"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { somarDias } from "@/lib/cmv/datas";
import { centavos, formatarBRL } from "@/lib/cmv/dinheiro";
import { ErroArquivo, caminhoFoto, prepararArquivo } from "@/lib/cmv/imagem";
import { type TipoDocumento, padroesDoFornecedor } from "@/lib/cmv/padroes-fornecedor";
import { FORMAS_PAGAMENTO, type FormaPagamento, TIPOS_NOTA, type TipoNota } from "@/lib/cmv/tipos";
import { createClient } from "@/lib/supabase/client";
import { type NotaParecida, criarFornecedor, criarNota, editarNota, verificarDuplicidade } from "./actions";

export type OpcaoFornecedor = {
  id: string;
  nome: string;
  categoriaId: string;
  prazo: number | null;
  tipoPadrao: TipoDocumento | null;
  formaPadrao: FormaPagamento | null;
  novo: boolean;
};
export type OpcaoCategoria = { id: string; nome: string };

export type NotaInicial = {
  id: string;
  dataEmissao: string;
  fornecedorId: string;
  categoriaId: string;
  valor: string | number; // numeric do banco
  fotoPath: string;
  fotoUrl: string | null;
  tipo: TipoNota;
  numero: string;
  vencimento: string;
  formaPagamento: FormaPagamento;
  descricao: string;
  observacao: string;
};

type Props = {
  modo: "criar" | "editar";
  hoje: string;
  fornecedores: OpcaoFornecedor[];
  maisUsados: string[];
  categorias: OpcaoCategoria[];
  fornecedorInicialId?: string;
  inicial?: NotaInicial;
  /** edição aberta pelo botão "A nota fiscal chegou" de uma compra sem nota */
  converterSemNota?: boolean;
};

const campo =
  "w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-base outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10";
const rotulo = "mb-1 block text-sm font-medium text-neutral-700";

/** "1234.5" (banco) → "1.234,50" (tela) */
function decimalParaTela(v: string | number) {
  return formatarBRL(centavos(v)).replace(/^R\$\s?/, "").trim();
}

const dataBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

export function FormNota({ modo, hoje, fornecedores: fornecedoresIniciais, maisUsados, categorias, fornecedorInicialId, inicial, converterSemNota = false }: Props) {
  const router = useRouter();
  const [fornecedores, setFornecedores] = useState(fornecedoresIniciais);
  const porId = useMemo(() => new Map(fornecedores.map((f) => [f.id, f])), [fornecedores]);

  const [id] = useState(() => inicial?.id ?? crypto.randomUUID());
  const [fornecedorId, setFornecedorId] = useState(inicial?.fornecedorId ?? fornecedorInicialId ?? "");
  const [categoriaId, setCategoriaId] = useState(
    inicial?.categoriaId ?? (fornecedorInicialId ? porId.get(fornecedorInicialId)?.categoriaId ?? "" : ""),
  );
  const [valor, setValor] = useState(inicial ? decimalParaTela(inicial.valor) : "");
  const [dataEmissao, setDataEmissao] = useState(inicial?.dataEmissao ?? hoje);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const eraSemNota = inicial?.tipo === "sem_nota";
  const [detalhesAbertos, setDetalhesAbertos] = useState(modo === "editar");
  const [tipo, setTipo] = useState<TipoNota>(converterSemNota && eraSemNota ? "nfe" : inicial?.tipo ?? "nfe");
  // Na edição o tipo gravado vale; na conversão de "sem nota", o padrão do fornecedor sugere o tipo.
  const [tipoTocado, setTipoTocado] = useState(modo === "editar" && !(converterSemNota && eraSemNota));
  const semNota = tipo === "sem_nota";
  const convertendo = eraSemNota && !semNota;
  const [numero, setNumero] = useState(inicial?.numero ?? "");
  const [vencimento, setVencimento] = useState(inicial?.vencimento ?? "");
  const [vencimentoTocado, setVencimentoTocado] = useState(modo === "editar");
  const [forma, setForma] = useState<FormaPagamento>(inicial?.formaPagamento ?? "boleto");
  const [formaTocada, setFormaTocada] = useState(modo === "editar");
  const [descricao, setDescricao] = useState(inicial?.descricao ?? "");
  const [observacao, setObservacao] = useState(inicial?.observacao ?? "");
  const [motivo, setMotivo] = useState(converterSemNota && eraSemNota ? "Nota fiscal recebida" : "");
  const [parecida, setParecida] = useState<NotaParecida | null>(null);
  const duplicidadeConfirmada = useRef(false); // "É outra compra, salvar"

  const [busca, setBusca] = useState("");
  const [trocandoFornecedor, setTrocandoFornecedor] = useState(!fornecedorId);
  const [novoForn, setNovoForn] = useState<{ nome: string; categoriaId: string } | null>(null);

  const [etapa, setEtapa] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const fotoEnviada = useRef<string | null>(null); // evita reenviar a foto ao tentar de novo
  const valorRef = useRef<HTMLInputElement>(null);

  const fornecedor = fornecedorId ? porId.get(fornecedorId) : undefined;
  const categoriaFora = Boolean(fornecedor && categoriaId && fornecedor.categoriaId !== categoriaId);

  const padrao = fornecedor ? padroesDoFornecedor(fornecedor) : null;

  // Padrões que dependem do fornecedor e da data (até o usuário mexer).
  useEffect(() => {
    if (!fornecedor) return;
    const p = padroesDoFornecedor(fornecedor);
    if (!formaTocada) setForma(p.forma);
    if (!tipoTocado) setTipo((t) => (t === "sem_nota" ? t : p.tipo));
    if (!vencimentoTocado) setVencimento(fornecedor.prazo !== null && dataEmissao ? somarDias(dataEmissao, fornecedor.prazo) : "");
  }, [fornecedor, dataEmissao, formaTocada, vencimentoTocado, tipoTocado]);

  useEffect(() => {
    if (!arquivo || arquivo.type === "application/pdf") return setPreview(null);
    const url = URL.createObjectURL(arquivo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [arquivo]);

  function escolherFornecedor(f: OpcaoFornecedor) {
    setFornecedorId(f.id);
    setCategoriaId(f.categoriaId); // a categoria vem do fornecedor (editável só para esta nota)
    setTrocandoFornecedor(false);
    setBusca("");
    setNovoForn(null);
    setTimeout(() => valorRef.current?.focus(), 50);
  }

  const rapidos = useMemo(() => {
    const ids = [...maisUsados.filter((x) => porId.has(x))];
    for (const f of fornecedores) if (ids.length < 5 && !ids.includes(f.id)) ids.push(f.id);
    return ids.slice(0, 5).map((x) => porId.get(x)!);
  }, [maisUsados, fornecedores, porId]);

  const resultadosBusca = useMemo(() => {
    const q = busca.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
    if (!q) return [];
    return fornecedores
      .filter((f) => f.nome.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").includes(q))
      .slice(0, 8);
  }, [busca, fornecedores]);

  async function salvarNovoFornecedor() {
    if (!novoForn) return;
    setErro(null);
    setEtapa("Cadastrando fornecedor…");
    const r = await criarFornecedor(novoForn.nome, novoForn.categoriaId);
    setEtapa(null);
    if (!r.ok) return setErro(r.erro);
    const f: OpcaoFornecedor = { id: r.dados.id, nome: r.dados.nome, categoriaId: novoForn.categoriaId, prazo: null, tipoPadrao: null, formaPadrao: null, novo: true };
    setFornecedores((xs) => [...xs, f].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
    escolherFornecedor(f);
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setParecida(null);

    let c = 0;
    try {
      c = centavos(valor);
    } catch {
      /* tratado abaixo */
    }
    if (!fornecedorId) return setErro("Escolha o fornecedor.");
    if (!categoriaId) return setErro("Escolha a categoria.");
    if (c <= 0) return setErro("Informe o valor da nota.");
    if (modo === "criar" && !arquivo) return setErro("Tire a foto da nota (obrigatória).");
    if (modo === "editar" && !motivo.trim()) return setErro("Informe o motivo da edição.");
    if (semNota && !observacao.trim()) return setErro("Compra sem nota: escreva uma observação (o que chegou e por que veio sem nota).");
    if (convertendo && !arquivo) return setErro("A nota fiscal chegou: tire a foto da nota fiscal (a foto anterior fica no histórico).");
    if (convertendo && (tipo === "nfe" || tipo === "cupom") && !numero.trim()) return setErro("Informe o número da nota fiscal.");

    try {
      // Possível duplicidade: só ao criar, ou ao editar fornecedor/valor/data.
      const mudouChave =
        modo === "criar" ||
        fornecedorId !== inicial?.fornecedorId ||
        dataEmissao !== inicial?.dataEmissao ||
        c !== centavos(inicial?.valor ?? 0);
      if (mudouChave && !duplicidadeConfirmada.current) {
        setEtapa("Conferindo notas parecidas…");
        const dup = await verificarDuplicidade({ id, fornecedor_id: fornecedorId, data_emissao: dataEmissao, valor });
        if (dup.ok && dup.dados.parecida) {
          setEtapa(null);
          setParecida(dup.dados.parecida);
          return;
        }
      }

      let fotoPath = inicial?.fotoPath ?? "";
      if (arquivo) {
        if (fotoEnviada.current) {
          fotoPath = fotoEnviada.current;
        } else {
          setEtapa("Preparando a foto…");
          const preparado = await prepararArquivo(arquivo);
          // Nota nova: AAAA/MM/<id_da_nota>.ext. Foto substituída: novo nome, a antiga fica guardada.
          const nomeArquivo = modo === "criar" ? id : crypto.randomUUID();
          fotoPath = caminhoFoto(dataEmissao, nomeArquivo, preparado.extensao);
          setEtapa("Enviando a foto…");
          const { error } = await createClient()
            .storage.from("notas")
            .upload(fotoPath, preparado.blob, { contentType: preparado.tipo, upsert: true, cacheControl: "3600" });
          if (error) {
            throw new Error(
              /row-level security|unauthorized|403/i.test(error.message)
                ? "Não foi possível enviar a foto: o mês pode estar fechado."
                : `Falha ao enviar a foto: ${error.message}`,
            );
          }
          fotoEnviada.current = fotoPath;
        }
      }

      setEtapa("Salvando a nota…");
      const dados = {
        id,
        data_emissao: dataEmissao,
        fornecedor_id: fornecedorId,
        categoria_id: categoriaId,
        valor,
        foto_path: fotoPath,
        tipo,
        numero,
        vencimento,
        forma_pagamento: forma,
        descricao,
        observacao,
      };
      const r = modo === "criar" ? await criarNota(dados) : await editarNota({ ...dados, motivo });
      if (!r.ok) throw new Error(r.erro);

      setEtapa("Pronto!");
      duplicidadeConfirmada.current = false;
      router.push(modo === "criar" ? `/painel/cmv?nota=${id}` : `/painel/cmv/notas/${id}?editada=1`);
      router.refresh();
    } catch (err) {
      setEtapa(null);
      setErro(err instanceof ErroArquivo || err instanceof Error ? err.message : "Erro inesperado.");
    }
  }

  const ocupado = etapa !== null;

  return (
    <form id="form-nota" onSubmit={salvar} className="space-y-6 pb-28">
      {eraSemNota && (
        <div className={`rounded-xl border p-3 text-sm ${convertendo ? "border-blue-200 bg-blue-50 text-blue-950" : "border-amber-300 bg-amber-50 text-amber-950"}`}>
          {convertendo ? (
            <>
              <p className="font-semibold">A nota fiscal chegou</p>
              <p className="mt-0.5">
                Tire a foto da nota fiscal (a foto anterior fica no histórico), preencha o número e ajuste o valor, se mudou. A data define a semana do
                orçamento: mantenha a data de chegada, a menos que esteja errada.
              </p>
            </>
          ) : (
            <p>
              <strong>Compra aguardando nota fiscal.</strong> Quando a nota chegar, desmarque “chegou sem nota fiscal” e preencha os dados da nota.
            </p>
          )}
        </div>
      )}
      {/* 1. Fornecedor */}
      <section>
        <h2 className={rotulo}>1. Fornecedor</h2>
        {fornecedor && !trocandoFornecedor ? (
          <div className="flex items-center justify-between rounded-xl border border-neutral-300 bg-white px-4 py-3">
            <span className="text-lg font-semibold">
              {fornecedor.nome}
              {fornecedor.novo && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">novo</span>}
            </span>
            <button type="button" onClick={() => setTrocandoFornecedor(true)} className="text-sm font-medium text-neutral-600 underline">
              trocar
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {rapidos.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => escolherFornecedor(f)}
                  className={`rounded-xl border px-3 py-3 text-left font-medium active:scale-[.98] ${
                    f.id === fornecedorId ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white"
                  }`}
                >
                  {f.nome}
                </button>
              ))}
            </div>
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar outro fornecedor…"
              className={campo}
              aria-label="Buscar fornecedor"
            />
            {busca.trim() && (
              <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white">
                {resultadosBusca.map((f) => (
                  <li key={f.id}>
                    <button type="button" onClick={() => escolherFornecedor(f)} className="w-full px-4 py-3 text-left">
                      {f.nome}
                    </button>
                  </li>
                ))}
                {!novoForn && (
                  <li>
                    <button
                      type="button"
                      onClick={() => setNovoForn({ nome: busca.trim(), categoriaId: "" })}
                      className="w-full px-4 py-3 text-left font-medium text-red-700"
                    >
                      + Cadastrar “{busca.trim()}”
                    </button>
                  </li>
                )}
              </ul>
            )}
            {novoForn && (
              <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
                <p className="text-sm font-medium text-amber-900">Novo fornecedor (o administrador revisa depois)</p>
                <input
                  value={novoForn.nome}
                  onChange={(e) => setNovoForn({ ...novoForn, nome: e.target.value })}
                  className={campo}
                  aria-label="Nome do fornecedor"
                />
                <select
                  value={novoForn.categoriaId}
                  onChange={(e) => setNovoForn({ ...novoForn, categoriaId: e.target.value })}
                  className={campo}
                  aria-label="Categoria do fornecedor"
                >
                  <option value="">Categoria…</option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={ocupado || novoForn.nome.trim().length < 2 || !novoForn.categoriaId}
                    onClick={salvarNovoFornecedor}
                    className="flex-1 rounded-xl bg-neutral-900 px-3 py-2.5 font-semibold text-white disabled:opacity-50"
                  >
                    Cadastrar
                  </button>
                  <button type="button" onClick={() => setNovoForn(null)} className="rounded-xl border border-neutral-300 px-3 py-2.5">
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 2. Valor */}
      <section>
        <label htmlFor="valor" className={rotulo}>
          2. Valor
        </label>
        <div className="flex items-center rounded-xl border border-neutral-300 bg-white px-4 focus-within:border-neutral-900 focus-within:ring-2 focus-within:ring-neutral-900/10">
          <span className="text-2xl text-neutral-400">R$</span>
          <input
            id="valor"
            ref={valorRef}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            value={valor}
            onChange={(e) => setValor(e.target.value.replace(/[^\d.,]/g, ""))}
            onBlur={() => {
              try {
                const c = centavos(valor);
                if (c > 0) setValor(decimalParaTela((c / 100).toFixed(2)));
              } catch {
                /* deixa como está; a validação avisa */
              }
            }}
            className="w-full bg-transparent px-2 py-3 text-3xl font-bold tabular-nums outline-none"
          />
        </div>
      </section>

      {/* 3. Foto */}
      <section>
        <h2 className={rotulo}>
          {semNota
            ? `3. Foto do romaneio, pedido, recibo ou da mercadoria ${modo === "criar" ? "(obrigatória)" : "(opcional: substitui a atual)"}`
            : `3. Foto da nota ${modo === "criar" ? "(obrigatória)" : convertendo ? "fiscal (obrigatória)" : "(opcional: substitui a atual)"}`}
        </h2>
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Prévia da nota" className="mb-3 max-h-72 w-full rounded-xl border border-neutral-200 object-contain bg-white" />
        ) : arquivo ? (
          <p className="mb-3 rounded-xl border border-neutral-200 bg-white px-4 py-3">📄 {arquivo.name}</p>
        ) : inicial?.fotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={inicial.fotoUrl} alt="Foto atual da nota" className="mb-3 max-h-72 w-full rounded-xl border border-neutral-200 object-contain bg-white" />
        ) : null}
        <div className="flex gap-2">
          <label className="flex flex-1 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-neutral-400 bg-white px-4 py-4 font-semibold">
            {arquivo ? "Tirar outra foto" : "Tirar foto"}
            <input
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              className="sr-only"
              onChange={(e) => {
                setArquivo(e.target.files?.[0] ?? null);
                fotoEnviada.current = null;
              }}
            />
          </label>
          <label className="flex cursor-pointer items-center justify-center rounded-xl border border-neutral-300 bg-white px-4 py-4 text-sm">
            Arquivo / PDF
            <input
              type="file"
              accept="image/*,application/pdf"
              className="sr-only"
              onChange={(e) => {
                setArquivo(e.target.files?.[0] ?? null);
                fotoEnviada.current = null;
              }}
            />
          </label>
        </div>
      </section>

      {(modo === "criar" || eraSemNota) && (
        <section className={`rounded-xl border p-3 ${semNota ? "border-amber-300 bg-amber-50" : "border-neutral-200 bg-white"}`}>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={semNota}
              onChange={(e) => {
                setTipo(e.target.checked ? "sem_nota" : (padrao?.tipo ?? "nfe"));
                if (!e.target.checked && eraSemNota) setDetalhesAbertos(true);
              }}
              className="mt-1 h-5 w-5 accent-amber-600"
            />
            <span>
              <span className="font-medium">Mercadoria chegou sem nota fiscal</span>
              <span className="block text-sm text-neutral-600">Entra no orçamento pela data de chegada e fica “aguardando nota fiscal” até a nota chegar.</span>
            </span>
          </label>
          {semNota && (
            <label className="mt-3 block">
              <span className={rotulo}>Observação (obrigatória)</span>
              <textarea
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                rows={2}
                placeholder="Ex.: salmão entregue com romaneio; fornecedor manda a NF-e amanhã"
                className={campo}
              />
            </label>
          )}
        </section>
      )}

      {/* Categoria e data */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={rotulo}>Categoria</span>
          <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} className={campo}>
            <option value="">Escolha…</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
          {categoriaFora && (
            <span className="mt-1 block text-xs text-amber-800">Diferente da categoria padrão do fornecedor (vale só para esta nota).</span>
          )}
        </label>
        <label className="block">
          <span className={rotulo}>{semNota ? "Data de chegada" : "Data da nota"}</span>
          <input
            type="date"
            value={dataEmissao}
            max={hoje}
            onChange={(e) => {
              setDataEmissao(e.target.value);
              fotoEnviada.current = null; // a pasta da foto depende do mês da data
            }}
            className={campo}
          />
        </label>
      </section>

      {/* Documento e pagamento: vêm do fornecedor, editáveis */}
      <section className="grid grid-cols-2 gap-3">
        {!semNota && (
          <label className="block">
            <span className={rotulo}>Documento</span>
            <select
              value={tipo}
              onChange={(e) => {
                setTipo(e.target.value as TipoNota);
                setTipoTocado(true);
              }}
              className={campo}
            >
              {TIPOS_NOTA.filter((t) => t.valor !== "sem_nota" || !(modo === "criar" || eraSemNota)).map((t) => (
                <option key={t.valor} value={t.valor}>
                  {t.rotulo}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className={`block ${semNota ? "col-span-2" : ""}`}>
          <span className={rotulo}>Pagamento</span>
          <select
            value={forma}
            onChange={(e) => {
              setForma(e.target.value as FormaPagamento);
              setFormaTocada(true);
            }}
            className={campo}
          >
            {FORMAS_PAGAMENTO.map((f) => (
              <option key={f.valor} value={f.valor}>
                {f.rotulo}
              </option>
            ))}
          </select>
        </label>
        {padrao && modo === "criar" && (tipoTocado || formaTocada) === false && (fornecedor?.tipoPadrao || fornecedor?.formaPadrao) && (
          <p className="col-span-2 -mt-1 text-xs text-neutral-500">Padrão do fornecedor (pode trocar).</p>
        )}
      </section>

      {/* Mais detalhes */}
      <section className="rounded-xl border border-neutral-200 bg-white">
        <button type="button" onClick={() => setDetalhesAbertos((x) => !x)} className="flex w-full justify-between px-4 py-3 font-medium" aria-expanded={detalhesAbertos}>
          Mais detalhes <span aria-hidden>{detalhesAbertos ? "−" : "+"}</span>
        </button>
        {detalhesAbertos && (
          <div className="grid grid-cols-1 gap-3 border-t border-neutral-100 p-4 sm:grid-cols-2">
            <label className="block">
              <span className={rotulo}>Número</span>
              <input value={numero} onChange={(e) => setNumero(e.target.value)} inputMode="numeric" className={campo} />
            </label>
            <label className="block">
              <span className={rotulo}>Vencimento</span>
              <input
                type="date"
                value={vencimento}
                onChange={(e) => {
                  setVencimento(e.target.value);
                  setVencimentoTocado(true);
                }}
                className={campo}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className={rotulo}>Descrição</span>
              <input value={descricao} onChange={(e) => setDescricao(e.target.value)} className={campo} />
            </label>
            <label className={`block sm:col-span-2 ${semNota ? "hidden" : ""}`}>
              <span className={rotulo}>Observação</span>
              <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} className={campo} />
            </label>
          </div>
        )}
      </section>

      {modo === "editar" && (
        <label className="block">
          <span className={rotulo}>Motivo da edição (obrigatório)</span>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: valor digitado errado" className={campo} />
        </label>
      )}

      {/* Barra fixa de ação */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-200 bg-white/95 px-4 pt-3 pb-[max(.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto max-w-5xl space-y-2">
          {parecida && (
            <div
              role="alertdialog"
              aria-labelledby="dup-titulo"
              className={`max-h-[60vh] overflow-y-auto rounded-xl border p-3 text-sm ${parecida.semNota ? "border-amber-400 bg-amber-50" : "border-neutral-300 bg-white"}`}
            >
              <p id="dup-titulo" className="font-medium">
                Já existe uma nota parecida: {dataBR(parecida.data)} · {parecida.fornecedor} · {formatarBRL(parecida.valor)} [{parecida.situacao}]. É a mesma?
              </p>
              {parecida.semNota && (
                <p className="mt-1 text-amber-900">
                  Essa compra está <strong>aguardando nota fiscal</strong>. Se esta é a nota dela, edite a pendente em vez de criar uma nova.
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {parecida.semNota && (
                  <Link href={`/painel/cmv/notas/${parecida.id}/editar?nf=1`} className="rounded-lg bg-amber-600 px-3 py-2 font-semibold text-white">
                    Editar a pendente (lançar a nota fiscal)
                  </Link>
                )}
                <Link
                  href={`/painel/cmv/notas/${parecida.id}`}
                  className={parecida.semNota ? "rounded-lg border border-neutral-300 bg-white px-3 py-2" : "rounded-lg bg-neutral-900 px-3 py-2 font-semibold text-white"}
                >
                  Abrir a existente
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    duplicidadeConfirmada.current = true;
                    setParecida(null);
                    (document.getElementById("form-nota") as HTMLFormElement | null)?.requestSubmit();
                  }}
                  className="rounded-lg border border-neutral-300 bg-white px-3 py-2"
                >
                  É outra compra, salvar
                </button>
              </div>
            </div>
          )}
          {erro && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {erro}
            </p>
          )}
          <button type="submit" disabled={ocupado} className="w-full rounded-xl bg-red-600 px-4 py-3.5 text-lg font-bold text-white disabled:opacity-60">
            {etapa ?? (modo === "criar" ? "Salvar nota" : "Salvar alterações")}
          </button>
        </div>
      </div>
    </form>
  );
}
