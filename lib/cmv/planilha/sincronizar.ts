import "server-only";
import { fimDoMes } from "@/lib/cmv/dados";
import { type DataCivil, competenciaDe, diasDoMes, partes, somarDias } from "@/lib/cmv/datas";
import { centavos, paraDecimal } from "@/lib/cmv/dinheiro";
import { createAdminClient } from "@/lib/supabase/admin";
import { lerAbas, listarAbas } from "./google";
import { dataDaAba, idDaPlanilha, lerAbaDiaria } from "./parser";
import { CAMPOS_PLANILHA, type ConflitoNovo, type DecisaoManterManual, type PlanoSincronizacao, type VendaExistente, planejarSincronizacao } from "./planejar";

export type Gatilho = "manual" | "automatica" | "cron";

export type ResumoSincronizacao = {
  competencia: DataCivil;
  status: "ok" | "erro" | "ignorada" | "em_andamento";
  mensagem: string;
  diasLidos?: number;
  linhasGravadas?: number;
  conciliadas?: number;
  conflitos?: number;
  conflitosJaDecididos?: number;
  abasFaltando?: string[];
  abasVazias?: string[];
  divergencias?: PlanoSincronizacao["divergencias"];
  avisos?: string[];
};

/** Intervalo mínimo entre sincronizações automáticas ao abrir o painel. */
export const INTERVALO_AUTOMATICA_MIN = 30;

/** Dias do mês que já deveriam ter aba: do dia 1 até ontem (limitado ao mês). */
export function diasEsperados(competencia: DataCivil, hoje: DataCivil): DataCivil[] {
  const ontem = somarDias(hoje, -1);
  return diasDoMes(competencia).filter((d) => d <= ontem);
}

/** Competências a sincronizar "hoje": a de ontem (fecha o último dia do mês anterior) e a atual. */
export function competenciasDoDia(hoje: DataCivil): DataCivil[] {
  return [...new Set([competenciaDe(somarDias(hoje, -1)), competenciaDe(hoje)])];
}

const doBanco = (r: Record<string, unknown>): VendaExistente => ({
  data: r.data as string,
  turno: r.turno as 1 | 2,
  origem: r.origem as VendaExistente["origem"],
  fonte: r.fonte as "manual" | "planilha",
  qtdPedidos: (r.qtd_pedidos as number | null) ?? null,
  campos: Object.fromEntries(CAMPOS_PLANILHA.map((c) => [c, centavos(r[c] as number)])) as VendaExistente["campos"],
});

const camposParaBanco = (campos: Record<string, number>) =>
  Object.fromEntries(CAMPOS_PLANILHA.map((c) => [c, paraDecimal(campos[c] ?? 0)]));

