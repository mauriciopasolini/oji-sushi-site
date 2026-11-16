import "server-only";
// Relatório "Fechamento de CMV" (PDF A4), na identidade PZO, com o layout do DRE
// Gerencial como referência. Gerado a partir de DadosFechamento (snapshot ou prévia).
//
// Fontes: corpo em Helvetica (padrão do PDF, sem embutir); títulos em Gelasio, serifa
// livre (OFL) com as mesmas métricas da Georgia, embutida (a Georgia é proprietária).
// Helvetica cobre o Latin-1 (acentos, "–", "—", "·", "×"); evite "−", "≤", setas.

import path from "node:path";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import type { DataCivil } from "../datas";
import { classificarRegua } from "../engine";
import type { DadosFechamento, NotaSnapshot } from "../fechamento/tipos";
import { COR, RODAPE_PZO } from "./constantes";
import { brl, dataBR, dataBRCompleta, mesCurto, pct, pp, ROTULO_CONF, ROTULO_TIPO, tituloMes, valorBR, variacaoPct } from "../fechamento/formatos";


const DIR_FONTES = path.join(process.cwd(), "lib", "cmv", "relatorio", "fontes");
let fontesRegistradas = false;
function registrarFontes() {
  if (fontesRegistradas) return;
  Font.register({
    family: "Gelasio",
    fonts: [
      { src: path.join(DIR_FONTES, "Gelasio-Regular.ttf"), fontWeight: "normal" },
      { src: path.join(DIR_FONTES, "Gelasio-Bold.ttf"), fontWeight: "bold" },
    ],
  });
  // Sem hifenização automática (quebraria nomes e números).
  Font.registerHyphenationCallback((palavra) => [palavra]);
  fontesRegistradas = true;
}

const s = StyleSheet.create({
  pagina: { paddingTop: 42, paddingBottom: 58, paddingHorizontal: 44, fontFamily: "Helvetica", fontSize: 9, color: COR.texto, lineHeight: 1.35 },
  ferramenta: { fontFamily: "Gelasio", fontWeight: "bold", fontSize: 10, color: COR.marrom, marginBottom: 3 },
  kicker: { fontFamily: "Helvetica-Bold", fontSize: 8, color: COR.laranja, letterSpacing: 0.6 },
  titulo: { fontFamily: "Gelasio", fontWeight: "bold", fontSize: 24, lineHeight: 1.25, color: COR.preto, marginTop: 4, marginBottom: 2 },
  subtitulo: { fontSize: 11, color: COR.marrom, marginTop: 2 },
  reguaGrossa: { borderBottomWidth: 2, borderBottomColor: COR.preto, marginTop: 10, marginBottom: 12 },
  secao: { fontFamily: "Gelasio", fontWeight: "bold", fontSize: 14, lineHeight: 1.25, color: COR.preto, marginTop: 14 },
  secaoLinha: { borderBottomWidth: 1.2, borderBottomColor: COR.laranja, marginTop: 3, marginBottom: 8 },
  sub: { fontFamily: "Helvetica-Bold", fontSize: 10, color: COR.marrom, marginTop: 8, marginBottom: 4 },
  paragrafo: { marginBottom: 6 },
  nota: { backgroundColor: COR.fundo, borderLeftWidth: 3, borderLeftColor: COR.laranja, paddingVertical: 7, paddingHorizontal: 10, marginVertical: 6 },
  notaTexto: { fontFamily: "Helvetica-Bold", fontSize: 9 },
  legenda: { fontFamily: "Helvetica-Oblique", fontSize: 7.5, color: COR.cinza, marginTop: 3 },
  previa: { backgroundColor: COR.marrom, color: "#ffffff", fontFamily: "Helvetica-Bold", fontSize: 8.5, paddingVertical: 5, paddingHorizontal: 8, marginBottom: 10 },
  // tabelas
  tabela: { borderWidth: 0.6, borderColor: COR.preto, marginTop: 2 },
  thLinha: { flexDirection: "row", backgroundColor: COR.preto },
  th: { color: "#ffffff", fontFamily: "Helvetica-Bold", fontSize: 8, paddingVertical: 4, paddingHorizontal: 5 },
  tdLinha: { flexDirection: "row", borderTopWidth: 0.5, borderTopColor: COR.linha },
  td: { fontSize: 8.5, paddingVertical: 3.2, paddingHorizontal: 5 },
  // KPIs
  kpis: { flexDirection: "row", borderWidth: 0.6, borderColor: COR.preto, marginTop: 4 },
  kpi: { flex: 1, borderLeftWidth: 0.6, borderLeftColor: COR.preto },
  kpiTitulo: { backgroundColor: COR.preto, color: "#ffffff", fontFamily: "Helvetica-Bold", fontSize: 8, textAlign: "center", paddingVertical: 4 },
  kpiValor: { backgroundColor: COR.fundo, fontFamily: "Helvetica-Bold", fontSize: 13, textAlign: "center", paddingVertical: 6 },
  // rodapé e cabeçalho fixos
  // Rodapé por coordenada a partir do topo (A4 = 841,89 pt): "bottom" não se repetia nas páginas.
  rodapeLinha: { position: "absolute", top: 800, left: 44, right: 44, borderTopWidth: 1.2, borderTopColor: COR.preto },
  rodapeTexto: { position: "absolute", top: 805, fontFamily: "Helvetica-Oblique", fontSize: 7.5, color: COR.cinza },
  cabecalhoFixo: { position: "absolute", top: 18, left: 44, right: 44, flexDirection: "row", justifyContent: "space-between" },
  cabecalhoFixoTexto: { fontSize: 7.5, color: COR.cinza },
});

