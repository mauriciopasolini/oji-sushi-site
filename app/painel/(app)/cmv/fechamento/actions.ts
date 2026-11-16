"use server";
import { revalidatePath } from "next/cache";
import { carregarEntrada } from "@/lib/cmv/fechamento/carregar";
import { checklistCompleto } from "@/lib/cmv/fechamento/checklist";
import { nomeMes } from "@/lib/cmv/fechamento/formatos";
import { montarFechamento } from "@/lib/cmv/fechamento/montar";
import { hojeSP } from "@/lib/cmv/datas";
import { centavos, paraDecimal } from "@/lib/cmv/dinheiro";
import { getSessao } from "@/lib/cmv/sessao";
import { createClient } from "@/lib/supabase/server";

export type Resultado = { ok: true; mensagem?: string } | { ok: false; erro: string };

const RE_COMP = /^\d{4}-\d{2}-01$/;

async function exigirAdmin(): Promise<string | null> {
  const sessao = await getSessao();
  if (!sessao?.perfil?.ativo) return "Sessão expirada. Entre novamente.";
  if (sessao.perfil.papel !== "admin") return "Somente o administrador fecha o mês.";
  return null;
}

function mensagem(msg: string) {
  if (/row-level security|permission denied/i.test(msg)) return "Você não tem permissão para esta ação.";
  if (/function public\.fechar_mes\(.*\) does not exist|Could not find the function public\.fechar_mes/i.test(msg))
    return "O banco ainda não tem o fechamento com snapshot (migração 20261117090000 pendente).";
  return msg; // as funções do banco respondem em português
}

/** Admin: grava o total ERP + delivery do mês (base de cálculo = o menor entre caixa e ERP). */
export async function salvarErp(competencia: string, valor: string): Promise<Resultado> {
  const erro = await exigirAdmin();
  if (erro) return { ok: false, erro };
  if (!RE_COMP.test(competencia ?? "")) return { ok: false, erro: "Mês inválido." };
  let c: number | null = null;
  if ((valor ?? "").trim()) {
    try {
      c = centavos(valor);
    } catch {
      return { ok: false, erro: "Valor inválido. Use o formato 87.953,44." };
    }
    if (c <= 0 || c > 100_000_000_00) return { ok: false, erro: "Valor inválido." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("meses")
    .update({ venda_base_erp: c === null ? null : paraDecimal(c) })
    .eq("competencia", competencia)
    .select("id");
  if (error) return { ok: false, erro: mensagem(error.message) };
  if (!data?.length) return { ok: false, erro: "Este mês ainda não existe no sistema." };
  revalidatePath("/painel/cmv", "layout");
  return { ok: true };
}

/**
 * Admin: fecha o mês. Monta o snapshot com os dados atuais (o mesmo motor do painel) e
 * chama fechar_mes, que confere o checklist e a assinatura dos dados e grava tudo de uma vez.
 */
export async function fecharMes(competencia: string): Promise<Resultado> {
  const erro = await exigirAdmin();
  if (erro) return { ok: false, erro };
  if (!RE_COMP.test(competencia ?? "")) return { ok: false, erro: "Mês inválido." };
  const supabase = await createClient();
  const { entrada, mes } = await carregarEntrada(supabase, competencia, hojeSP());
  if (!mes.id) return { ok: false, erro: "Este mês ainda não existe no sistema." };
  if (mes.status === "fechado") return { ok: false, erro: "O mês já está fechado." };
  const dados = montarFechamento(entrada, { previa: false });
  if (!checklistCompleto(dados.checklist)) {
    const falta = dados.checklist.filter((i) => !i.ok).map((i) => i.titulo.toLowerCase());
    return { ok: false, erro: `Ainda falta: ${falta.join("; ")}.` };
  }
  const { data, error } = await supabase.rpc("fechar_mes", { p_mes_id: mes.id, p_snapshot: dados, p_assinatura: dados.assinatura });
  if (error) return { ok: false, erro: mensagem(error.message) };
  revalidatePath("/painel/cmv", "layout");
  return { ok: true, mensagem: `${nomeMes(competencia)} fechado (versão ${data}).` };
}

/** Admin: reabre o mês fechado, com motivo (auditado). O snapshot fica guardado como histórico. */
export async function reabrirMes(competencia: string, motivo: string): Promise<Resultado> {
  const erro = await exigirAdmin();
  if (erro) return { ok: false, erro };
  if (!RE_COMP.test(competencia ?? "")) return { ok: false, erro: "Mês inválido." };
  const m = (motivo ?? "").trim();
  if (m.length < 5) return { ok: false, erro: "Escreva o motivo da reabertura." };
  const supabase = await createClient();
  const { data: mes } = await supabase.from("meses").select("id").eq("competencia", competencia).maybeSingle();
  if (!mes) return { ok: false, erro: "Este mês ainda não existe no sistema." };
  const { error } = await supabase.rpc("reabrir_mes", { p_mes_id: mes.id, p_motivo: m.slice(0, 500) });
  if (error) return { ok: false, erro: mensagem(error.message) };
  revalidatePath("/painel/cmv", "layout");
  return { ok: true, mensagem: `${nomeMes(competencia)} reaberto.` };
}
