// Tipos das linhas do banco usadas pelo app.
// numeric chega do PostgREST como número JSON (ex.: 150) — sempre converter com centavos().

export type TipoNota = "nfe" | "cupom" | "comanda" | "outro" | "sem_nota";
export type FormaPagamento = "boleto" | "caixa" | "pix" | "outro";
export type Conferencia = "pendente" | "conferida" | "divergente";

export const TIPOS_NOTA: { valor: TipoNota; rotulo: string }[] = [
  { valor: "nfe", rotulo: "NF-e" },
  { valor: "cupom", rotulo: "Cupom" },
  { valor: "comanda", rotulo: "Comanda" },
  { valor: "outro", rotulo: "Outro" },
  { valor: "sem_nota", rotulo: "Sem nota (aguardando)" },
];

/** Compra registrada sem nota fiscal: fica "pendente de nota fiscal" até a nota chegar. */
export const ehPendenteNF = (n: { tipo: TipoNota; status: string }) => n.tipo === "sem_nota" && n.status === "ativa";

export const FORMAS_PAGAMENTO: { valor: FormaPagamento; rotulo: string }[] = [
  { valor: "boleto", rotulo: "Boleto" },
  { valor: "caixa", rotulo: "Caixa (dinheiro)" },
  { valor: "pix", rotulo: "Pix" },
  { valor: "outro", rotulo: "Outro" },
];

export const ROTULO_CONFERENCIA: Record<Conferencia, string> = {
  pendente: "Pendente",
  conferida: "Conferida",
  divergente: "Divergente",
};

export type CategoriaRow = { id: string; nome: string; slug: string; pct_meta: string | number; ordem: number; ativa: boolean };

export type FornecedorRow = {
  id: string;
  nome: string;
  categoria_padrao_id: string;
  prazo_vencimento_dias: number | null;
  tipo_padrao: Exclude<TipoNota, "sem_nota"> | null;
  forma_pagamento_padrao: FormaPagamento | null;
  ativo: boolean;
  revisado_em: string | null;
};

export type NotaRow = {
  id: string;
  mes_id: string;
  data_emissao: string;
  fornecedor_id: string;
  categoria_id: string;
  tipo: TipoNota;
  numero: string | null;
  valor: string | number;
  vencimento: string | null;
  forma_pagamento: FormaPagamento;
  descricao: string | null;
  observacao: string | null;
  foto_path: string;
  status: "ativa" | "cancelada";
  motivo_cancelamento: string | null;
  conferencia: Conferencia;
  conferencia_obs: string | null;
  categoria_fora_do_padrao: boolean;
  pendencia_justificativa: string | null;
  criado_por: string;
  criado_em: string;
  atualizado_em: string;
};

/** Caminho da foto no bucket: AAAA/MM/<uuid>.<ext> */
export const RE_FOTO_PATH =
  /^(\d{4})\/(0[1-9]|1[0-2])\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|pdf)$/;

export const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
