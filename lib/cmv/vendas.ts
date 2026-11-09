// Estrutura das vendas por turno/origem (igual à planilha de fechamento de caixa).

export type Origem = "restaurante" | "oji_tele" | "shakai_tele" | "wabi_tele";
export type CampoValor = "dinheiro" | "credito" | "debito" | "pix" | "loja_dinheiro" | "loja_cartao" | "online";

export const ORIGENS: { valor: Origem; rotulo: string; campos: { campo: CampoValor; rotulo: string }[]; temPedidos: boolean }[] = [
  {
    valor: "restaurante",
    rotulo: "Restaurante",
    temPedidos: false,
    campos: [
      { campo: "dinheiro", rotulo: "Dinheiro" },
      { campo: "credito", rotulo: "Crédito" },
      { campo: "debito", rotulo: "Débito" },
      { campo: "pix", rotulo: "Pix" },
    ],
  },
  ...(["oji_tele", "shakai_tele", "wabi_tele"] as const).map((valor) => ({
    valor,
    rotulo: { oji_tele: "Oji Tele", shakai_tele: "Shakai Tele", wabi_tele: "Wabi Tele" }[valor],
    temPedidos: true,
    campos: [
      { campo: "loja_dinheiro" as const, rotulo: "Loja · Dinheiro" },
      { campo: "loja_cartao" as const, rotulo: "Loja · Cartão" },
      { campo: "online" as const, rotulo: "Online" },
    ],
  })),
];

export const TODOS_CAMPOS: CampoValor[] = ["dinheiro", "credito", "debito", "pix", "loja_dinheiro", "loja_cartao", "online"];
