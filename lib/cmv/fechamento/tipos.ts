// Fechamento do mês: tipos da ENTRADA (dados brutos do banco, já em centavos) e do
// SNAPSHOT (o que é gravado ao fechar e de onde saem o PDF e o Excel).
// O snapshot é JSON puro e versionado (`formato`): nunca mude o significado de um
// campo existente; acrescente campos novos.

import type { DataCivil } from "../datas";
import type { Centavos } from "../dinheiro";
import type { CmvSemanas, FaixaRegua, PesosSemana } from "../engine";
import type { Conferencia, FormaPagamento, TipoNota } from "../tipos";

export type Origem = "restaurante" | "oji_tele" | "shakai_tele" | "wabi_tele";
export const ORIGENS: Origem[] = ["restaurante", "oji_tele", "shakai_tele", "wabi_tele"];
export const ROTULO_ORIGEM: Record<Origem, string> = {
  restaurante: "Restaurante",
  oji_tele: "Oji Tele",
  shakai_tele: "Shakai Tele",
  wabi_tele: "Wabi Tele",
};

// -----------------------------------------------------------------------------
// Entrada
// -----------------------------------------------------------------------------

export type NotaEntrada = {
  id: string;
  data: DataCivil;
  fornecedorId: string;
  fornecedorNome: string;
  /** fornecedor já revisado pelo admin (revisado_em preenchido) */
  fornecedorRevisado: boolean;
  categoriaId: string;
  tipo: TipoNota;
  numero: string | null;
  valor: Centavos;
  vencimento: DataCivil | null;
  formaPagamento: FormaPagamento;
  conferencia: Conferencia;
  conferenciaObs: string | null;
  observacao: string | null;
  pendenciaJustificativa: string | null;
};

export type VendaTurnoEntrada = {
  data: DataCivil;
  turno: 1 | 2;
  origem: Origem;
  dinheiro: Centavos;
  credito: Centavos;
  debito: Centavos;
  pix: Centavos;
  lojaDinheiro: Centavos;
  lojaCartao: Centavos;
  online: Centavos;
  total: Centavos;
  qtdPedidos: number | null;
  fonte: "planilha" | "manual";
};

export type ItemContagemEntrada = {
  nome: string;
  unidade: string;
  categoriaId: string;
  /** milésimos */
  quantidade: number;
  custo: Centavos;
  valor: Centavos;
};

export type ContagemEntrada = {
  data: DataCivil;
  status: "rascunho" | "finalizada";
  itens: ItemContagemEntrada[];
};

export type DivergenciaCaixa = {
  data: DataCivil;
  turno: number;
  tipo: "total_origem" | "total_dia";
  origem?: string;
  diferenca: Centavos;
};

export type HistoricoEntrada = {
  competencia: DataCivil;
  venda: Centavos;
  cmvValor: Centavos | null;
  cmvPct: number;
  fonte: "historico" | "sistema";
  /** CMV em R$ calculado (venda × %) porque o histórico só tinha o % */
  cmvCalculado?: boolean;
};

export type EntradaFechamento = {
  competencia: DataCivil;
  /** data civil de São Paulo de quando os dados foram lidos */
  hoje: DataCivil;
  mes: {
    id: string | null;
    status: "aberto" | "fechado";
    metaVenda: Centavos;
    metaCmvPct: number;
    pesosSemana: PesosSemana;
    limiteAcumuloPct: number;
    /** total ERP + delivery informado pelo admin */
    vendaBaseErp: Centavos | null;
  };
  pesosDiaSemana: number[];
  regua: FaixaRegua[];
  categorias: { id: string; nome: string; slug: string; pctMeta: number; ordem: number }[];
  /** só notas ATIVAS do mês */
  notas: NotaEntrada[];
  vendas: VendaTurnoEntrada[];
  /** dias com aba sincronizada (fechamento_turno), mesmo sem linha de venda */
  diasComFechamentoTurno: DataCivil[];
  conflitosPendentes: { data: DataCivil; turno: number; origem: string }[];
  divergenciasCaixa: DivergenciaCaixa[];
  mercadoSemNota: { data: DataCivil; valor: Centavos }[];
  /** contagem com "Fechamento de" = o mês (qualquer status) */
  contagemFinal: ContagemEntrada | null;
  /** contagem FINALIZADA do mês anterior */
  contagemInicial: (ContagemEntrada & { competencia: DataCivil }) | null;
  /** meses anteriores (historico_mensal + snapshots de meses fechados), qualquer ordem */
  historico: HistoricoEntrada[];
  /**
   * Mês que fecha com corte de estoque (decisão 110): notas ativas do mês SEGUINTE com a
   * observação de corte. Vazio nos demais meses.
   */
  notasCorteMesSeguinte: { data: DataCivil; fornecedor: string; valor: Centavos }[];
};

// -----------------------------------------------------------------------------
// Checklist
// -----------------------------------------------------------------------------

export type IdChecklist = "mes_encerrado" | "vendas" | "contagem" | "conferencia" | "sem_nota" | "fornecedores" | "erp";

export type ItemChecklist = {
  id: IdChecklist;
  titulo: string;
  ok: boolean;
  /** "Tudo certo" ou o que falta, numa frase */
  resumo: string;
  /** até algumas linhas com o que falta (dias, notas, fornecedores) */
  detalhes: string[];
  /** tela que resolve; null quando se resolve aqui mesmo (ERP) ou só esperando (mês encerrado) */
  href: string | null;
  acao: string | null;
};

