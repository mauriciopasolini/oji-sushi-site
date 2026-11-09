// =============================================================================
// Leitor da aba diária da planilha de fechamento de caixa — FUNÇÃO PURA.
//
// Localiza tudo por ÂNCORAS DE TEXTO (nunca por coordenada fixa), normalizando
// acentos, caixa e espaços: "TURNO 1"/"TURNO 2" definem os dois blocos lado a lado;
// dentro de cada bloco, "Restaurante", "Oji Tele", "Shakai Tele", "Wabi Tele" e
// "Despesas" definem as seções; o valor de um rótulo é a primeira célula numérica
// à direita na mesma linha (ou, se não houver, logo abaixo). Célula vazia = 0.
//
// Sem imports (roda também direto no Node, pelo script de teste).
// Dinheiro em centavos inteiros.
// =============================================================================

export type Celula = string | number | boolean | null | undefined;
export type Grade = Celula[][];

export type OrigemPlanilha = "restaurante" | "oji_tele" | "shakai_tele" | "wabi_tele";
export type CampoPlanilha = "dinheiro" | "credito" | "debito" | "pix" | "loja_dinheiro" | "loja_cartao" | "online";

export type OrigemLida = {
  campos: Record<CampoPlanilha, number>;
  qtdPedidos: number | null;
  /** "Total" da origem como está na planilha (pode ter erro de fórmula) */
  totalPlanilha: number | null;
  /** soma das partes — é o valor usado */
  totalCalculado: number;
  /** totalPlanilha − totalCalculado (0 se não há total na planilha) */
  divergencia: number;
  encontrada: boolean;
};

export type TurnoLido = {
  turno: 1 | 2;
  origens: Record<OrigemPlanilha, OrigemLida>;
  despesas: { mercado: number; motoboy: number; outros: number; total: number | null };
  totalDia: number | null;
  totalPedidos: number | null;
  dinheiroEmCaixa: number | null;
  /** soma dos totais calculados das origens */
  somaOrigens: number;
  /** totalDia (planilha) − somaOrigens */
  divergenciaTotalDia: number | null;
  /** de onde veio cada valor (ex.: "restaurante.pix": "C12"), para depuração */
  celulas: Record<string, string>;
};

export type AbaLida = {
  turnos: TurnoLido[];
  /** aba sem nenhum valor (copiada e não preenchida) */
  vazia: boolean;
  avisos: string[];
};

// -----------------------------------------------------------------------------
// Utilitários
// -----------------------------------------------------------------------------

