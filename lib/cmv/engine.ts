// =============================================================================
// Motor de cálculo do CMV: FUNÇÕES PURAS, sem banco, sem relógio, sem fuso.
// Toda a UI consome este módulo. Dinheiro em centavos inteiros; datas civis
// "AAAA-MM-DD" de São Paulo (veja datas.ts). "hoje" é sempre um parâmetro.
// =============================================================================

import {
  type DataCivil,
  type NumeroSemana,
  type Semana,
  diaSemana,
  diasDoMes,
  mesmoMes,
  partes,
  semanaDaData,
  semanasDoMes,
  somarDias,
} from "./datas";
import type { Centavos } from "./dinheiro";

// -----------------------------------------------------------------------------
// Constantes configuráveis
// -----------------------------------------------------------------------------

/**
 * Semáforo do ritmo de compra: desvio sobre o planejado até o FIM da semana atual
 * (semanas encerradas + orçamento inteiro da semana atual, sem prorratear por dia:
 * as compras são concentradas na segunda e na sexta).
 */
export const LIMIARES_RITMO = {
  /** até este desvio (fração) → verde */
  verde: 0,
  /** até este desvio → amarelo; acima → vermelho */
  amarelo: 0.1,
} as const;

/**
 * Cor da barra de vendas (realizado × meta acumulada). Vender acima da meta é bom:
 * na meta ou acima → verde; até 10% abaixo → amarelo; mais que isso → vermelho.
 */
export const LIMIAR_VENDAS_AMARELO = 0.1;

export function corVendas(realizado: number, metaAcumulada: number): "verde" | "amarelo" | "vermelho" {
  if (metaAcumulada <= 0 || realizado >= metaAcumulada) return "verde";
  const falta = 1 - realizado / metaAcumulada;
  return falta <= LIMIAR_VENDAS_AMARELO ? "amarelo" : "vermelho";
}

// -----------------------------------------------------------------------------
// Tipos de entrada
// -----------------------------------------------------------------------------

export type PesosSemana = [number, number, number, number];

export type ConfigMes = {
  /** Primeiro dia do mês, "AAAA-MM-01". */
  competencia: DataCivil;
  metaVenda: Centavos;
  /** 0.35 = 35% */
  metaCmvPct: number;
  pesosSemana: PesosSemana;
  /** 1.25 = a sobra acumulada pode levar a semana a no máximo 125% do planejado original. */
  limiteAcumuloPct: number;
  /** Índice 0 = domingo … 6 = sábado. */
  pesosDiaSemana: number[];
};

export type Categoria = { id: string; nome: string; pctMeta: number };

export type NotaCalc = {
  categoriaId: string;
  data: DataCivil;
  valor: Centavos;
  status?: "ativa" | "cancelada";
};

export type VendaDia = { data: DataCivil; total: Centavos };

export type FaixaRegua = { faixa: string; limiteSuperiorPct: number | null; cor: string; ordem: number };

// -----------------------------------------------------------------------------
// Utilitários internos
// -----------------------------------------------------------------------------

const soma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const naoNegativo = (x: number) => (x > 0 ? x : 0);

/** Notas que contam: ativas e do mês da competência. */
function notasValidas(notas: NotaCalc[], competencia: DataCivil): NotaCalc[] {
  return notas.filter((n) => n.status !== "cancelada" && mesmoMes(n.data, competencia));
}

/**
 * Quantos dias do mês estão "decorridos" até `ate` (inclusive), limitado ao mês.
 * Antes do mês → 0; depois do mês → todos.
 */
export function diasDecorridosNoMes(competencia: DataCivil, ate: DataCivil | null): number {
  const dias = diasDoMes(competencia);
  if (!ate || ate < dias[0]) return 0;
  if (ate > dias[dias.length - 1]) return dias.length;
  return partes(ate).dia;
}

// -----------------------------------------------------------------------------
// Meta diária
//   meta_dia(d) = meta_venda_mes × peso_dia(d) / Σ peso_dia(todos os dias do mês)
// Arredondamento pelo ACUMULADO: meta_acumulada(n) = round(meta × Σpeso(1..n) / Σpeso),
// e meta_dia(n) = acumulada(n) − acumulada(n−1). Assim cada acumulado é exato ao
// centavo e a soma dos dias fecha exatamente a meta do mês.
// -----------------------------------------------------------------------------