// -----------------------------------------------------------------------------
// Componentes
// -----------------------------------------------------------------------------

type Celula = string | { t: string; negrito?: boolean; cor?: string; italico?: boolean } | { barra: number; cor: string; opaco?: boolean };
type Coluna = { titulo: string; flex: number; alinhar?: "left" | "right" | "center" };
type Linha = { celulas: Celula[]; estilo?: "total" | "grupo" | "destaque" | "recuo" };

function Tabela({ colunas, linhas, quebra = true }: { colunas: Coluna[]; linhas: Linha[]; quebra?: boolean }) {
  return (
    <View style={s.tabela} wrap={quebra}>
      <View style={s.thLinha} fixed>
        {colunas.map((c, i) => (
          <Text key={i} style={[s.th, { flex: c.flex, textAlign: c.alinhar ?? "left" }]}>
            {c.titulo}
          </Text>
        ))}
      </View>
      {linhas.map((l, i) => (
        <View
          key={i}
          wrap={false}
          style={[
            s.tdLinha,
            l.estilo === "total" ? { backgroundColor: COR.preto } : {},
            l.estilo === "grupo" ? { backgroundColor: COR.fundo } : {},
            l.estilo === "destaque" ? { backgroundColor: "#ebe7e1" } : {},
          ]}
        >
          {l.celulas.map((c, j) => {
            if (typeof c !== "string" && "barra" in c)
              return (
                <View key={j} style={{ flex: colunas[j].flex, paddingHorizontal: 5, justifyContent: "center" }}>
                  <View style={{ height: 6, width: `${Math.max(1, Math.min(100, c.barra))}%`, backgroundColor: c.cor, opacity: c.opaco ? 1 : 0.45 }} />
                </View>
              );
            const cel = typeof c === "string" ? { t: c } : c;
            const total = l.estilo === "total";
            return (
              <Text
                key={j}
                style={[
                  s.td,
                  { flex: colunas[j].flex, textAlign: colunas[j].alinhar ?? "left" },
                  l.estilo === "recuo" && j === 0 ? { paddingLeft: 14 } : {},
                  cel.negrito || total || l.estilo === "grupo" ? { fontFamily: cel.italico ? "Helvetica-BoldOblique" : "Helvetica-Bold" } : {},
                  cel.italico && !(cel.negrito || total) ? { fontFamily: "Helvetica-Oblique" } : {},
                  total ? { color: "#ffffff" } : {},
                  l.estilo === "grupo" && !cel.cor ? { color: COR.marrom } : {},
                  cel.cor ? { color: cel.cor } : {},
                ]}
              >
                {cel.t}
              </Text>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function Secao({ titulo, children, quebrarAntes = false, inteira = false }: { titulo: string; children: ReactNode; quebrarAntes?: boolean; inteira?: boolean }) {
  // inteira: título e conteúdo nunca se separam (seção curta que não deve quebrar).
  return (
    <View break={quebrarAntes} wrap={!inteira}>
      <View wrap={false} minPresenceAhead={80}>
        <Text style={s.secao}>{titulo}</Text>
        <View style={s.secaoLinha} />
      </View>
      {children}
    </View>
  );
}

function Nota({ children, cor = COR.laranja, negrito = true }: { children: ReactNode; cor?: string; negrito?: boolean }) {
  return (
    <View style={[s.nota, { borderLeftColor: cor }]} wrap={false}>
      <Text style={negrito ? s.notaTexto : {}}>{children}</Text>
    </View>
  );
}

function Lista({ itens }: { itens: string[] }) {
  return (
    <View style={{ marginBottom: 4 }}>
      {itens.map((t, i) => (
        <View key={i} style={{ flexDirection: "row", marginBottom: 2 }} wrap={false}>
          <Text style={{ width: 10 }}>•</Text>
          <Text style={{ flex: 1 }}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

// -----------------------------------------------------------------------------
// Documento
// -----------------------------------------------------------------------------

const corDaFaixa = (d: DadosFechamento) => d.cmv.faixa?.cor ?? COR.texto;
const quando = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
const ROTULO_SITUACAO: Record<string, string> = { em_andamento: "em andamento", aguardando_vendas: "aguardando vendas", futura: "futura", fechada: "fechada" };
const rotuloSemana = (inicio: DataCivil, fim: DataCivil, n: number) => `S${n} · ${inicio.slice(8, 10)} a ${dataBR(fim)}`;

export function DocumentoFechamento({ d }: { d: DadosFechamento }) {
  const mes = tituloMes(d.competencia);
  const real = d.cmv.tipo === "real";
  const cats = d.categorias;
  const nomeCat = new Map(cats.map((c) => [c.id, c.nome]));
  const ant = d.variacao.anterior;
  // Uma régua só para o relatório inteiro (resumo, semanas e comparativo).
  const faixaDe = (p: number | null) => classificarRegua(p, d.regua);

  // 3. CMV por categoria
  const linhasCategoria: Linha[] = real
    ? [
        { celulas: ["RECEITA (base de cálculo)", valorBR(d.base.base), "100,0%", "", "", ""], estilo: "destaque" },
        {
          celulas: [
            { t: "(–) CMV — Custo da Mercadoria Vendida", cor: COR.marrom },
            valorBR(d.cmv.compras),
            pct(d.cmv.comprasPct),
            valorBR(d.cmv.real!),
            { t: pct(d.cmv.realPct), cor: corDaFaixa(d) },
            pct(d.cmv.metaPct),
          ],
          estilo: "grupo",
        },
        ...d.cmv.porCategoria.map((l) => ({
          celulas: [l.nome, valorBR(l.compras), pct(l.comprasPct), valorBR(l.real ?? 0), pct(l.realPct), pct(l.pctMeta)],
          estilo: "recuo" as const,
        })),
      ]
    : [
        { celulas: ["RECEITA (base de cálculo)", valorBR(d.base.base), "100,0%", ""], estilo: "destaque" },
        {
          celulas: [{ t: "(–) CMV — Custo da Mercadoria Vendida", cor: COR.marrom }, valorBR(d.cmv.valor), { t: pct(d.cmv.pct), cor: corDaFaixa(d) }, pct(d.cmv.metaPct)],
          estilo: "grupo",
        },
        ...d.cmv.porCategoria.map((l) => ({ celulas: [l.nome, valorBR(l.cmv), pct(l.cmvPct), pct(l.pctMeta)], estilo: "recuo" as const })),
      ];

  // 4. CMV por semana
  const colSemanas: Coluna[] = [
    { titulo: "Semana", flex: 2.2 },
    { titulo: "Venda (R$)", flex: 1.6, alinhar: "right" },
    { titulo: "Compras (R$)", flex: 1.6, alinhar: "right" },
    { titulo: "CMV", flex: 1, alinhar: "right" },
    ...cats.map((c) => ({ titulo: c.nome.split(" ")[0], flex: 1, alinhar: "right" as const })),
  ];
  const linhasSemanas: Linha[] = d.cmvSemanas.semanas.map((w) => ({
    celulas: [
      { t: `${rotuloSemana(w.inicio, w.fim, w.numero)}${w.situacao === "fechada" ? "" : ` (${ROTULO_SITUACAO[w.situacao]})`}`, italico: w.situacao !== "fechada" },
      valorBR(w.venda),
      valorBR(w.compras),
      { t: pct(w.pct), cor: w.faixa?.cor },
      ...cats.map((c) => ({ t: pct(w.pctPorCategoria[c.id]), cor: w.faixaPorCategoria[c.id]?.cor })),
    ],
  }));
  const ac = d.cmvSemanas.acumulado;
  if (ac)
    linhasSemanas.push({
      celulas: [
        `Acumulado (S${ac.semanas.join(", S")})`,
        valorBR(ac.venda),
        valorBR(ac.compras),
        pct(ac.pct),
        ...cats.map((c) => pct(ac.pctPorCategoria[c.id])),
      ],
      estilo: "total",
    });

  // 5. Planejado × comprado
  const linhasPlano: Linha[] = d.planejadoComprado.flatMap((c) => {
    const totP = c.semanas.reduce((a, w) => a + w.planejado, 0);
    const totC = c.semanas.reduce((a, w) => a + w.comprado, 0);
    return [
      { celulas: [{ t: c.categoria, negrito: true }, ...c.semanas.map((w) => valorBR(w.planejado)), valorBR(totP)], estilo: "grupo" as const },
      {
        celulas: [
          "Comprado",
          ...c.semanas.map((w) => ({ t: valorBR(w.comprado), cor: w.comprado > w.planejado ? COR.vermelho : undefined })),
          { t: valorBR(totC), negrito: true, cor: totC > totP ? COR.vermelho : undefined },
        ],
        estilo: "recuo" as const,
      },
    ];
  });

  // 8. Notas por categoria
  const notasPorCat = cats.map((c) => ({ c, notas: d.notas.filter((n) => n.categoriaId === c.id) })).filter((g) => g.notas.length);
  const linhaNota = (n: NotaSnapshot): Linha => ({
    celulas: [
      dataBR(n.data),
      n.fornecedor,
      n.numero ?? "—",
      ROTULO_TIPO[n.tipo] ?? n.tipo,
      valorBR(n.valor),
      n.vencimento ? dataBR(n.vencimento) : "—",
      { t: ROTULO_CONF[n.conferencia], cor: n.conferencia === "divergente" ? COR.vermelho : n.conferencia === "pendente" ? COR.laranja : undefined },
    ],
  });

  // 9. Alertas
  const alertas = d.alertas;
  const semAlertas =
    !alertas.divergenciasCaixa.length && !alertas.mercadoSemNota.length && !alertas.semNota.length && !alertas.divergentes.length && !alertas.observacoes.length && !alertas.conflitosPendentes;
  const pendencias = d.checklist.filter((i) => !i.ok);

  return (
    <Document title={`Fechamento de CMV — ${mes}`} author="Oji Comércio de Alimentos · Controladoria Oji" creator="PZO" producer="PZO" language="pt-BR">
      <Page size="A4" style={s.pagina}>
        <View style={s.cabecalhoFixo} fixed render={({ pageNumber }) => (pageNumber > 1 ? <Text style={s.cabecalhoFixoTexto}>{`Controladoria Oji · Fechamento de CMV · ${mes}${d.previa ? " · PRÉVIA" : ""}`}</Text> : null)} />

        <View style={s.rodapeLinha} fixed />
        <Text style={[s.rodapeTexto, { left: 44 }]} fixed>
          {RODAPE_PZO}
        </Text>
        <Text style={[s.rodapeTexto, { right: 44, textAlign: "right" }]} fixed render={({ pageNumber, totalPages }) => `Oji Comércio de Alimentos · documento gerencial interno · ${pageNumber}/${totalPages}`} />

        {/* Cabeçalho */}
        <Text style={s.ferramenta}>Controladoria Oji</Text>
        <Text style={s.kicker}>OJI COMÉRCIO DE ALIMENTOS · OJI · SHAKAI · WABI</Text>
        <Text style={s.titulo}>Fechamento de CMV</Text>
        <Text style={s.subtitulo}>Custo da Mercadoria Vendida — Fechamento de {mes}</Text>
        <View style={s.reguaGrossa} />
        {d.previa ? (
          <Text style={s.previa}>PRÉVIA — o mês está aberto e os valores ainda podem mudar. Dados de {quando(d.geradoEm)}.</Text>
        ) : d.fechamento ? (
          <Text style={[s.legenda, { marginTop: -6, marginBottom: 6 }]}>
            Mês fechado em {quando(d.fechamento.fechadoEm)} por {d.fechamento.fechadoPor}
            {d.fechamento.versao > 1 ? ` (versão ${d.fechamento.versao}, após reabertura)` : ""}. Valores do snapshot do fechamento.
          </Text>
        ) : null}

        {/* a) Resumo */}
        <Secao titulo="1. Resumo">
          <Text style={s.paragrafo}>
            Fechamento de CMV das marcas Oji, Shakai e Wabi (restaurante e tele-entrega) referente a {mes.toLowerCase().replace(" / ", " de ")}.{" "}
            {real
              ? "O CMV é o real: estoque inicial + compras - estoque final. O CMV de compras aparece ao lado, para comparar com o histórico."
              : "O CMV é o de compras (compras do mês ÷ venda base)."}
          </Text>
          <View style={s.kpis} wrap={false}>
            {[
              ["Venda (base de cálculo)", brl(d.base.base), COR.texto],
              [real ? "CMV real" : "CMV (compras)", brl(d.cmv.valor), COR.texto],
              ["CMV %", pct(d.cmv.pct), corDaFaixa(d)],
              ["Faixa da régua", d.cmv.faixa?.faixa ?? "—", corDaFaixa(d)],
            ].map(([t, v, cor], i) => (
              <View key={i} style={[s.kpi, i === 0 ? { borderLeftWidth: 0 } : {}]}>
                <Text style={s.kpiTitulo}>{t}</Text>
                <Text style={[s.kpiValor, { color: cor }]}>{v}</Text>
              </View>
            ))}
          </View>
          <Lista
            itens={[
              `Meta de CMV: ${pct(d.cmv.metaPct)} da venda base (até ${brl(d.cmv.metaValor)}). ${
                d.cmv.pct === null ? "" : d.cmv.valor <= d.cmv.metaValor ? `Ficou ${brl(d.cmv.metaValor - d.cmv.valor)} abaixo da meta.` : `Passou ${brl(d.cmv.valor - d.cmv.metaValor)} da meta.`
              }`,
              ...(real ? [`CMV de compras (comparável com o histórico): ${brl(d.cmv.compras)} · ${pct(d.cmv.comprasPct)}.`] : []),
              ant
                ? d.variacao.venda === null
                  ? `Contra ${mesCurto(ant.competencia).toLowerCase()}: CMV ${pp(d.variacao.cmv)} (${pct(ant.cmvPct)} para ${pct(d.cmv.pct)}). A variação da venda aparece quando o mês terminar (${mesCurto(ant.competencia).toLowerCase()}: ${brl(ant.venda)}).`
                  : `Contra ${mesCurto(ant.competencia).toLowerCase()}: venda ${variacaoPct(d.variacao.venda)} (${brl(ant.venda)} para ${brl(d.base.base)}); CMV ${pp(d.variacao.cmv)} (${pct(ant.cmvPct)} para ${pct(d.cmv.pct)}).`
                : "Sem mês anterior para comparar.",
              `${d.notas.length} nota(s) de compra no mês, de ${d.fornecedores.length} fornecedor(es).`,
            ]}
          />
          {d.notasGerenciais.map((t, i) => (
            <Nota key={i} cor={COR.marrom}>
              {t}
            </Nota>
          ))}
        </Secao>

        {/* b) Base de cálculo */}
        <Secao titulo="2. Base de cálculo">
          <Nota>Nota sobre a base de cálculo: {d.base.nota}</Nota>
          <Tabela
            colunas={[
              { titulo: "Origem", flex: 3 },
              { titulo: "Valor (R$)", flex: 1.4, alinhar: "right" },
            ]}
            linhas={[
              { celulas: ["Fechamento de caixa (planilha)", valorBR(d.base.caixa)] },
              { celulas: ["Total ERP + delivery (informado)", d.base.erp === null ? "não informado" : valorBR(d.base.erp)] },
              { celulas: ["Diferença (caixa - ERP)", d.base.divergencia === null ? "—" : valorBR(d.base.divergencia)] },
              { celulas: ["Base de cálculo (a menor)", valorBR(d.base.base)], estilo: "total" },
            ]}
          />
        </Secao>

        {/* c) CMV por categoria */}
        <Secao titulo="3. CMV por categoria">
          <Text style={s.paragrafo}>Linhas do DRE Gerencial. Percentuais sobre a base de {brl(d.base.base)}.</Text>
          <Tabela
            colunas={
              real
                ? [
                    { titulo: "Descrição", flex: 3.2 },
                    { titulo: "Compras (R$)", flex: 1.4, alinhar: "right" },
                    { titulo: "% s/ venda", flex: 1, alinhar: "right" },
                    { titulo: "CMV real (R$)", flex: 1.4, alinhar: "right" },
                    { titulo: "% s/ venda", flex: 1, alinhar: "right" },
                    { titulo: "Meta", flex: 0.9, alinhar: "right" },
                  ]
                : [
                    { titulo: "Descrição", flex: 3.6 },
                    { titulo: "Valor (R$)", flex: 1.5, alinhar: "right" },
                    { titulo: "% s/ venda", flex: 1.1, alinhar: "right" },
                    { titulo: "Meta", flex: 1, alinhar: "right" },
                  ]
            }
            linhas={linhasCategoria}
          />
          <Text style={s.legenda}>Meta por categoria = participação de cada uma na meta de {pct(d.cmv.metaPct)} do mês.</Text>
        </Secao>

        {/* d) CMV por semana */}
        <Secao titulo="4. CMV por semana">
          <Text style={s.paragrafo}>
            Compras da semana ÷ venda da semana, só para semanas fechadas (todos os dias com venda registrada). O acumulado soma as semanas fechadas e compensa compras de sexta
            que abastecem o fim de semana. Mesma tabela do painel.
          </Text>
          <Tabela colunas={colSemanas} linhas={linhasSemanas} />
        </Secao>

        {/* e) Planejado × comprado */}
        <Secao titulo="5. Planejado × comprado por semana">
          <Text style={s.paragrafo}>Planejado original de cada semana (teto da categoria × peso da semana) contra o comprado. Em vermelho, o que passou do planejado.</Text>
          <Tabela
            colunas={[
              { titulo: "Categoria", flex: 2.4 },
              ...d.planejadoComprado[0]?.semanas.map((w) => ({ titulo: rotuloSemana(w.inicio, w.fim, w.numero), flex: 1.35, alinhar: "right" as const })) ?? [],
              { titulo: "Total", flex: 1.35, alinhar: "right" },
            ]}
            linhas={linhasPlano}
          />
          <Text style={s.legenda}>Linha da categoria = planejado; linha "Comprado" logo abaixo.</Text>
        </Secao>

        {/* f) Estoque */}
        <Secao titulo={real ? "6. Estoque e CMV real" : "6. Estoque"}>
          {real ? (
            <>
              <Text style={s.paragrafo}>
                Estoque inicial: contagem de {dataBRCompleta(d.estoque.inicial!.data)} ({brl(d.estoque.inicial!.valor)}). Estoque final: contagem de{" "}
                {dataBRCompleta(d.estoque.final!.data)} ({brl(d.estoque.final!.valor)}).
              </Text>
              <Tabela
                colunas={[
                  { titulo: "Categoria", flex: 2.6 },
                  { titulo: "Estoque inicial", flex: 1.3, alinhar: "right" },
                  { titulo: "(+) Compras", flex: 1.3, alinhar: "right" },
                  { titulo: "(–) Estoque final", flex: 1.3, alinhar: "right" },
                  { titulo: "(=) CMV real", flex: 1.3, alinhar: "right" },
                  { titulo: "%", flex: 0.8, alinhar: "right" },
                ]}
                linhas={[
                  ...d.cmv.porCategoria.map((l) => ({
                    celulas: [l.nome, valorBR(l.estoqueInicial ?? 0), valorBR(l.compras), valorBR(l.estoqueFinal ?? 0), valorBR(l.real ?? 0), pct(l.realPct)],
                  })),
                  {
                    celulas: ["Total", valorBR(d.estoque.inicial!.valor), valorBR(d.cmv.compras), valorBR(d.estoque.final!.valor), valorBR(d.cmv.real!), pct(d.cmv.realPct)],
                    estilo: "total",
                  },
                ]}
              />
            </>
          ) : (
            <>
              <Nota cor={COR.marrom}>{d.estoque.nota ?? "CMV de compras — sem contagem de estoque."}</Nota>
              {d.estoque.final && (
                <Tabela
                  colunas={[
                    { titulo: "Estoque final por categoria (não descontado)", flex: 3.5 },
                    { titulo: "Valor (R$)", flex: 1.4, alinhar: "right" },
                  ]}
                  linhas={[
                    ...cats.map((c) => ({ celulas: [c.nome, valorBR(d.estoque.final!.porCategoria[c.id] ?? 0)] })),
                    { celulas: [`Total da contagem de ${dataBRCompleta(d.estoque.final.data)}`, valorBR(d.estoque.final.valor)], estilo: "total" as const },
                  ]}
                />
              )}
            </>
          )}
          {d.estoque.final && d.estoque.final.itens.length > 0 && (
            <>
              <Text style={s.sub}>Itens da contagem de {dataBRCompleta(d.estoque.final.data)}</Text>
              <Tabela
                colunas={[
                  { titulo: "Item", flex: 3 },
                  { titulo: "Categoria", flex: 1.5 },
                  { titulo: "Qtd.", flex: 0.8, alinhar: "right" },
                  { titulo: "Un.", flex: 0.5 },
                  { titulo: "Custo (R$)", flex: 1, alinhar: "right" },
                  { titulo: "Valor (R$)", flex: 1.1, alinhar: "right" },
                ]}
                linhas={d.estoque.final.itens.map((i) => ({
                  celulas: [
                    i.nome,
                    (nomeCat.get(i.categoriaId) ?? "?").split(" ")[0],
                    (i.quantidade / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 3 }),
                    i.unidade,
                    valorBR(i.custo),
                    valorBR(i.valor),
                  ],
                }))}
              />
            </>
          )}
        </Secao>

        {/* g) Fornecedores */}
        <Secao titulo="7. Compras por fornecedor">
          <Tabela
            colunas={[
              { titulo: "#", flex: 0.4, alinhar: "right" },
              { titulo: "Fornecedor", flex: 3.4 },
              { titulo: "Notas", flex: 0.8, alinhar: "right" },
              { titulo: "Total (R$)", flex: 1.4, alinhar: "right" },
              { titulo: "% das compras", flex: 1.2, alinhar: "right" },
            ]}
            linhas={[
              ...d.fornecedores.map((f, i) => ({ celulas: [String(i + 1), f.nome, String(f.notas), valorBR(f.total), pct(f.pct)] })),
              { celulas: ["", "Total", String(d.notas.length), valorBR(d.cmv.compras), d.cmv.compras > 0 ? "100,0%" : "—"], estilo: "total" as const },
            ]}
          />
        </Secao>

        {/* h) Notas por categoria */}
        <Secao titulo="8. Relação de notas por categoria">
          {notasPorCat.length === 0 && <Text>Nenhuma nota lançada no mês.</Text>}
          {notasPorCat.map(({ c, notas }) => (
            <View key={c.id}>
              <Text style={s.sub} minPresenceAhead={60}>
                {c.nome} — {notas.length} nota(s) · {brl(notas.reduce((a, n) => a + n.valor, 0))}
              </Text>
              <Tabela
                colunas={[
                  { titulo: "Data", flex: 0.7 },
                  { titulo: "Fornecedor", flex: 2.6 },
                  { titulo: "Nº", flex: 1 },
                  { titulo: "Tipo", flex: 0.9 },
                  { titulo: "Valor (R$)", flex: 1.2, alinhar: "right" },
                  { titulo: "Venc.", flex: 0.7 },
                  { titulo: "Conferência", flex: 1.1 },
                ]}
                linhas={[...notas.map(linhaNota), { celulas: ["", "Subtotal", "", "", valorBR(notas.reduce((a, n) => a + n.valor, 0)), "", ""], estilo: "destaque" as const }]}
              />
            </View>
          ))}
        </Secao>

        {/* i) Pendências e alertas */}
        <Secao titulo="9. Pendências e alertas do mês">
          {d.previa && pendencias.length > 0 && (
            <>
              <Text style={s.sub}>Checklist do fechamento: o que falta</Text>
              <Lista itens={pendencias.map((i) => `${i.titulo}: ${i.resumo}`)} />
            </>
          )}
          {semAlertas && <Text>Nenhum alerta registrado no mês.</Text>}
          {alertas.divergenciasCaixa.length > 0 && (
            <>
              <Text style={s.sub}>Divergências na planilha de caixa</Text>
              <Lista
                itens={alertas.divergenciasCaixa.map(
                  (x) =>
                    `${dataBR(x.data)}, turno ${x.turno}: ${x.tipo === "total_dia" ? "soma das origens × Total do Dia" : `${x.origem ?? ""}: soma das partes × total`} (diferença de ${brl(x.diferenca)}). Vale o total pelas partes.`,
                )}
              />
            </>
          )}
          {alertas.mercadoSemNota.length > 0 && (
            <>
              <Text style={s.sub}>Despesa "Mercado" no caixa sem nota de Mercado na data</Text>
              <Lista itens={alertas.mercadoSemNota.map((x) => `${dataBR(x.data)}: ${brl(x.valor)} (possível cupom não lançado).`)} />
            </>
          )}
          {alertas.semNota.length > 0 && (
            <>
              <Text style={s.sub}>Compras sem nota fiscal</Text>
              <Lista
                itens={alertas.semNota.map(
                  (n) => `${dataBR(n.data)} · ${n.fornecedor} · ${brl(n.valor)} — ${n.pendenciaJustificativa ? `justificativa: ${n.pendenciaJustificativa}` : "sem justificativa"} (obs.: ${n.observacao ?? "—"})`,
                )}
              />
            </>
          )}
          {alertas.divergentes.length > 0 && (
            <>
              <Text style={s.sub}>Notas divergentes na conferência</Text>
              <Lista itens={alertas.divergentes.map((n) => `${dataBR(n.data)} · ${n.fornecedor} · ${brl(n.valor)}: ${n.conferenciaObs ?? ""}`)} />
            </>
          )}
          {alertas.observacoes.length > 0 && (
            <>
              <Text style={s.sub}>Observações nas notas</Text>
              <Lista itens={alertas.observacoes.map((n) => `${dataBR(n.data)} · ${n.fornecedor} · ${brl(n.valor)}: ${n.observacao}`)} />
            </>
          )}
          {alertas.conflitosPendentes > 0 && <Text>{alertas.conflitosPendentes} conflito(s) entre venda manual e planilha sem resolver.</Text>}
        </Secao>

        {/* j) Comparativo */}
        <Secao titulo="10. Comparativo com os últimos meses" inteira>
          <View wrap={false}>
          <Tabela
            colunas={[
              { titulo: "Mês", flex: 1.6 },
              { titulo: "Venda base (R$)", flex: 1.5, alinhar: "right" },
              { titulo: "CMV (R$)", flex: 1.4, alinhar: "right" },
              { titulo: "CMV %", flex: 0.9, alinhar: "right" },
              { titulo: "", flex: 2.6 },
              { titulo: "Origem", flex: 1.3 },
            ]}
            linhas={d.historico.map((h) => {
              const largura = (h.cmvPct / 0.45) * 100; // escala: 0 a 45%
              const atual = h.competencia === d.competencia;
              return {
                celulas: [
                  { t: mesCurto(h.competencia), negrito: true },
                  valorBR(h.venda),
                  h.cmvValor === null ? "—" : { t: `${valorBR(h.cmvValor)}${h.cmvCalculado ? "*" : ""}`, italico: h.cmvCalculado },
                  { t: pct(h.cmvPct), cor: faixaDe(h.cmvPct)?.cor, negrito: atual },
                  { barra: largura, cor: faixaDe(h.cmvPct)?.cor ?? COR.linha, opaco: atual },
                  { t: atual ? (d.previa ? "este mês (prévia)" : "este fechamento") : h.fonte === "sistema" ? "sistema" : "DRE (manual)", italico: true },
                ],
                estilo: atual ? ("destaque" as const) : undefined,
              };
            })}
          />
          <Text style={s.legenda}>
            Até outubro/2026: fechamentos do DRE Gerencial (histórico informado). A partir de novembro/2026: fechamentos do sistema. Cores pela régua do CMV
            ({d.regua.map((f) => (f.limiteSuperiorPct === null ? `${f.faixa} acima` : `${f.faixa} até ${pct(f.limiteSuperiorPct)}`)).join(", ")}), como no resto do relatório.
            {d.historico.some((h) => h.cmvCalculado) ? " * CMV em R$ calculado (venda × CMV %): o histórico desses meses só tem o percentual." : ""}
            {real ? " A partir do primeiro mês com estoque, o % do sistema é o CMV real." : ""}
          </Text>
          </View>
        </Secao>

      </Page>
    </Document>
  );
}

export async function gerarPdf(d: DadosFechamento): Promise<Buffer> {
  registrarFontes();
  return renderToBuffer(<DocumentoFechamento d={d} />);
}
