"use server";
import { revalidatePath } from "next/cache";
import { hojeSP, partes } from "@/lib/cmv/datas";
import { centavos, paraDecimal } from "@/lib/cmv/dinheiro";
import { getSessao } from "@/lib/cmv/sessao";
import { FORMAS_PAGAMENTO, type FormaPagamento, RE_FOTO_PATH, RE_UUID, TIPOS_NOTA, type TipoNota } from "@/lib/cmv/tipos";
import { createClient } from "@/lib/supabase/server";

export type Resultado<T = undefined> = { ok: true; dados: T } | { ok: false; erro: string };

export type DadosNota = {
  id: string;
  data_emissao: string;
  fornecedor_id: string;
  categoria_id: string;
  valor: string; // como digitado: "1.234,56" ou "1234.56"
  foto_path: string;
  tipo?: TipoNota;
  numero?: string;
  vencimento?: string;
  forma_pagamento?: FormaPagamento;
  descricao?: string;
  observacao?: string;
};

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const texto = (s?: string | null) => {
  const t = (s ?? "").trim();
  return t.length ? t.slice(0, 500) : null;
};

/** Traduz erros do banco (triggers/RLS) para mensagens de tela. */
function mensagemDoBanco(msg: string): string {
  if (/row-level security|permission denied/i.test(msg)) return "Você não tem permissão para esta ação.";
  if (/fornecedores_nome_normalizado_uk/.test(msg)) return "Já existe um fornecedor com esse nome.";
  if (/notas_cancelamento_com_motivo/.test(msg)) return "Informe o motivo do cancelamento.";
  return msg; // mensagens dos triggers já estão em português
}

function validarNota(d: DadosNota, { exigirIdNaFoto }: { exigirIdNaFoto: boolean }): string | { valor: string } {
  if (!RE_UUID.test(d.id ?? "")) return "Identificador da nota inválido.";
  if (!RE_UUID.test(d.fornecedor_id ?? "")) return "Escolha o fornecedor.";
  if (!RE_UUID.test(d.categoria_id ?? "")) return "Escolha a categoria.";
  if (!RE_DATA.test(d.data_emissao ?? "")) return "Data inválida.";
  try {
    partes(d.data_emissao);
  } catch {
    return "Data inválida.";
  }
  if (d.data_emissao > hojeSP()) return "A data da nota não pode ser no futuro.";
  if (d.vencimento && !RE_DATA.test(d.vencimento)) return "Vencimento inválido.";
  if (d.tipo && !TIPOS_NOTA.some((t) => t.valor === d.tipo)) return "Tipo inválido.";
  if (d.forma_pagamento && !FORMAS_PAGAMENTO.some((f) => f.valor === d.forma_pagamento)) return "Forma de pagamento inválida.";

  let c: number;
  try {
    c = centavos(d.valor);
  } catch {
    return "Valor inválido.";
  }
  if (c <= 0) return "Informe o valor da nota.";
  if (c > 100_000_000) return "Valor muito alto: confira (máximo R$ 1.000.000,00).";

  if (!d.foto_path) return "A foto da nota é obrigatória.";
  if (!RE_FOTO_PATH.test(d.foto_path)) return "Caminho da foto inválido.";
  if (exigirIdNaFoto && !d.foto_path.includes(`/${d.id}.`)) return "A foto não corresponde a esta nota.";
  return { valor: paraDecimal(c) };
}

async function fotoExiste(supabase: Awaited<ReturnType<typeof createClient>>, path: string) {
  const pasta = path.slice(0, path.lastIndexOf("/"));
  const nome = path.slice(path.lastIndexOf("/") + 1);
  const { data } = await supabase.storage.from("notas").list(pasta, { search: nome, limit: 1 });
  return Boolean(data?.some((o) => o.name === nome));
}