export type MetaDia = { data: DataCivil; peso: number; meta: Centavos; metaAcumulada: Centavos };

export function somaPesosDoMes(config: ConfigMes): number {
  return soma(diasDoMes(config.competencia).map((d) => config.pesosDiaSemana[diaSemana(d)]));
}

export function metasDiarias(config: ConfigMes): MetaDia[] {
  const dias = diasDoMes(config.competencia);
  const total = somaPesosDoMes(config);
  let pesoAcum = 0;
  let anterior = 0;
  return dias.map((data) => {
    const peso = config.pesosDiaSemana[diaSemana(data)];
    pesoAcum += peso;
    const metaAcumulada = total > 0 ? Math.round((config.metaVenda * pesoAcum) / total) : 0;
    const meta = metaAcumulada - anterior;
    anterior = metaAcumulada;
    return { data, peso, meta, metaAcumulada };
  });
}

// -----------------------------------------------------------------------------
// Data de referência das vendas
//   hoje_ref = ontem, ou o último dia com venda sincronizada e completa.
//   Hoje só entra se estiver completo (os dois turnos preenchidos); um dia
//   parcial não conta na projeção, no ritmo nem no CMV.
// -----------------------------------------------------------------------------

export function definirHojeRef(hoje: DataCivil, diasComVendaCompleta: DataCivil[], hojeCompleto = false): DataCivil | null {
  const limite = hojeCompleto ? hoje : somarDias(hoje, -1);
  const candidatos = diasComVendaCompleta.filter((d) => d <= limite).sort();
  return candidatos.length ? candidatos[candidatos.length - 1] : null;
}

/**
 * Dias do mês, de 1 até ontem, sem venda registrada (sincronizada ou manual).
 * Enquanto houver algum, a projeção, e portanto o orçamento, é provisória.
 */
export function diasSemVenda(competencia: DataCivil, hoje: DataCivil, diasComVenda: DataCivil[]): DataCivil[] {
  const ontem = somarDias(hoje, -1);
  const com = new Set(diasComVenda);
  return diasDoMes(competencia).filter((d) => d <= ontem && !com.has(d));
}

// -----------------------------------------------------------------------------
// Projeção de venda (assimétrica, conservadora)
//   fator_ritmo = realizado / meta_acumulada    (meta_acumulada = 0 → 1)
//   projecao    = realizado + meta_restante × min(1, fator_ritmo)
//   tendência   = realizado / dias_decorridos × dias_do_mes   (informativa)
// -----------------------------------------------------------------------------

export type Projecao = {
  hojeRef: DataCivil | null;
  diasDecorridos: number;
  diasDoMes: number;
  realizado: Centavos;
  metaAcumulada: Centavos;
  metaRestante: Centavos;
  fatorRitmo: number;
  projecao: Centavos;
  projecaoTendencia: Centavos | null;
};

export function calcularProjecao(params: {
  config: ConfigMes;
  vendas: VendaDia[];
  hojeRef: DataCivil | null;
}): Projecao {
  const { config, vendas, hojeRef } = params;
  const metas = metasDiarias(config);
  const diasDecorridos = diasDecorridosNoMes(config.competencia, hojeRef);
  const limite = diasDecorridos > 0 ? metas[diasDecorridos - 1].data : null;

  const realizado = limite
    ? soma(vendas.filter((v) => mesmoMes(v.data, config.competencia) && v.data <= limite).map((v) => v.total))
    : 0;
  const metaAcumulada = diasDecorridos > 0 ? metas[diasDecorridos - 1].metaAcumulada : 0;
  const metaRestante = config.metaVenda - metaAcumulada;
  const fatorRitmo = metaAcumulada === 0 ? 1 : realizado / metaAcumulada;
  const projecao = realizado + Math.round(metaRestante * Math.min(1, fatorRitmo));
  const projecaoTendencia = diasDecorridos > 0 ? Math.round((realizado / diasDecorridos) * metas.length) : null;

  return {
    hojeRef: limite,
    diasDecorridos,
    diasDoMes: metas.length,
    realizado,
    metaAcumulada,
    metaRestante,
    fatorRitmo,
    projecao,
    projecaoTendencia,
  };
}