export function normalizar(c: Celula): string {
  return String(c ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Número da célula em centavos, ou null se não for numérica. Aceita 1234.56, "R$ 1.234,56", "1234,56", "-R$ 10,00". */
export function numeroCentavos(c: Celula): number | null {
  if (typeof c === "number") return Number.isFinite(c) ? Math.round(c * 100) : null;
  if (typeof c !== "string") return null;
  let s = c.trim();
  if (!s) return null;
  let negativo = false;
  if (/^\(.*\)$/.test(s)) {
    negativo = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/\s/g, "").replace(/^R\$/i, "").replace(/R\$/i, "");
  if (s.startsWith("-")) {
    negativo = !negativo;
    s = s.slice(1).replace(/^R\$/i, "");
  }
  if (!/^\d[\d.,]*$/.test(s)) return null;
  // pt-BR: "." milhar, "," decimal. Se só houver ".", decide pelo número de casas.
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/\.\d{3}$/.test(s) && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, "");
  const v = Number(s);
  if (!Number.isFinite(v)) return null;
  const centavos = Math.round(v * 100);
  return negativo ? -centavos : centavos;
}

function a1(linha: number, coluna: number): string {
  let s = "";
  let n = coluna + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return `${s}${linha + 1}`;
}

type Pos = { l: number; c: number };

const SECOES: { chave: OrigemPlanilha | "despesas"; ancoras: string[] }[] = [
  { chave: "restaurante", ancoras: ["restaurante"] },
  { chave: "oji_tele", ancoras: ["oji tele", "oji tele entrega", "oji"] },
  { chave: "shakai_tele", ancoras: ["shakai tele", "shakai"] },
  { chave: "wabi_tele", ancoras: ["wabi tele", "wabi"] },
  { chave: "despesas", ancoras: ["despesas", "despesa"] },
];

const ROTULOS_RESTAURANTE: Record<string, CampoPlanilha | "total"> = {
  dinheiro: "dinheiro",
  credito: "credito",
  "cartao credito": "credito",
  debito: "debito",
  "cartao debito": "debito",
  pix: "pix",
  total: "total",
};
const ROTULOS_TELE: Record<string, CampoPlanilha | "total" | "qtd"> = {
  "qtd pedidos": "qtd",
  "qtd de pedidos": "qtd",
  "quantidade pedidos": "qtd",
  "quantidade de pedidos": "qtd",
  pedidos: "qtd",
  dinheiro: "loja_dinheiro",
  "loja dinheiro": "loja_dinheiro",
  cartao: "loja_cartao",
  "loja cartao": "loja_cartao",
  online: "online",
  "on line": "online",
  total: "total",
};
const ROTULOS_DESPESAS: Record<string, "mercado" | "motoboy" | "outros" | "total"> = {
  mercado: "mercado",
  motoboy: "motoboy",
  motoboys: "motoboy",
  outros: "outros",
  outro: "outros",
  total: "total",
};

const vazioCampos = (): Record<CampoPlanilha, number> => ({
  dinheiro: 0, credito: 0, debito: 0, pix: 0, loja_dinheiro: 0, loja_cartao: 0, online: 0,
});

// -----------------------------------------------------------------------------
// Parser
// -----------------------------------------------------------------------------

export function lerAbaDiaria(grade: Grade): AbaLida {
  const avisos: string[] = [];
  const largura = Math.max(0, ...grade.map((l) => l?.length ?? 0));
  const texto = (l: number, c: number) => normalizar(grade[l]?.[c]);
  const valor = (l: number, c: number) => grade[l]?.[c];

  // Âncoras de turno (podem estar em qualquer linha; os blocos ficam lado a lado)
  const turnos: (Pos & { n: 1 | 2 })[] = [];
  for (let l = 0; l < grade.length; l++)
    for (let c = 0; c < largura; c++) {
      const t = texto(l, c);
      const m = /^turno\s*([12])\b/.exec(t);
      if (m && !turnos.some((x) => x.n === Number(m[1]))) turnos.push({ l, c, n: Number(m[1]) as 1 | 2 });
    }
  if (turnos.length < 2) {
    avisos.push(`Âncoras de turno não encontradas (achei: ${turnos.map((t) => `TURNO ${t.n}`).join(", ") || "nenhuma"}).`);
  }
  turnos.sort((a, b) => a.c - b.c || a.l - b.l);

  // O título "TURNO N" pode estar deslocado (ex.: centralizado em I1 com o bloco começando em H).
  // O bloco começa na menor coluna entre o título e a seção "Restaurante" correspondente.
  const restaurantes: Pos[] = [];
  for (let l = 0; l < grade.length; l++) for (let c = 0; c < largura; c++) if (texto(l, c) === "restaurante") restaurantes.push({ l, c });
  restaurantes.sort((x, y) => x.c - y.c || x.l - y.l);
  const inicios = turnos.map((t, i) => Math.min(t.c, restaurantes[i]?.c ?? t.c));

  const blocos = turnos.map((t, i) => ({
    turno: t.n,
    l0: t.l,
    c0: inicios[i],
    c1: i + 1 < turnos.length && inicios[i + 1] > inicios[i] ? inicios[i + 1] - 1 : largura - 1,
  }));

  const resultado: TurnoLido[] = [];
  for (const b of blocos) {
    const celulas: Record<string, string> = {};
    const dentro = (c: number) => c >= b.c0 && c <= b.c1;

    /**
     * Valor de um rótulo: 1ª célula numérica à direita, até `colFim` (parando em outro texto);
     * senão, logo abaixo.
     */
    const valorDoRotulo = (p: Pos, colFim = b.c1): { v: number; ref: string | null } => {
      for (let c = p.c + 1; c <= colFim; c++) {
        const bruto = valor(p.l, c);
        const n = numeroCentavos(bruto);
        if (n !== null) return { v: n, ref: a1(p.l, c) };
        if (typeof bruto === "string" && bruto.trim() && !/^r\$\s*$/i.test(bruto.trim())) break; // outro rótulo
      }
      const abaixo = numeroCentavos(valor(p.l + 1, p.c));
      if (abaixo !== null) return { v: abaixo, ref: a1(p.l + 1, p.c) };
      return { v: 0, ref: null }; // célula vazia = 0
    };

    // Seções do bloco, pela linha em que aparecem
    const achadas: { chave: (typeof SECOES)[number]["chave"]; l: number; c: number }[] = [];
    for (const s of SECOES) {
      let melhor: Pos | null = null;
      for (let l = b.l0; l < grade.length && !melhor; l++)
        for (let c = b.c0; c <= b.c1; c++) {
          const t = texto(l, c);
          if (s.ancoras.some((a) => t === a) && !achadas.some((x) => x.l === l && x.c === c)) {
            melhor = { l, c };
            break;
          }
        }
      if (melhor) achadas.push({ chave: s.chave, ...melhor });
      else avisos.push(`TURNO ${b.turno}: seção "${s.ancoras[0]}" não encontrada.`);
    }
    // Cada seção é um retângulo: colunas até a próxima seção à direita (seções podem ficar
    // lado a lado, como Restaurante | Despesas); linhas até a próxima seção na mesma faixa de colunas.
    const regiao = (sec: { l: number; c: number }) => {
      const aDireita = achadas.filter((x) => x.c > sec.c).map((x) => x.c);
      const colFim = aDireita.length ? Math.min(...aDireita) - 1 : b.c1;
      const abaixo = achadas.filter((x) => x.l > sec.l && x.c >= sec.c && x.c <= colFim).map((x) => x.l);
      const linhaFim = abaixo.length ? Math.min(...abaixo) - 1 : grade.length - 1;
      return { colFim, linhaFim };
    };

    // Resumo do turno (fora das seções): Total do Dia, Total Pedidos, Dinheiro em Caixa
    const rotuloResumo = (nomes: string[]): { v: number | null; ref: string | null } => {
      for (let l = b.l0; l < grade.length; l++)
        for (let c = b.c0; c <= b.c1; c++)
          if (nomes.includes(texto(l, c))) {
            const r = valorDoRotulo({ l, c });
            return { v: r.v, ref: r.ref };
          }
      return { v: null, ref: null };
    };

    const origens = {} as Record<OrigemPlanilha, OrigemLida>;
    for (const o of ["restaurante", "oji_tele", "shakai_tele", "wabi_tele"] as OrigemPlanilha[]) {
      origens[o] = { campos: vazioCampos(), qtdPedidos: null, totalPlanilha: null, totalCalculado: 0, divergencia: 0, encontrada: false };
    }
    const despesas: TurnoLido["despesas"] = { mercado: 0, motoboy: 0, outros: 0, total: null };

    achadas.forEach((sec) => {
      const mapa = sec.chave === "restaurante" ? ROTULOS_RESTAURANTE : sec.chave === "despesas" ? ROTULOS_DESPESAS : ROTULOS_TELE;
      const { colFim, linhaFim } = regiao(sec);
      const vistos = new Set<string>();
      for (let l = sec.l + 1; l <= linhaFim; l++)
        for (let c = sec.c; c <= colFim; c++) {
          const t = texto(l, c);
          const alvo = (mapa as Record<string, string>)[t];
          if (!alvo || vistos.has(alvo)) continue;
          // "Total do Dia"/"Total Pedidos" normalizam diferente de "Total": não se confundem
          vistos.add(alvo);
          const r = valorDoRotulo({ l, c }, colFim);
          if (r.ref) celulas[`${sec.chave}.${alvo}`] = r.ref;
          if (sec.chave === "despesas") {
            if (alvo === "total") despesas.total = r.ref ? r.v : null;
            else despesas[alvo as "mercado" | "motoboy" | "outros"] = r.v;
          } else {
            const og = origens[sec.chave];
            og.encontrada = true;
            if (alvo === "total") og.totalPlanilha = r.ref ? r.v : null;
            else if (alvo === "qtd") og.qtdPedidos = r.ref ? Math.round(r.v / 100) : null;
            else og.campos[alvo as CampoPlanilha] = r.v;
          }
        }
      if (sec.chave !== "despesas") origens[sec.chave].encontrada = true;
    });

    let somaOrigens = 0;
    for (const o of Object.values(origens)) {
      o.totalCalculado = Object.values(o.campos).reduce((a, v) => a + v, 0);
      o.divergencia = o.totalPlanilha === null ? 0 : o.totalPlanilha - o.totalCalculado;
      somaOrigens += o.totalCalculado;
    }

    const totalDia = rotuloResumo(["total do dia", "total dia", "total do turno"]);
    const totalPedidos = rotuloResumo(["total pedidos", "total de pedidos"]);
    const caixa = rotuloResumo(["dinheiro em caixa", "dinheiro no caixa"]);
    if (totalDia.ref) celulas["total_dia"] = totalDia.ref;
    if (totalPedidos.ref) celulas["total_pedidos"] = totalPedidos.ref;
    if (caixa.ref) celulas["dinheiro_em_caixa"] = caixa.ref;
    if (totalDia.v === null) avisos.push(`TURNO ${b.turno}: "Total do Dia" não encontrado.`);

    resultado.push({
      turno: b.turno,
      origens,
      despesas,
      totalDia: totalDia.ref ? totalDia.v : totalDia.v === null ? null : 0,
      totalPedidos: totalPedidos.ref ? Math.round((totalPedidos.v ?? 0) / 100) : null,
      dinheiroEmCaixa: caixa.ref ? caixa.v : null,
      somaOrigens,
      divergenciaTotalDia: totalDia.ref ? (totalDia.v ?? 0) - somaOrigens : null,
      celulas,
    });
  }

  resultado.sort((x, y) => x.turno - y.turno);
  const vazia =
    resultado.length > 0 &&
    resultado.every((t) => t.somaOrigens === 0 && !t.totalDia && t.despesas.mercado + t.despesas.motoboy + t.despesas.outros === 0);
  return { turnos: resultado, vazia, avisos };
}

/** Nome de aba "DD/MM" → "AAAA-MM-DD" (ano da competência); outras abas (Metas, Motoboys…) → null. */
export function dataDaAba(titulo: string, ano: number): string | null {
  const m = /^\s*(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*$/.exec(titulo);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > new Date(Date.UTC(ano, mes, 0)).getUTCDate()) return null;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** ID da planilha a partir do link do Google Sheets (ou o próprio ID). */
export function idDaPlanilha(urlOuId: string): string | null {
  const m = /\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/.exec(urlOuId) ?? /^([a-zA-Z0-9_-]{20,})$/.exec(urlOuId.trim());
  return m ? m[1] : null;
}
