import { rotuloSemana } from "@/lib/cmv/datas";
import { formatarBRL, formatarPct } from "@/lib/cmv/dinheiro";
import type { CmvBloco, CmvSemanas, FaixaRegua, SituacaoSemanaCmv } from "@/lib/cmv/engine";

type Cat = { categoriaId: string; nome: string };

const SITUACAO: Record<Exclude<SituacaoSemanaCmv, "fechada">, string> = {
  em_andamento: "em andamento",
  aguardando_vendas: "aguardando vendas",
  futura: "—",
};

/** % com a cor da faixa da régua (e o nome da faixa para leitores de tela / ao passar o mouse). */
function Pct({ pct, faixa }: { pct: number | null; faixa: FaixaRegua | null }) {
  if (pct === null) return <span className="text-neutral-400">—</span>;
  return (
    <span className="font-semibold" style={faixa ? { color: faixa.cor } : undefined} title={faixa?.faixa}>
      {formatarPct(pct)}
      {faixa && <span className="sr-only"> ({faixa.faixa})</span>}
    </span>
  );
}

/**
 * CMV por semana fechada: venda, compras por categoria, CMV total e da categoria principal.
 * % só em semana fechada e no acumulado; a semana atual mostra valores parciais em cinza.
 */
export function TabelaCmvSemanas({
  dados,
  categorias,
  principal,
  metaCmvPct,
}: {
  dados: CmvSemanas;
  categorias: Cat[];
  principal: Cat;
  metaCmvPct: number;
}) {
  const curto = (nome: string) => nome.split(" ")[0];
  const celulas = (b: CmvBloco, cinza: boolean) => (
    <>
      <td className="px-2 py-2 text-right">{formatarBRL(b.venda)}</td>
      {categorias.map((c) => (
        <td key={c.categoriaId} className="px-2 py-2 text-right">
          {formatarBRL(b.comprasPorCategoria[c.categoriaId] ?? 0)}
        </td>
      ))}
      {cinza ? null : (
        <>
          <td className="px-2 py-2 text-right">
            <Pct pct={b.pct} faixa={b.faixa} />
          </td>
          <td className="px-2 py-2 text-right">
            <Pct pct={b.pctPorCategoria[principal.categoriaId] ?? null} faixa={b.faixaPorCategoria[principal.categoriaId] ?? null} />
          </td>
        </>
      )}
    </>
  );

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-4">
      <h2 className="font-semibold">CMV por semana</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm tabular-nums">
          <thead className="text-left text-neutral-500">
            <tr>
              <th className="px-2 py-1 font-medium">Semana</th>
              <th className="px-2 py-1 text-right font-medium">Venda</th>
              {categorias.map((c) => (
                <th key={c.categoriaId} className="px-2 py-1 text-right font-medium" title={c.nome}>
                  {curto(c.nome)}
                </th>
              ))}
              <th className="px-2 py-1 text-right font-medium">CMV</th>
              <th className="px-2 py-1 text-right font-medium">CMV {curto(principal.nome)}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {dados.semanas.map((s) => {
              const fechada = s.situacao === "fechada";
              const futura = s.situacao === "futura";
              return (
                <tr key={s.numero} className={fechada ? "" : "text-neutral-400"}>
                  <td className="px-2 py-2 whitespace-nowrap">
                    <span className={fechada ? "font-medium text-neutral-900" : "font-medium"}>S{s.numero}</span>{" "}
                    <span className="text-xs text-neutral-500">{rotuloSemana(s)}</span>
                  </td>
                  {futura ? (
                    <td colSpan={categorias.length + 3} className="px-2 py-2 text-right">
                      —
                    </td>
                  ) : (
                    <>
                      {celulas(s, !fechada)}
                      {!fechada && (
                        <td colSpan={2} className="px-2 py-2 text-right text-xs italic">
                          {SITUACAO[s.situacao as Exclude<SituacaoSemanaCmv, "fechada">]}
                        </td>
                      )}
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t-2 border-neutral-200">
            <tr>
              <td className="px-2 py-2 font-semibold">
                Acumulado das semanas fechadas
                {dados.acumulado && <span className="ml-1 text-xs font-normal text-neutral-500">({dados.acumulado.semanas.map((n) => `S${n}`).join("+")})</span>}
              </td>
              {dados.acumulado ? (
                celulas(dados.acumulado, false)
              ) : (
                <td colSpan={categorias.length + 3} className="px-2 py-2 text-right text-xs text-neutral-500">
                  nenhuma semana fechada ainda
                </td>
              )}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-3 text-xs text-neutral-500">
        Compras de sexta abastecem o fim de semana e podem cair parte na semana seguinte; o acumulado compensa essa diferença.
      </p>
      <p className="mt-1 text-xs text-neutral-500">
        % só para semanas fechadas (último dia já passou e todos os dias com venda). Cores pela régua: total com meta de {formatarPct(metaCmvPct, 0)}; cada categoria com a régua
        escalada para a sua meta.
      </p>
    </section>
  );
}
