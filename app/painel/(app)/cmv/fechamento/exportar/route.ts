// Download do relatório do fechamento (PDF ou Excel). Só admin; só download, sem e-mail.
// Mês fechado → snapshot gravado; mês aberto → prévia com os dados de agora.
import { dadosDoRelatorio } from "@/lib/cmv/fechamento/carregar";
import { competenciaDe, hojeSP, INICIO_SISTEMA } from "@/lib/cmv/datas";
import { gerarExcel } from "@/lib/cmv/relatorio/excel";
import { gerarPdf } from "@/lib/cmv/relatorio/pdf";
import { getSessao } from "@/lib/cmv/sessao";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sessao = await getSessao();
  if (!sessao?.perfil?.ativo) return new Response("Sessão expirada.", { status: 401 });
  if (sessao.perfil.papel !== "admin") return new Response("Somente o administrador exporta o fechamento.", { status: 403 });

  const url = new URL(req.url);
  const mes = url.searchParams.get("mes") ?? "";
  const formato = url.searchParams.get("formato");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes) || (formato !== "pdf" && formato !== "xlsx")) return new Response("Parâmetros inválidos.", { status: 400 });
  const competencia = `${mes}-01`;
  const hoje = hojeSP();
  if (competencia < INICIO_SISTEMA || competencia > competenciaDe(hoje)) return new Response("Mês fora do sistema.", { status: 400 });

  const supabase = await createClient();
  const dados = await dadosDoRelatorio(supabase, competencia, hoje);
  const nome = `${dados.previa ? "previa-" : ""}fechamento-cmv-${mes}.${formato}`;
  const corpo = formato === "pdf" ? await gerarPdf(dados) : await gerarExcel(dados);
  return new Response(new Uint8Array(corpo), {
    headers: {
      "Content-Type": formato === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