// -----------------------------------------------------------------------------
// Orçamento por categoria
//   teto_cat             = projecao × pct_meta_cat
//   saldo_cat            = teto_cat − Σ notas ativas da categoria no mês
//   saldo_inicio_semana  = teto_cat − Σ notas de semanas anteriores a k
//   planejado_original_j = teto_cat × peso_j / Σ pesos
//   orcamento_semana     = min(saldo_inicio_semana × peso_k / Σ pesos k..4,
//                              planejado_original_k × limite_acumulo)   (≥ 0)
//   disponivel_agora     = orcamento_semana − Σ notas da semana k
//
// Semanas encerradas: orçamento recalculado como foi no início de cada uma.
// Semanas futuras: distribui o que sobra depois da semana atual, supondo que
// ela consumirá o maior valor entre o orçamento e o já comprado. Assim um
// estouro na semana atual já reduz as semanas seguintes no painel.
// -----------------------------------------------------------------------------

export type SituacaoSemana = "encerrada" | "atual" | "futura";
export type CorSemaforo = "verde" | "amarelo" | "vermelho";

export type SemanaOrcamento = Semana & {
  situacao: SituacaoSemana;
  planejadoOriginal: Centavos;
  /** Orçamento calculado para a semana (encerradas: como foi no início dela; usado no ritmo). */
  orcamento: Centavos;
  /**
   * O que a tabela mostra como "orçamento atual": encerrada = comprado (a sobra já foi
   * redistribuída); atual e futuras = orçamento.
   */
  orcamentoAtual: Centavos;
  comprado: Centavos;
};

export type OrcamentoCategoria = {
  categoriaId: string;
  teto: Centavos;
  compradoMes: Centavos;
  saldo: Centavos;
  /** null quando o mês já terminou */
  semanaAtual: NumeroSemana | null;
  saldoInicioSemana: Centavos;
  orcamentoSemana: Centavos;
  compradoSemana: Centavos;
  disponivelAgora: Centavos;
  /** saldo no início da semana ≤ 0: nada mais a comprar no mês */
  semSaldo: boolean;
  /** comprou mais que o orçamento desta semana */
  estouroSemana: boolean;
  /** comprou mais que o teto do mês */
  estouroMes: boolean;
  semanas: SemanaOrcamento[];
  /**
   * Total alocado no mês = comprado nas semanas encerradas
   *   + max(orçamento, comprado) da semana atual + orçamento das semanas futuras.
   */
  alocadoMes: Centavos;
  /**
   * teto − alocadoMes: o que a trava de acúmulo (125%) deixou sem alocar.
   * Negativo só quando as compras já passaram do teto. alocadoMes + reserva = teto, sempre.
   */
  reserva: Centavos;
  ritmo: Ritmo;
};

export type Ritmo = {
  /** orçamento das semanas encerradas + orçamento inteiro da semana atual (mês encerrado: tudo) */
  esperadoAteFimDaSemana: Centavos;
  comprado: Centavos;
  desvio: Centavos;
  /** desvio / esperado; Infinity se esperado = 0 e já houve compra */
  desvioPct: number;
  cor: CorSemaforo;
};

/** Semana corrente e dias já decorridos nela (inclusive hoje). */
export function situacaoNoMes(competencia: DataCivil, hoje: DataCivil) {
  const semanas = semanasDoMes(competencia);
  const dias = diasDoMes(competencia);
  if (hoje < dias[0]) return { semanaAtual: 1 as NumeroSemana, diasDecorridosSemana: 0, encerrado: false };
  if (hoje > dias[dias.length - 1]) return { semanaAtual: null, diasDecorridosSemana: 0, encerrado: true };
  const k = semanaDaData(hoje);
  const inicio = partes(semanas[k - 1].inicio).dia;
  return { semanaAtual: k, diasDecorridosSemana: partes(hoje).dia - inicio + 1, encerrado: false };
}