export async function criarNota(d: DadosNota): Promise<Resultado<{ id: string }>> {
  const sessao = await getSessao();
  if (!sessao?.perfil?.ativo) return { ok: false, erro: "Sessão expirada. Entre novamente." };

  const v = validarNota(d, { exigirIdNaFoto: true });
  if (typeof v === "string") return { ok: false, erro: v };

  const supabase = await createClient();
  if (!(await fotoExiste(supabase, d.foto_path))) return { ok: false, erro: "A foto não foi enviada. Tente de novo." };

  const { error } = await supabase.from("notas").insert({
    id: d.id,
    data_emissao: d.data_emissao,
    fornecedor_id: d.fornecedor_id,
    categoria_id: d.categoria_id,
    valor: v.valor,
    foto_path: d.foto_path,
    tipo: d.tipo ?? "nfe",
    numero: texto(d.numero),
    vencimento: d.vencimento || null,
    forma_pagamento: d.forma_pagamento ?? "boleto",
    descricao: texto(d.descricao),
    observacao: texto(d.observacao),
  });
  if (error) {
    if (error.code === "23505" && /notas_pkey/.test(error.message)) return { ok: true, dados: { id: d.id } }; // reenvio do mesmo formulário
    return { ok: false, erro: mensagemDoBanco(error.message) };
  }

  revalidatePath("/painel/cmv", "layout");
  return { ok: true, dados: { id: d.id } };
}

export async function editarNota(d: DadosNota & { motivo: string }): Promise<Resultado> {
  const sessao = await getSessao();
  if (!sessao?.perfil?.ativo) return { ok: false, erro: "Sessão expirada. Entre novamente." };
  const motivo = texto(d.motivo);
  if (!motivo) return { ok: false, erro: "Informe o motivo da edição." };

  const v = validarNota(d, { exigirIdNaFoto: false });
  if (typeof v === "string") return { ok: false, erro: v };

  const supabase = await createClient();
  const { data: atual } = await supabase.from("notas").select("foto_path, status").eq("id", d.id).maybeSingle();
  if (!atual) return { ok: false, erro: "Nota não encontrada." };
  if (atual.status === "cancelada") return { ok: false, erro: "Nota cancelada não pode ser editada." };
  if (d.foto_path !== atual.foto_path && !(await fotoExiste(supabase, d.foto_path))) {
    return { ok: false, erro: "A nova foto não foi enviada. Tente de novo." };
  }

  const { data, error } = await supabase
    .from("notas")
    .update({
      data_emissao: d.data_emissao,
      fornecedor_id: d.fornecedor_id,
      categoria_id: d.categoria_id,
      valor: v.valor,
      foto_path: d.foto_path,
      tipo: d.tipo ?? "nfe",
      numero: texto(d.numero),
      vencimento: d.vencimento || null,
      forma_pagamento: d.forma_pagamento ?? "boleto",
      descricao: texto(d.descricao),
      observacao: texto(d.observacao),
      motivo_edicao: motivo,
    })
    .eq("id", d.id)
    .select("id");
  if (error) return { ok: false, erro: mensagemDoBanco(error.message) };
  if (!data?.length) return { ok: false, erro: "Você não tem permissão para editar esta nota." };

  revalidatePath("/painel/cmv", "layout");
  return { ok: true, dados: undefined };
}

export async function cancelarNota(id: string, motivo: string): Promise<Resultado> {
  const sessao = await getSessao();
  if (!sessao?.perfil?.ativo) return { ok: false, erro: "Sessão expirada. Entre novamente." };
  if (!RE_UUID.test(id)) return { ok: false, erro: "Nota inválida." };
  const m = texto(motivo);
  if (!m) return { ok: false, erro: "Informe o motivo do cancelamento." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notas")
    .update({ status: "cancelada", motivo_cancelamento: m })
    .eq("id", id)
    .eq("status", "ativa")
    .select("id");
  if (error) return { ok: false, erro: mensagemDoBanco(error.message) };
  if (!data?.length) return { ok: false, erro: "Nota não encontrada ou já cancelada." };

  revalidatePath("/painel/cmv", "layout");
  return { ok: true, dados: undefined };
}

export async function criarFornecedor(nome: string, categoriaId: string): Promise<Resultado<{ id: string; nome: string }>> {
  const sessao = await getSessao();
  if (!sessao?.perfil?.ativo) return { ok: false, erro: "Sessão expirada. Entre novamente." };
  const n = (nome ?? "").replace(/\s+/g, " ").trim();
  if (n.length < 2) return { ok: false, erro: "Informe o nome do fornecedor." };
  if (n.length > 120) return { ok: false, erro: "Nome muito longo." };
  if (!RE_UUID.test(categoriaId ?? "")) return { ok: false, erro: "Escolha a categoria do fornecedor." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fornecedores")
    .insert({ nome: n, categoria_padrao_id: categoriaId })
    .select("id, nome")
    .single();
  if (error) return { ok: false, erro: mensagemDoBanco(error.message) };
  return { ok: true, dados: data };
}
