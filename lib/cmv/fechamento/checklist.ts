// Checklist do fechamento: função pura. As MESMAS regras são exigidas pelo banco em
// public.fechar_mes (migração 20261117090000): a tela orienta, o banco garante.

import { listarDias } from "../alertas";
import { type DataCivil, diasDoMes, somarDias } from "../datas";
import { formatarBRL } from "../dinheiro";
import type { EntradaFechamento, ItemChecklist } from "./tipos";

const dataBR = (d: DataCivil) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const MAX_DETALHES = 6;

function detalhar(linhas: string[]): string[] {
  if (linhas.length <= MAX_DETALHES) return linhas;
  return [...linhas.slice(0, MAX_DETALHES - 1), `… e mais ${linhas.length - (MAX_DETALHES - 1)}`];
}

/** Dias do mês com venda registrada: linha em vendas_turno (manual ou planilha, mesmo zerada) ou aba sincronizada. */
export function diasRegistrados(e: Pick<EntradaFechamento, "vendas" | "diasComFechamentoTurno">): Set<DataCivil> {
  return new Set([...e.vendas.map((v) => v.data), ...e.diasComFechamentoTurno]);
}

export function avaliarChecklist(e: EntradaFechamento): ItemChecklist[] {
  const mesUrl = e.competencia.slice(0, 7);
  const dias = diasDoMes(e.competencia);
  const fim = dias[dias.length - 1];
  const encerrado = e.hoje > fim;

  // 1. Mês encerrado
  const itemMes: ItemChecklist = {
    id: "mes_encerrado",
    titulo: "Mês encerrado",
    ok: encerrado,
    resumo: encerrado ? "O último dia do mês já passou." : `O mês termina em ${dataBR(fim)}. O fechamento fica disponível a partir de ${dataBR(somarDias(fim, 1))}.`,
    detalhes: [],
    href: null,
    acao: null,
  };

  // 2. Vendas completas até o último dia (sincronizadas ou "sem movimento") e sem conflito pendente
  const registrados = diasRegistrados(e);
  const faltando = dias.filter((d) => !registrados.has(d));
  const passados = faltando.filter((d) => d < e.hoje);
  const futuros = faltando.length - passados.length;
  const resumoVendas: string[] = [];
  if (passados.length) resumoVendas.push(`${passados.length} dia(s) sem venda registrada: ${listarDias(passados, 10)}.`);
  if (futuros) resumoVendas.push(`${futuros} dia(s) ainda por vir.`);
  if (e.conflitosPendentes.length) resumoVendas.push(`${e.conflitosPendentes.length} conflito(s) entre venda manual e planilha sem resolver.`);
  const itemVendas: ItemChecklist = {
    id: "vendas",
    titulo: "Vendas completas até o último dia",
    ok: faltando.length === 0 && e.conflitosPendentes.length === 0,
    resumo: resumoVendas.length ? resumoVendas.join(" ") : `Todos os ${dias.length} dias registrados (planilha ou "sem movimento").`,
    detalhes: detalhar(e.conflitosPendentes.map((c) => `Conflito em ${dataBR(c.data)}, turno ${c.turno}`)),
    href: `/painel/cmv/vendas?mes=${mesUrl}`,
    acao: "Abrir vendas",
  };

  // 3. Contagem de fechamento finalizada ("Fechamento de" = o mês)
  const c = e.contagemFinal;
  const itemContagem: ItemChecklist = {
    id: "contagem",
    titulo: "Contagem de fechamento finalizada",
    ok: c?.status === "finalizada",
    resumo: !c
      ? "A contagem de fechamento deste mês não foi iniciada."
      : c.status === "rascunho"
        ? `Contagem de ${dataBR(c.data)} em rascunho: falta finalizar.`
        : `Contagem de ${dataBR(c.data)} finalizada (${formatarBRL(c.itens.reduce((a, i) => a + i.valor, 0))}).`,
    detalhes: [],
    href: `/painel/cmv/contagem?mes=${mesUrl}`,
    acao: "Abrir contagem",
  };

  // 4. Notas conferidas (divergente conta como revisada: o banco exige observação)
  const pendentesConf = e.notas.filter((n) => n.conferencia === "pendente");
  const divergentes = e.notas.filter((n) => n.conferencia === "divergente").length;
  const itemConf: ItemChecklist = {
    id: "conferencia",
    titulo: "Todas as notas conferidas",
    ok: pendentesConf.length === 0,
    resumo: pendentesConf.length
      ? `${pendentesConf.length} de ${e.notas.length} nota(s) ainda pendente(s) de conferência.`
      : `${e.notas.length} nota(s) revisada(s)${divergentes ? `, ${divergentes} divergente(s) com observação` : ""}.`,
    detalhes: detalhar(pendentesConf.map((n) => `${dataBR(n.data)} · ${n.fornecedorNome} · ${formatarBRL(n.valor)}`)),
    href: `/painel/cmv/conferencia?mes=${mesUrl}&filtro=pendentes`,
    acao: "Abrir conferência",
  };

  // 5. Compras "sem nota" resolvidas ou justificadas
  const semNota = e.notas.filter((n) => n.tipo === "sem_nota");
  const semJustificativa = semNota.filter((n) => !n.pendenciaJustificativa?.trim());
  const itemSemNota: ItemChecklist = {
    id: "sem_nota",
    titulo: 'Compras "sem nota" resolvidas ou justificadas',
    ok: semJustificativa.length === 0,
    resumo: semJustificativa.length
      ? `${semJustificativa.length} compra(s) aguardando nota fiscal sem justificativa.`
      : semNota.length
        ? `${semNota.length} compra(s) sem nota, todas com justificativa.`
        : "Nenhuma compra aguardando nota fiscal.",
    detalhes: detalhar(semJustificativa.map((n) => `${dataBR(n.data)} · ${n.fornecedorNome} · ${formatarBRL(n.valor)}`)),
    href: "/painel/cmv/notas?status=aguardando",
    acao: "Abrir pendentes",
  };

  // 6. Fornecedores novos (das notas do mês) revisados
  const novos = [...new Map(e.notas.filter((n) => !n.fornecedorRevisado).map((n) => [n.fornecedorId, n.fornecedorNome])).values()].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
  const itemForn: ItemChecklist = {
    id: "fornecedores",
    titulo: "Fornecedores novos revisados",
    ok: novos.length === 0,
    resumo: novos.length ? `${novos.length} fornecedor(es) novo(s) com notas no mês, sem revisão.` : "Todos os fornecedores do mês estão revisados.",
    detalhes: detalhar(novos),
    href: `/painel/cmv/fornecedores?filtro=novos&mes=${mesUrl}`,
    acao: "Abrir fornecedores",
  };

  // 7. Total ERP + delivery informado
  const erp = e.mes.vendaBaseErp;
  const itemErp: ItemChecklist = {
    id: "erp",
    titulo: "Total ERP + delivery informado",
    ok: erp !== null,
    resumo: erp === null ? "Informe o total do ERP somado ao delivery." : `Informado: ${formatarBRL(erp)}.`,
    detalhes: [],
    href: null,
    acao: null,
  };

  return [itemMes, itemVendas, itemContagem, itemConf, itemSemNota, itemForn, itemErp];
}

export const checklistCompleto = (itens: ItemChecklist[]) => itens.every((i) => i.ok);