export function corDoRitmo(desvioPct: number): CorSemaforo {
  if (desvioPct <= LIMIARES_RITMO.verde) return "verde";
  if (desvioPct <= LIMIARES_RITMO.amarelo) return "amarelo";
  return "vermelho";
}

export function calcularOrcamentoCategoria(params: {
  config: ConfigMes;
  categoria: Pick<Categoria, "id" | "pctMeta">;
  projecao: Centavos;
  /** Notas desta categoria (outras são ignoradas). */
  notas: NotaCalc[];
  hoje: DataCivil;
}): OrcamentoCategoria {
  const { config, categoria, projecao, hoje } = params;
  const pesos = config.pesosSemana;
  const totalPesos = soma(pesos);
  const semanas = semanasDoMes(config.competencia);
  const notas = notasValidas(params.notas, config.competencia).filter((n) => n.categoriaId === categoria.id);

  const teto = Math.round(projecao * categoria.pctMeta);
  const comprado = semanas.map((s) => soma(notas.filter((n) => semanaDaData(n.data) === s.numero).map((n) => n.valor)));
  const compradoMes = soma(comprado);
  // Arredondado pelo acumulado (como a meta diária): a soma das 4 semanas fecha exatamente no teto.
  const planejado = pesos.map((_, i) => {
    const ate = (n: number) => Math.round((teto * soma(pesos.slice(0, n))) / totalPesos);
    return ate(i + 1) - ate(i);
  });
  const tetoSemana = planejado.map((p) => Math.round(p * config.limiteAcumuloPct));

  const { semanaAtual, encerrado } = situacaoNoMes(config.competencia, hoje);
  const k = semanaAtual ?? 5; // mês encerrado: todas as semanas são passadas

  const compradoAntes = (j: number) => soma(comprado.slice(0, j - 1));
  const pesosDesde = (j: number) => soma(pesos.slice(j - 1));

  /** Orçamento de uma semana j calculado no início dela. */
  const orcamentoNoInicio = (j: number) => {
    const saldoIni = teto - compradoAntes(j);
    if (saldoIni <= 0) return 0;
    return naoNegativo(Math.min(Math.round((saldoIni * pesos[j - 1]) / pesosDesde(j)), tetoSemana[j - 1]));
  };

  const orcamentos: number[] = [];
  let baseFuturas = 0;
  for (let j = 1; j <= 4; j++) {
    if (j <= k) {
      orcamentos.push(orcamentoNoInicio(j));
    } else {
      // futura: o que sobra depois da semana atual, distribuído pelas semanas seguintes
      baseFuturas = teto - compradoAntes(k) - Math.max(comprado[k - 1], orcamentos[k - 1]);
      const pesosFuturos = soma(pesos.slice(k));
      const valor = baseFuturas > 0 && pesosFuturos > 0 ? Math.round((baseFuturas * pesos[j - 1]) / pesosFuturos) : 0;
      orcamentos.push(naoNegativo(Math.min(valor, tetoSemana[j - 1])));
    }
  }
  // O arredondamento semana a semana não pode alocar mais que a base (nem 1 centavo).
  if (k < 4) {
    const excesso = soma(orcamentos.slice(k)) - naoNegativo(baseFuturas);
    if (excesso > 0) orcamentos[3] = naoNegativo(orcamentos[3] - excesso);
  }

  const semanasOrc: SemanaOrcamento[] = semanas.map((s, i) => {
    const situacao: SituacaoSemana = s.numero < k ? "encerrada" : s.numero === k ? "atual" : "futura";
    return {
      ...s,
      situacao,
      planejadoOriginal: planejado[i],
      orcamento: orcamentos[i],
      orcamentoAtual: situacao === "encerrada" ? comprado[i] : orcamentos[i],
      comprado: comprado[i],
    };
  });

  // Semana atual entra pelo maior entre orçamento e comprado (mesma regra da base das
  // semanas futuras): um estouro da semana já foi descontado das próximas e não é reserva.
  const alocadoMes = soma(
    semanasOrc.map((s) => (s.situacao === "encerrada" ? s.comprado : s.situacao === "atual" ? Math.max(s.orcamento, s.comprado) : s.orcamento)),
  );

  const saldoInicioSemana = encerrado ? teto - compradoMes : teto - compradoAntes(k);
  const orcamentoSemana = encerrado ? 0 : orcamentos[k - 1];
  const compradoSemana = encerrado ? 0 : comprado[k - 1];
  const disponivelAgora = orcamentoSemana - compradoSemana;

  // Ritmo de compra: sem prorratear a semana atual por dia (compra de segunda abastece seg–qui).
  const esperado = encerrado ? soma(orcamentos) : soma(orcamentos.slice(0, k));
  const desvio = compradoMes - esperado;
  const desvioPct = esperado > 0 ? desvio / esperado : compradoMes > 0 ? Infinity : 0;

  return {
    categoriaId: categoria.id,
    teto,
    compradoMes,
    saldo: teto - compradoMes,
    semanaAtual,
    saldoInicioSemana,
    orcamentoSemana,
    compradoSemana,
    disponivelAgora,
    semSaldo: !encerrado && saldoInicioSemana <= 0,
    estouroSemana: !encerrado && disponivelAgora < 0,
    estouroMes: compradoMes > teto,
    semanas: semanasOrc,
    alocadoMes,
    reserva: teto - alocadoMes,
    ritmo: { esperadoAteFimDaSemana: esperado, comprado: compradoMes, desvio, desvioPct, cor: corDoRitmo(desvioPct) },
  };
}