// -----------------------------------------------------------------------------
// Snapshot (formato 1)
// -----------------------------------------------------------------------------

export type Assinatura = {
  notas: number;
  notasTotal: Centavos;
  vendasTotal: Centavos;
  erp: Centavos | null;
  estoqueFinal: Centavos | null;
  estoqueInicial: Centavos | null;
};

export type LinhaCategoria = {
  id: string;
  nome: string;
  pctMeta: number;
  compras: Centavos;
  comprasPct: number | null;
  /** só quando o mês tem CMV real */
  estoqueInicial: Centavos | null;
  estoqueFinal: Centavos | null;
  real: Centavos | null;
  realPct: number | null;
  /** o valor oficial do mês: real quando existe, senão compras */
  cmv: Centavos;
  cmvPct: number | null;
};

export type SemanaPlanejada = { numero: number; inicio: DataCivil; fim: DataCivil; planejado: Centavos; comprado: Centavos };

export type NotaSnapshot = {
  id: string;
  data: DataCivil;
  fornecedor: string;
  categoriaId: string;
  categoria: string;
  tipo: TipoNota;
  numero: string | null;
  valor: Centavos;
  vencimento: DataCivil | null;
  formaPagamento: FormaPagamento;
  conferencia: Conferencia;
  conferenciaObs: string | null;
  observacao: string | null;
  pendenciaJustificativa: string | null;
};

export type BlocoVendas = {
  total: Centavos;
  porOrigem: Record<Origem, Centavos>;
  /** delivery por marca (só as teles) */
  porMarca: { oji: Centavos; shakai: Centavos; wabi: Centavos };
  porTurno: { 1: Centavos; 2: Centavos };
  /** formas de pagamento do restaurante */
  restaurante: { dinheiro: Centavos; credito: Centavos; debito: Centavos; pix: Centavos };
  /** teles: recebido na loja e online */
  teles: { lojaDinheiro: Centavos; lojaCartao: Centavos; online: Centavos; pedidos: number };
  pedidosPorMarca: { oji: number; shakai: number; wabi: number };
};

export type DadosFechamento = {
  formato: 1;
  competencia: DataCivil;
  /** true = mês aberto (dados podem mudar) */
  previa: boolean;
  /** ISO do momento em que os dados foram montados */
  geradoEm: string;
  hoje: DataCivil;
  /** preenchidos pelo banco/carregador quando o mês está fechado */
  fechamento: { versao: number; fechadoEm: string; fechadoPor: string } | null;

  config: { metaVenda: Centavos; metaCmvPct: number; pesosSemana: PesosSemana; limiteAcumuloPct: number };
  regua: FaixaRegua[];
  categorias: { id: string; nome: string; pctMeta: number }[];

  vendas: BlocoVendas & {
    porDia: { data: DataCivil; turno1: Centavos; turno2: Centavos; total: Centavos; semMovimento: boolean; fonte: "planilha" | "manual" | "misto" | null }[];
    diasSemVenda: DataCivil[];
  };

  base: {
    caixa: Centavos;
    erp: Centavos | null;
    base: Centavos;
    /** caixa − ERP (null sem ERP) */
    divergencia: Centavos | null;
    origem: "caixa" | "erp" | "sem_erp";
    nota: string;
  };

  cmv: {
    tipo: "real" | "compras";
    compras: Centavos;
    comprasPct: number | null;
    real: Centavos | null;
    realPct: number | null;
    /** oficial do mês (real quando há, senão compras) */
    valor: Centavos;
    pct: number | null;
    faixa: FaixaRegua | null;
    metaPct: number;
    /** meta × base: até quanto o CMV poderia ir */
    metaValor: Centavos;
    porCategoria: LinhaCategoria[];
  };

  variacao: {
    anterior: { competencia: DataCivil; venda: Centavos; cmvPct: number } | null;
    /** fração (0,018 = +1,8%) */
    venda: number | null;
    /** pontos percentuais em fração (−0,053 = −5,3 p.p.) */
    cmv: number | null;
  };

  cmvSemanas: CmvSemanas;
  planejadoComprado: { categoriaId: string; categoria: string; teto: Centavos; semanas: SemanaPlanejada[] }[];

  estoque: {
    inicial: { competencia: DataCivil; data: DataCivil; valor: Centavos; porCategoria: Record<string, Centavos> } | null;
    final: { data: DataCivil; valor: Centavos; porCategoria: Record<string, Centavos>; itens: ItemContagemEntrada[] } | null;
    /** o estoque entrou no CMV (inicial e final existem) */
    descontado: boolean;
    nota: string | null;
  };

  fornecedores: { nome: string; notas: number; total: Centavos; pct: number }[];
  notas: NotaSnapshot[];

  alertas: {
    divergenciasCaixa: DivergenciaCaixa[];
    mercadoSemNota: { data: DataCivil; valor: Centavos }[];
    semNota: NotaSnapshot[];
    divergentes: NotaSnapshot[];
    observacoes: NotaSnapshot[];
    conflitosPendentes: number;
  };

  /** notas gerenciais fixas do mês (ex.: corte de estoque, decisão 110) */
  notasGerenciais: string[];
  historico: HistoricoEntrada[];
  /** linhas prontas para o DRE Gerencial */
  dre: { linha: string; valor: Centavos; pct: number | null; nivel: 0 | 1 }[];
  checklist: ItemChecklist[];
  assinatura: Assinatura;
};
