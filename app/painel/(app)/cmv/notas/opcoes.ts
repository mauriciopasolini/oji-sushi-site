import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fornecedoresMaisUsados, listarCategorias, listarFornecedores } from "@/lib/cmv/dados";
import type { OpcaoCategoria, OpcaoFornecedor } from "./form-nota";

/** Dados de apoio do formulário de nota (fornecedores, mais usados, categorias). */
export async function carregarOpcoesNota(supabase: SupabaseClient, hoje: string, incluirFornecedorId?: string) {
  const [fornecedores, maisUsados, categorias] = await Promise.all([
    listarFornecedores(supabase, { incluirInativos: Boolean(incluirFornecedorId) }),
    fornecedoresMaisUsados(supabase, hoje),
    listarCategorias(supabase),
  ]);
  const opcoesFornecedores: OpcaoFornecedor[] = fornecedores
    .filter((f) => f.ativo || f.id === incluirFornecedorId)
    .map((f) => ({ id: f.id, nome: f.nome, categoriaId: f.categoria_padrao_id, prazo: f.prazo_vencimento_dias, tipoPadrao: f.tipo_padrao, formaPadrao: f.forma_pagamento_padrao, novo: f.revisado_em === null }));
  const opcoesCategorias: OpcaoCategoria[] = categorias.filter((c) => c.ativa).map((c) => ({ id: c.id, nome: c.nome }));
  return { fornecedores: opcoesFornecedores, maisUsados, categorias: opcoesCategorias };
}