// -----------------------------------------------------------------------------
// CMV
//   venda_base      = min(venda do caixa, venda_base_erp) se o ERP foi informado; senão o caixa
//   cmv_compras_pct = Σ notas do mês / venda_base
//   cmv_real        = estoque_inicial + compras − estoque_final (só com as duas contagens)
// -----------------------------------------------------------------------------

export function classificarRegua(pct: number | null, regua: FaixaRegua[]): FaixaRegua | null {
  if (pct === null || !Number.isFinite(pct) || regua.length === 0) return null;
  const ordenada = [...regua].sort((a, b) => a.ordem - b.ordem);
  return ordenada.find((f) => f.limiteSuperiorPct === null || pct <= f.limiteSuperiorPct) ?? ordenada[ordenada.length - 1];
}

export type ResultadoCmv = {
  vendaCaixa: Centavos;
  vendaBaseErp: Centavos | null;
  vendaBase: Centavos;
  /** caixa − ERP (null sem ERP) */
  divergenciaBase: Centavos | null;
  compras: Centavos;
  cmvComprasPct: number | null;
  estoqueInicial: Centavos | null;
  estoqueFinal: Centavos | null;
  cmvReal: Centavos | null;
  cmvRealPct: number | null;
  /** % usado para a régua: o real quando existe, senão o de compras */
  cmvPct: number | null;
  tipo: "real" | "compras";
  faixa: FaixaRegua | null;
};

export function calcularCmv(params: {
  compras: Centavos;
  vendaCaixa: Centavos;
  vendaBaseErp?: Centavos | null;
  estoqueInicial?: Centavos | null;
  estoqueFinal?: Centavos | null;
  regua: FaixaRegua[];
}): ResultadoCmv {
  const { compras, vendaCaixa, regua } = params;
  const vendaBaseErp = params.vendaBaseErp ?? null;
  const estoqueInicial = params.estoqueInicial ?? null;
  const estoqueFinal = params.estoqueFinal ?? null;

  const vendaBase = vendaBaseErp !== null ? Math.min(vendaCaixa, vendaBaseErp) : vendaCaixa;
  const pct = (v: number) => (vendaBase > 0 ? v / vendaBase : null);
  const cmvReal = estoqueInicial !== null && estoqueFinal !== null ? estoqueInicial + compras - estoqueFinal : null;
  // Sem compras lançadas, "0%" seria enganoso (parece CMV ótimo): fica sem valor e sem faixa.
  const cmvComprasPct = compras > 0 ? pct(compras) : null;
  const cmvRealPct = cmvReal !== null ? pct(cmvReal) : null;
  const cmvPct = cmvRealPct ?? cmvComprasPct;

  return {
    vendaCaixa,
    vendaBaseErp,
    vendaBase,
    divergenciaBase: vendaBaseErp !== null ? vendaCaixa - vendaBaseErp : null,
    compras,
    cmvComprasPct,
    estoqueInicial,
    estoqueFinal,
    cmvReal,
    cmvRealPct,
    cmvPct,
    tipo: cmvReal !== null ? "real" : "compras",
    faixa: classificarRegua(cmvPct, regua),
  };
}

