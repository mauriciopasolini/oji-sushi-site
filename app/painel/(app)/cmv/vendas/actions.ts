"use server";
import { revalidatePath } from "next/cache";
import { hojeSP } from "@/lib/cmv/datas";
import { centavos, paraDecimal } from "@/lib/cmv/dinheiro";
import { getSessao } from "@/lib/cmv/sessao";
import { ORIGENS, type Origem, TODOS_CAMPOS } from "@/lib/cmv/vendas";
import { createClient } from "@/lib/supabase/server";

export type LinhaVenda = { turno: 1 | 2; origem: Origem; valores: Partial<Record<string, string>>; qtdPedidos?: string };
export type RetornoVenda = { ok: true } | { ok: false; erro: string };

/** Grava as vendas manuais de um dia (upsert por data+turno+origem). Linhas da planilha não são tocadas. */
export async function salvarVendasDia(data: string, linhas: LinhaVenda[]): Promise<RetornoVenda> {
  const sessao = await getSessao();
  if (!sessao?.perfil?.ativo) return { ok: false, erro: "Sessão expirada. Entre novamente." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return { ok: false, erro: "Data inválida." };
  if (data > hojeSP()) return { ok: false, erro: "Não é possível lançar venda de dia futuro." };

  const supabase = await createClient();
  const { data: existentes } = await supabase.from("vendas_turno").select("turno, origem, fonte").eq("data", data);
  const daPlanilha = new Set((existentes ?? []).filter((e) => e.fonte === "planilha").map((e) => `${e.turno}-${e.origem}`));

  const registros = [];
  for (const l of linhas) {
    if (![1, 2].includes(l.turno) || !ORIGENS.some((o) => o.valor === l.origem)) return { ok: false, erro: "Linha inválida." };
    if (daPlanilha.has(`${l.turno}-${l.origem}`)) continue; // nunca sobrescreve a planilha
    const reg: Record<string, unknown> = { data, turno: l.turno, origem: l.origem, fonte: "manual", sincronizado_em: null };
    for (const campo of TODOS_CAMPOS) {
      let c = 0;
      try {
        c = centavos(l.valores[campo] ?? "");
      } catch {
        return { ok: false, erro: `Valor inválido em ${l.origem} / turno ${l.turno}.` };
      }
      if (c < 0) return { ok: false, erro: "Valores não podem ser negativos." };
      reg[campo] = paraDecimal(c);
    }
    const qtd = (l.qtdPedidos ?? "").trim();
    if (qtd && !/^\d{1,5}$/.test(qtd)) return { ok: false, erro: "Quantidade de pedidos inválida." };
    reg.qtd_pedidos = qtd ? Number(qtd) : null;
    registros.push(reg);
  }
  if (!registros.length) return { ok: false, erro: "Nada para salvar." };

  const { error } = await supabase.from("vendas_turno").upsert(registros, { onConflict: "data,turno,origem" });
  if (error) {
    if (/row-level security/i.test(error.message)) return { ok: false, erro: "Você não tem permissão para alterar essas vendas." };
    return { ok: false, erro: error.message };
  }
  revalidatePath("/painel/cmv", "layout");
  return { ok: true };
}

/** Admin: remove as vendas manuais de um dia. */
export async function removerVendasManuaisDia(data: string): Promise<RetornoVenda> {
  const sessao = await getSessao();
  if (sessao?.perfil?.papel !== "admin") return { ok: false, erro: "Somente o administrador pode remover vendas." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return { ok: false, erro: "Data inválida." };
  const supabase = await createClient();
  const { error } = await supabase.from("vendas_turno").delete().eq("data", data).eq("fonte", "manual");
  if (error) return { ok: false, erro: error.message };
  revalidatePath("/painel/cmv", "layout");
  return { ok: true };
}
