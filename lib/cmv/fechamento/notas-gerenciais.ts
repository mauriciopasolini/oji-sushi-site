// Notas gerenciais fixas por mês, vindas de decisões registradas em docs/cmv/DECISOES.md.
// Aparecem no relatório (PDF e Excel) e ficam gravadas no snapshot do fechamento.

import type { DataCivil } from "../datas";

export const NOTAS_GERENCIAIS: Record<DataCivil, string[]> = {
  // Decisão 110: corte do fechamento de novembro/2026.
  "2026-11-01": [
    "Corte de estoque: a contagem de fechamento de novembro foi feita no domingo 29/11, após o expediente. " +
      "As compras recebidas na segunda 30/11 foram lançadas em dezembro (com data 01/12 e a observação " +
      '"recebida em 30/11 — corte de estoque, competência dezembro") e não entram neste mês. As vendas de 30/11 ficam em novembro.',
  ],
  "2026-12-01": [
    "Corte de estoque de novembro: este mês inclui as compras recebidas na segunda 30/11/2026, lançadas com data 01/12. " +
      "O estoque inicial é a contagem de 29/11. O consumo do dia 30/11 sai desse estoque, enquanto as vendas de 30/11 ficaram em novembro.",
  ],
};

export const notasGerenciaisDe = (competencia: DataCivil): string[] => NOTAS_GERENCIAIS[competencia] ?? [];