// -----------------------------------------------------------------------------
// Régua por categoria: a régua do total (meta 35%) escalada para a meta da categoria.
//   limite_cat = limite_total × pct_meta_cat / meta_cmv_pct
// Ex.: Pescados (26,67%): Ótimo ≤ 27,43% · Bom ≤ 28,57% · Atenção ≤ 29,71% · Crítico acima.
// -----------------------------------------------------------------------------

export function reguaDaCategoria(regua: FaixaRegua[], pctMetaCategoria: number, metaCmvPct: number): FaixaRegua[] {
  const fator = metaCmvPct > 0 ? pctMetaCategoria / metaCmvPct : 1;
  return regua.map((f) => ({ ...f, limiteSuperiorPct: f.limiteSuperiorPct === null ? null : f.limiteSuperiorPct * fator }));
}

// -----------------------------------------------------------------------------
// CMV projetado de fechamento (para onde vamos)
//   planejado_restante_cat = Σ planejado ORIGINAL das semanas futuras
//                            + max(0, planejado original da semana atual − comprado na semana atual)
//   cmv_projetado          = (compras do mês + planejado restante) / projeção conservadora
// O planejado original (não o redistribuído) faz as compras além do plano aparecerem.
// -----------------------------------------------------------------------------

export type CmvProjetadoCategoria = {
  categoriaId: string;
  compras: Centavos;
  planejadoRestante: Centavos;
  projetado: Centavos;
  pct: number | null;
  faixa: FaixaRegua | null;
};

export type CmvProjetado = {
  compras: Centavos;
  planejadoRestante: Centavos;
  projetado: Centavos;
  pct: number | null;
  faixa: FaixaRegua | null;
  /** teto total (meta × projeção) − compras do mês: "ainda pode comprar até…" (negativo = passou do teto) */
  podeComprar: Centavos;
  porCategoria: CmvProjetadoCategoria[];
};

export function planejadoRestante(semanas: Pick<SemanaOrcamento, "situacao" | "planejadoOriginal" | "comprado">[]): Centavos {
  return soma(
    semanas.map((s) =>
      s.situacao === "futura" ? s.planejadoOriginal : s.situacao === "atual" ? naoNegativo(s.planejadoOriginal - s.comprado) : 0,
    ),
  );
}

export function calcularCmvProjetado(params: {
  categorias: (Pick<OrcamentoCategoria, "categoriaId" | "compradoMes" | "semanas"> & { pctMeta: number })[];
  projecao: Centavos;
  metaCmvPct: number;
  regua: FaixaRegua[];
}): CmvProjetado {
  const { projecao, metaCmvPct, regua } = params;
  const pct = (v: Centavos) => (projecao > 0 ? v / projecao : null);
  const porCategoria = params.categorias.map((c) => {
    const restante = planejadoRestante(c.semanas);
    const projetado = c.compradoMes + restante;
    const p = pct(projetado);
    return {
      categoriaId: c.categoriaId,
      compras: c.compradoMes,
      planejadoRestante: restante,
      projetado,
      pct: p,
      faixa: classificarRegua(p, reguaDaCategoria(regua, c.pctMeta, metaCmvPct)),
    };
  });
  const compras = soma(porCategoria.map((c) => c.compras));
  const restante = soma(porCategoria.map((c) => c.planejadoRestante));
  const projetado = compras + restante;
  const p = pct(projetado);
  return {
    compras,
    planejadoRestante: restante,
    projetado,
    pct: p,
    faixa: classificarRegua(p, regua),
    podeComprar: Math.round(projecao * metaCmvPct) - compras,
    porCategoria,
  };
}

