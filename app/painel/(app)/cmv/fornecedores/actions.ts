"use server";
import { revalidatePath } from "next/cache";
import { getSessao } from "@/lib/cmv/sessao";
import { TIPOS_DOCUMENTO } from "@/lib/cmv/padroes-fornecedor";
import { FORMAS_PAGAMENTO, RE_UUID } from "@/lib/cmv/tipos";
import { createClient } from "@/lib/supabase/server";

export type Resultado<T = undefined> = { ok: true; dados: T } | { ok: false; erro: string };

export type DadosFornecedor = {
  nome: string;
  categoria_padrao_id: string;
  prazo_vencimento_dias: string;
  cnpj: string;
  /** "" = sem padrão */
  tipo_padrao: string;
  forma_pagamento_padrao: string;
};

function mensagem(msg: string) {
  if (/fornecedores_nome_normalizado_uk|fornecedores_nome_key/.test(msg)) return "Já existe um fornecedor com esse nome.";
  if (/fornecedores_cnpj_check/.test(msg)) return "CNPJ inválido: informe os 14 dígitos.";
  if (/fornecedores_mescla_coerente/.test(msg)) return "Fornecedor mesclado não pode ser reativado.";
  if (/row-level security|permission denied/i.test(msg)) return "Você não tem permissão para esta ação.";
  return msg;
}

async function exigirAdmin(): Promise<{ ok: true; uid: string } | { ok: false; erro: string }> {
  const sessao = await getSessao();
  if (!sessao?.perfil?.ativo) return { ok: false, erro: "Sessão expirada. Entre novamente." };
  if (sessao.perfil.papel !== "admin") return { ok: false, erro: "Somente o administrador pode alterar fornecedores." };
  return { ok: true, uid: sessao.user.id };
}

/** Valida os campos do formulário; devolve o registro para gravar ou a mensagem de erro. */
function validar(d: DadosFornecedor) {
  const nome = (d.nome ?? "").replace(/\s+/g, " ").trim();
  if (nome.length < 2) return "Informe o nome do fornecedor.";
  if (nome.length > 120) return "Nome muito longo.";
  if (!RE_UUID.test(d.categoria_padrao_id ?? "")) return "Escolha a categoria padrão.";
  const prazoTxt = (d.prazo_vencimento_dias ?? "").trim();
  let prazo: number | null = null;
  if (prazoTxt) {
    if (!/^\d{1,3}$/.test(prazoTxt)) return "Prazo inválido: informe o número de dias (0 a 365).";
    prazo = Number(prazoTxt);
    if (prazo > 365) return "Prazo inválido: informe o número de dias (0 a 365).";
  }
  const cnpj = (d.cnpj ?? "").replace(/\D/g, "");
  if (cnpj && cnpj.length !== 14) return "CNPJ inválido: informe os 14 dígitos.";
  const tipo = d.tipo_padrao || null;
  if (tipo && !TIPOS_DOCUMENTO.some((t) => t.valor === tipo)) return "Tipo de documento padrão inválido.";
  const forma = d.forma_pagamento_padrao || null;
  if (forma && !FORMAS_PAGAMENTO.some((f) => f.valor === forma)) return "Forma de pagamento padrão inválida.";
  return { nome, categoria_padrao_id: d.categoria_padrao_id, prazo_vencimento_dias: prazo, cnpj: cnpj || null, tipo_padrao: tipo, forma_pagamento_padrao: forma };
}

export async function salvarFornecedor(id: string | null, d: DadosFornecedor): Promise<Resultado<{ id: string }>> {
  const a = await exigirAdmin();
  if (!a.ok) return a;
  const v = validar(d);
  if (typeof v === "string") return { ok: false, erro: v };
  const supabase = await createClient();
  if (id) {
    if (!RE_UUID.test(id)) return { ok: false, erro: "Fornecedor inválido." };
    const { data, error } = await supabase.from("fornecedores").update(v).eq("id", id).select("id");
    if (error) return { ok: false, erro: mensagem(error.message) };
    if (!data?.length) return { ok: false, erro: "Fornecedor não encontrado." };
  } else {
    const { data, error } = await supabase.from("fornecedores").insert(v).select("id").single();
    if (error) return { ok: false, erro: mensagem(error.message) };
    id = data.id as string;
  }
  revalidatePath("/painel/cmv", "layout");
  return { ok: true, dados: { id } };
}

export async function definirAtivo(id: string, ativo: boolean): Promise<Resultado> {
  const a = await exigirAdmin();
  if (!a.ok) return a;
  if (!RE_UUID.test(id)) return { ok: false, erro: "Fornecedor inválido." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("fornecedores").update({ ativo }).eq("id", id).select("id");
  if (error) return { ok: false, erro: mensagem(error.message) };
  if (!data?.length) return { ok: false, erro: "Fornecedor não encontrado." };
  revalidatePath("/painel/cmv", "layout");
  return { ok: true, dados: undefined };
}

/** Remove o selo "novo" (e o fornecedor sai do alerta do painel). */
export async function marcarRevisado(id: string): Promise<Resultado> {
  const a = await exigirAdmin();
  if (!a.ok) return a;
  if (!RE_UUID.test(id)) return { ok: false, erro: "Fornecedor inválido." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fornecedores")
    .update({ revisado_em: new Date().toISOString(), revisado_por: a.uid })
    .eq("id", id)
    .is("revisado_em", null)
    .select("id");
  if (error) return { ok: false, erro: mensagem(error.message) };
  if (!data?.length) return { ok: false, erro: "Fornecedor não encontrado ou já revisado." };
  revalidatePath("/painel/cmv", "layout");
  return { ok: true, dados: undefined };
}

/** Mescla: as notas de `remover` (em meses abertos) passam para `manter`; `remover` é desativado. Auditado no banco. */
export async function mesclarFornecedores(manter: string, remover: string): Promise<Resultado<{ movidas: number; emMesFechado: number }>> {
  const a = await exigirAdmin();
  if (!a.ok) return a;
  if (!RE_UUID.test(manter) || !RE_UUID.test(remover)) return { ok: false, erro: "Fornecedor inválido." };
  if (manter === remover) return { ok: false, erro: "Escolha dois fornecedores diferentes." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mesclar_fornecedores", { p_manter: manter, p_remover: remover });
  if (error) return { ok: false, erro: mensagem(error.message) };
  const r = data as { notas_movidas: number; notas_em_mes_fechado: number };
  revalidatePath("/painel/cmv", "layout");
  return { ok: true, dados: { movidas: r.notas_movidas, emMesFechado: r.notas_em_mes_fechado } };
}