export async function sincronizarMes(params: {
  competencia: DataCivil;
  hoje: DataCivil;
  gatilho: Gatilho;
  usuarioId?: string | null;
  /** Ensaio: lê planilha e banco e monta o plano, mas NÃO grava nada (nem o registro). */
  ensaio?: boolean;
}): Promise<ResumoSincronizacao & { plano?: PlanoSincronizacao }> {
  const { competencia, hoje, gatilho, ensaio = false } = params;
  const db = createAdminClient();
  const agora = new Date().toISOString();

  // Evita duas sincronizações simultâneas do mesmo mês.
  const { data: rodando } = await db
    .from("sincronizacoes")
    .select("id")
    .eq("competencia", competencia)
    .eq("status", "executando")
    .gte("iniciado_em", new Date(Date.now() - 3 * 60_000).toISOString())
    .limit(1);
  if (rodando?.length) return { competencia, status: "em_andamento", mensagem: "Já existe uma sincronização em andamento." };

  let registroId: string | null = null;
  if (!ensaio) {
    const { data: registro, error: erroRegistro } = await db
      .from("sincronizacoes")
      .insert({ competencia, gatilho, usuario_id: params.usuarioId ?? null })
      .select("id")
      .single();
    if (erroRegistro) throw new Error(`Falha ao registrar a sincronização: ${erroRegistro.message}`);
    registroId = registro.id;
  }

  const concluir = async (r: ResumoSincronizacao & { plano?: PlanoSincronizacao }) => {
    if (registroId) {
      const { plano: _plano, ...resumo } = r;
      void _plano;
      await db
        .from("sincronizacoes")
        .update({ status: r.status === "em_andamento" ? "erro" : r.status, concluido_em: new Date().toISOString(), resumo, erro: r.status === "erro" ? r.mensagem : null })
        .eq("id", registroId);
    }
    return r;
  };

  try {
    // Mês: precisa existir e estar aberto.
    let { data: mes } = await db.from("meses").select("id, status, planilha_url").eq("competencia", competencia).maybeSingle();
    if (!mes && ensaio) mes = { id: null, status: "aberto", planilha_url: null };
    if (!mes) {
      const ins = await db.from("meses").insert({ competencia }).select("id, status, planilha_url").single();
      if (ins.error) throw new Error(ins.error.message);
      mes = ins.data;
    }
    if (mes.status === "fechado") return concluir({ competencia, status: "ignorada", mensagem: "Mês fechado: sincronização não altera vendas." });

    // Planilha do mês; se não houver, usa a do mês mais recente configurado (a planilha é anual).
    let url = mes.planilha_url as string | null;
    if (!url) {
      const { data: anterior } = await db
        .from("meses")
        .select("planilha_url")
        .not("planilha_url", "is", null)
        .lte("competencia", competencia)
        .order("competencia", { ascending: false })
        .limit(1)
        .maybeSingle();
      url = anterior?.planilha_url ?? null;
    }
    const spreadsheetId = url ? idDaPlanilha(url) : null;
    if (!spreadsheetId) return concluir({ competencia, status: "erro", mensagem: "Planilha do mês não configurada (Vendas → Planilha do mês)." });

    const esperados = diasEsperados(competencia, hoje);
    if (!esperados.length) return concluir({ competencia, status: "ok", mensagem: "Nenhum dia a sincronizar ainda.", diasLidos: 0, linhasGravadas: 0 });

    // Abas do mês até ontem
    const { ano, mes: numMes } = partes(competencia);
    const abas = (await listarAbas(spreadsheetId)).map((a) => ({ titulo: a.titulo, data: dataDaAba(a.titulo, ano) }));
    const doMes = abas.filter((a): a is { titulo: string; data: string } => !!a.data && Number(a.data.slice(5, 7)) === numMes && esperados.includes(a.data));
    const grades = await lerAbas(spreadsheetId, doMes.map((a) => a.titulo));
    const lidas = new Map(doMes.map((a) => [a.data, { titulo: a.titulo, aba: lerAbaDiaria(grades.get(a.titulo) ?? []), grade: grades.get(a.titulo) ?? [] }]));

    // Estado atual no banco
    const ini = esperados[0];
    const fim = esperados[esperados.length - 1];
    const [{ data: vendas, error: e1 }, { data: decisoes, error: e2 }, { data: pendentes, error: e3 }] = await Promise.all([
      db.from("vendas_turno").select("*").gte("data", ini).lte("data", fim),
      db.from("conflitos_venda").select("data, turno, origem, assinatura_planilha, resolvido_em").eq("resolucao", "manter_manual").gte("data", ini).lte("data", fim).order("resolvido_em"),
      db.from("conflitos_venda").select("id, data, turno, origem, assinatura_planilha").is("resolucao", null).gte("data", ini).lte("data", fimDoMes(competencia)),
    ]);
    for (const e of [e1, e2, e3]) if (e) throw new Error(e.message);

    const plano = planejarSincronizacao({
      diasEsperados: esperados,
      lidas,
      existentes: (vendas ?? []).map(doBanco),
      // a última decisão por chave vale (ordenado por resolvido_em)
      decisoesManterManual: (decisoes ?? []).map((d) => ({ data: d.data, turno: d.turno, origem: d.origem, assinatura: d.assinatura_planilha }) as DecisaoManterManual),
    });

    if (ensaio) {
      return concluir({
        competencia,
        status: "ok",
        mensagem: `ENSAIO (nada gravado): ${plano.diasLidos.length} dia(s) lido(s), ${plano.gravarVendas.length} linha(s) a gravar, ${plano.conflitos.length} conflito(s)`,
        diasLidos: plano.diasLidos.length,
        linhasGravadas: 0,
        conciliadas: plano.conciliadas.length,
        conflitos: plano.conflitos.length,
        abasFaltando: plano.abasFaltando,
        abasVazias: plano.abasVazias,
        divergencias: plano.divergencias,
        avisos: plano.avisos,
        plano,
      });
    }

    // Gravação (idempotente)
    if (plano.gravarVendas.length) {
      const { error } = await db.from("vendas_turno").upsert(
        plano.gravarVendas.map((v) => ({
          data: v.data, turno: v.turno, origem: v.origem, ...camposParaBanco(v.campos),
          qtd_pedidos: v.qtdPedidos, fonte: "planilha", sincronizado_em: agora, criado_por: null,
        })),
        { onConflict: "data,turno,origem" },
      );
      if (error) throw new Error(`Gravar vendas: ${error.message}`);
    }
    if (plano.gravarFechamentos.length) {
      const { error } = await db.from("fechamento_turno").upsert(
        plano.gravarFechamentos.map((f) => ({
          data: f.data, turno: f.turno,
          total_dia_planilha: f.totalDiaPlanilha === null ? null : paraDecimal(f.totalDiaPlanilha),
          total_pedidos: f.totalPedidos,
          despesa_mercado: paraDecimal(f.despesaMercado), despesa_motoboy: paraDecimal(f.despesaMotoboy), despesa_outros: paraDecimal(f.despesaOutros),
          divergencia: f.divergencia === null ? null : paraDecimal(f.divergencia),
          bruto: f.bruto, sincronizado_em: agora,
        })),
        { onConflict: "data,turno" },
      );
      if (error) throw new Error(`Gravar fechamentos: ${error.message}`);
    }

    // Conflitos: cria/atualiza os pendentes; remove os que deixaram de existir.
    const chave = (c: { data: string; turno: number; origem: string }) => `${c.data}|${c.turno}|${c.origem}`;
    const pendentesPorChave = new Map((pendentes ?? []).map((p) => [chave(p), p]));
    const novos = new Set(plano.conflitos.map(chave));
    const linhaConflito = (c: ConflitoNovo) => ({
      data: c.data, turno: c.turno, origem: c.origem,
      valores_manual: c.manual, valores_planilha: c.planilha,
      total_manual: paraDecimal(c.totalManual), total_planilha: paraDecimal(c.totalPlanilha),
      assinatura_planilha: c.assinatura, detectado_em: agora,
    });
    for (const c of plano.conflitos) {
      const p = pendentesPorChave.get(chave(c));
      const r = p ? await db.from("conflitos_venda").update(linhaConflito(c)).eq("id", p.id) : await db.from("conflitos_venda").insert(linhaConflito(c));
      if (r.error) throw new Error(`Registrar conflito: ${r.error.message}`);
    }
    const sumiram = (pendentes ?? []).filter((p) => p.data <= fim && !novos.has(chave(p))).map((p) => p.id);
    if (sumiram.length) await db.from("conflitos_venda").delete().in("id", sumiram);

    const partesMsg = [
      `${plano.diasLidos.length} dia(s) lido(s)`,
      plano.conflitos.length ? `${plano.conflitos.length} conflito(s) com vendas manuais` : "",
      plano.abasFaltando.length ? `${plano.abasFaltando.length} aba(s) faltando` : "",
      plano.abasVazias.length ? `${plano.abasVazias.length} aba(s) vazia(s)` : "",
      plano.divergencias.length ? `${plano.divergencias.length} divergência(s)` : "",
    ].filter(Boolean);

    return concluir({
      competencia,
      status: "ok",
      mensagem: partesMsg.join(" · "),
      diasLidos: plano.diasLidos.length,
      linhasGravadas: plano.gravarVendas.length,
      conciliadas: plano.conciliadas.length,
      conflitos: plano.conflitos.length,
      conflitosJaDecididos: plano.conflitosJaDecididos,
      abasFaltando: plano.abasFaltando,
      abasVazias: plano.abasVazias,
      divergencias: plano.divergencias,
      avisos: plano.avisos,
    });
  } catch (e) {
    const msg = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? (e as Error).message;
    const amigavel = /permission|403/i.test(msg) ? `Sem acesso à planilha: compartilhe-a (Leitor) com a conta de serviço. (${msg})` : msg;
    return concluir({ competencia, status: "erro", mensagem: amigavel });
  }
}

/**
 * Sincroniza as competências de hoje: a atual e, se for diferente, a de ontem
 * (ex.: dia 1º fecha o último dia do mês anterior), mas o mês anterior só se ele
 * já existir no sistema (meses fora do módulo, como o histórico, não são importados).
 */
export async function sincronizarHoje(params: { hoje: DataCivil; gatilho: Gatilho; usuarioId?: string | null }) {
  const atual = competenciaDe(params.hoje);
  const resultados: ResumoSincronizacao[] = [];
  for (const competencia of competenciasDoDia(params.hoje)) {
    if (competencia !== atual) {
      const { data } = await createAdminClient().from("meses").select("id").eq("competencia", competencia).maybeSingle();
      if (!data) continue;
    }
    resultados.push(await sincronizarMes({ competencia, ...params }));
  }
  return resultados;
}