// -----------------------------------------------------------------------------
// CMV por semana fechada (como fomos)
//   Semana fechada = o último dia já passou e todos os dias dela têm venda registrada.
//   CMV da semana = compras da semana (pela data da nota) / venda da semana.
//   Acumulado = soma das semanas fechadas (compensa compras de sexta que abastecem
//   o fim de semana e caem parte na semana seguinte).
// -----------------------------------------------------------------------------

export type SituacaoSemanaCmv = "fechada" | "em_andamento" | "aguardando_vendas" | "futura";

export type CmvBloco = {
  venda: Centavos;
  compras: Centavos;
  comprasPorCategoria: Record<string, Centavos>;
  /** só em semana fechada (e no acumulado); null nos demais casos ou sem venda */
  pct: number | null;
  faixa: FaixaRegua | null;
  pctPorCategoria: Record<string, number | null>;
  faixaPorCategoria: Record<string, FaixaRegua | null>;
};

export type CmvSemana = Semana & CmvBloco & { situacao: SituacaoSemanaCmv };

export type CmvSemanas = {
  semanas: CmvSemana[];
  /** null enquanto nenhuma semana estiver fechada */
  acumulado: (CmvBloco & { semanas: NumeroSemana[] }) | null;
};

export function calcularCmvSemanas(params: {
  config: Pick<ConfigMes, "competencia" | "metaCmvPct">;
  categorias: Pick<Categoria, "id" | "pctMeta">[];
  notas: NotaCalc[];
  /** vendas que contam (sem o dia parcial de hoje) */
  vendas: VendaDia[];
  /** dias com venda registrada (completos) */
  diasComVenda: DataCivil[];
  hoje: DataCivil;
  regua: FaixaRegua[];
}): CmvSemanas {
  const { config, categorias, hoje, regua } = params;
  const notas = notasValidas(params.notas, config.competencia);
  const vendas = params.vendas.filter((v) => mesmoMes(v.data, config.competencia));
  const comVenda = new Set(params.diasComVenda);
  const reguas = new Map(categorias.map((c) => [c.id, reguaDaCategoria(regua, c.pctMeta, config.metaCmvPct)]));

  const bloco = (venda: Centavos, notasBloco: NotaCalc[], comPct: boolean): CmvBloco => {
    const comprasPorCategoria: Record<string, Centavos> = Object.fromEntries(
      categorias.map((c) => [c.id, soma(notasBloco.filter((n) => n.categoriaId === c.id).map((n) => n.valor))]),
    );
    const compras = soma(Object.values(comprasPorCategoria));
    const pct = (v: Centavos) => (comPct && venda > 0 ? v / venda : null);
    const pctPorCategoria: Record<string, number | null> = Object.fromEntries(categorias.map((c) => [c.id, pct(comprasPorCategoria[c.id])]));
    return {
      venda,
      compras,
      comprasPorCategoria,
      pct: pct(compras),
      faixa: classificarRegua(pct(compras), regua),
      pctPorCategoria,
      faixaPorCategoria: Object.fromEntries(categorias.map((c) => [c.id, classificarRegua(pctPorCategoria[c.id], reguas.get(c.id) ?? regua)])),
    };
  };

  const dentro = (d: DataCivil, s: Semana) => d >= s.inicio && d <= s.fim;
  const semanas: CmvSemana[] = semanasDoMes(config.competencia).map((s) => {
    const dias = diasDoMes(config.competencia).filter((d) => dentro(d, s));
    const situacao: SituacaoSemanaCmv =
      s.inicio > hoje ? "futura" : s.fim >= hoje ? "em_andamento" : dias.every((d) => comVenda.has(d)) ? "fechada" : "aguardando_vendas";
    const venda = soma(vendas.filter((v) => dentro(v.data, s)).map((v) => v.total));
    return { ...s, situacao, ...bloco(venda, notas.filter((n) => dentro(n.data, s)), situacao === "fechada") };
  });

  const fechadas = semanas.filter((s) => s.situacao === "fechada");
  const acumulado = fechadas.length
    ? {
        semanas: fechadas.map((s) => s.numero),
        ...bloco(
          soma(fechadas.map((s) => s.venda)),
          notas.filter((n) => fechadas.some((s) => dentro(n.data, s))),
          true,
        ),
      }
    : null;
  return { semanas, acumulado };
}

