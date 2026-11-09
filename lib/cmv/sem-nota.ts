// Regras da compra "sem nota (aguardando)" — função pura, usada no servidor e no formulário.
import type { TipoNota } from "./tipos";

/**
 * Valida as regras do tipo "sem_nota" ao criar (tipoAnterior = null) ou editar uma nota.
 * - Sem nota: observação obrigatória (a foto continua obrigatória pelas regras gerais).
 * - Saindo de "sem nota" (a nota fiscal chegou): nova foto obrigatória (a antiga fica no
 *   histórico) e, para NF-e ou cupom, o número da nota.
 */
export function validarSemNota(p: {
  tipoAnterior: TipoNota | null;
  tipo: TipoNota;
  observacao: string | null | undefined;
  numero: string | null | undefined;
  fotoTrocada: boolean;
}): string | null {
  if (p.tipo === "sem_nota" && !(p.observacao ?? "").trim()) {
    return "Compra sem nota: escreva uma observação (o que chegou e por que veio sem nota).";
  }
  if (p.tipoAnterior === "sem_nota" && p.tipo !== "sem_nota") {
    if (!p.fotoTrocada) return "A nota fiscal chegou: tire a foto da nota fiscal (a foto anterior fica no histórico).";
    if ((p.tipo === "nfe" || p.tipo === "cupom") && !(p.numero ?? "").trim()) return "Informe o número da nota fiscal.";
  }
  return null;
}
