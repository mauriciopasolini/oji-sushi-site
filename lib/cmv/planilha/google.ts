import "server-only";
import { auth, sheets } from "@googleapis/sheets";
import type { Grade } from "./parser";

// Acesso somente leitura ao Google Sheets com a conta de serviço.
// A chave (GOOGLE_SERVICE_ACCOUNT_JSON, JSON em base64) só existe no servidor.

type ChaveServico = { client_email: string; private_key: string; project_id?: string };

function chave(): ChaveServico | null {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!b64) return null;
  try {
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as ChaveServico;
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON inválida (esperado: JSON da chave em base64).");
  }
}

/** E-mail da conta de serviço, para mostrar na tela de configurações. */
export function emailContaServico(): string | null {
  return chave()?.client_email ?? null;
}

function cliente() {
  const c = chave();
  if (!c) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON não configurada.");
  const jwt = new auth.JWT({ email: c.client_email, key: c.private_key, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
  return sheets({ version: "v4", auth: jwt });
}

export async function listarAbas(spreadsheetId: string): Promise<{ titulo: string; nomeArquivo: string }[]> {
  const r = await cliente().spreadsheets.get({ spreadsheetId, fields: "properties.title,sheets.properties.title" });
  const nome = r.data.properties?.title ?? "";
  return (r.data.sheets ?? []).map((s) => ({ titulo: s.properties?.title ?? "", nomeArquivo: nome }));
}

/** Lê várias abas de uma vez (valores sem formatação: números como número). */
export async function lerAbas(spreadsheetId: string, titulos: string[]): Promise<Map<string, Grade>> {
  const saida = new Map<string, Grade>();
  if (!titulos.length) return saida;
  const r = await cliente().spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: titulos.map((t) => `'${t.replace(/'/g, "''")}'`),
    valueRenderOption: "UNFORMATTED_VALUE",
    majorDimension: "ROWS",
  });
  (r.data.valueRanges ?? []).forEach((vr, i) => saida.set(titulos[i], (vr.values ?? []) as Grade));
  return saida;
}