// -----------------------------------------------------------------------------
// Painel: junta tudo para a tela principal
// -----------------------------------------------------------------------------

export type ResultadoPainel = {
  hoje: DataCivil;
  projecao: Projecao;
  /** dias de 1 até ontem sem venda; não vazio → orçamento provisório */
  diasSemVenda: DataCivil[];
  vendasIncompletas: boolean;
  categorias: (OrcamentoCategoria & { nome: string; pctMeta: number })[];
  tetoTotal: Centavos;
  compradoTotal: Centavos;
  /** CMV parcial (compras ÷ venda até ontem): só informativo no painel */
  cmv: ResultadoCmv;
  /** indicador principal do card de CMV */
  cmvProjetado: CmvProjetado;
  cmvSemanas: CmvSemanas;
};

export function calcularPainel(params: {
  config: ConfigMes;
  categorias: Categoria[];
  notas: NotaCalc[];
  vendas: VendaDia[];
  hoje: DataCivil;
  /** se omitido, usa ontem/último dia com venda */
  hojeRef?: DataCivil | null;
  /** dias com venda registrada (inclusive os de valor zero); se omitido, os dias de `vendas` */
  diasComVenda?: DataCivil[];
  /** hoje já tem os dois turnos preenchidos? Se não (padrão), a venda de hoje é ignorada no cálculo. */
  hojeCompleto?: boolean;
  regua: FaixaRegua[];
  vendaBaseErp?: Centavos | null;
  estoqueInicial?: Centavos | null;
  estoqueFinal?: Centavos | null;
}): ResultadoPainel {
  const { config, hoje } = params;
  const hojeCompleto = params.hojeCompleto ?? false;
  // Dia parcial (hoje incompleto) fica fora de tudo: projeção, ritmo e CMV.
  const conta = (d: DataCivil) => d < hoje || (hojeCompleto && d === hoje);
  const vendasMes = params.vendas.filter((v) => mesmoMes(v.data, config.competencia) && conta(v.data));
  const diasComVenda = (params.diasComVenda ?? vendasMes.map((v) => v.data)).filter(conta);
  const hojeRef = params.hojeRef !== undefined ? params.hojeRef : definirHojeRef(hoje, diasComVenda, hojeCompleto);
  const faltando = diasSemVenda(config.competencia, hoje, diasComVenda);

  const projecao = calcularProjecao({ config, vendas: vendasMes, hojeRef });
  const categorias = params.categorias.map((c) => ({
    ...calcularOrcamentoCategoria({ config, categoria: c, projecao: projecao.projecao, notas: params.notas, hoje }),
    nome: c.nome,
    pctMeta: c.pctMeta,
  }));
  const compradoTotal = soma(categorias.map((c) => c.compradoMes));
  const cmvProjetado = calcularCmvProjetado({ categorias, projecao: projecao.projecao, metaCmvPct: config.metaCmvPct, regua: params.regua });
  const cmvSemanas = calcularCmvSemanas({
    config,
    categorias: params.categorias,
    notas: params.notas,
    vendas: vendasMes,
    diasComVenda,
    hoje,
    regua: params.regua,
  });

  return {
    hoje,
    projecao,
    diasSemVenda: faltando,
    vendasIncompletas: faltando.length > 0,
    categorias,
    tetoTotal: Math.round(projecao.projecao * config.metaCmvPct),
    compradoTotal,
    cmv: calcularCmv({
      compras: compradoTotal,
      vendaCaixa: soma(vendasMes.map((v) => v.total)),
      vendaBaseErp: params.vendaBaseErp,
      estoqueInicial: params.estoqueInicial,
      estoqueFinal: params.estoqueFinal,
      regua: params.regua,
    }),
    cmvProjetado,
    cmvSemanas,
  };
}
