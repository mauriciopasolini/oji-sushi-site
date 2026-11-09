// Preparação da foto da nota NO NAVEGADOR, antes do upload.
// Imagens: lado maior até 1600 px, JPEG qualidade 0,8 (corrige a rotação do EXIF).
// PDF: vai como está. Limite final: 10 MB (o mesmo do bucket).

export const LIMITE_BYTES = 10 * 1024 * 1024;
const LADO_MAXIMO = 1600;
const QUALIDADE = 0.8;

export type ArquivoPreparado = { blob: Blob; extensao: "jpg" | "png" | "webp" | "pdf"; tipo: string };

export class ErroArquivo extends Error {}

export async function prepararArquivo(arquivo: File): Promise<ArquivoPreparado> {
  if (arquivo.type === "application/pdf" || arquivo.name.toLowerCase().endsWith(".pdf")) {
    if (arquivo.size > LIMITE_BYTES) throw new ErroArquivo("O PDF passa de 10 MB.");
    return { blob: arquivo, extensao: "pdf", tipo: "application/pdf" };
  }
  if (!arquivo.type.startsWith("image/") && arquivo.type !== "") {
    throw new ErroArquivo("Envie uma foto ou um PDF.");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
  } catch {
    throw new ErroArquivo("Não consegui abrir essa imagem. Tire a foto de novo ou envie em JPG/PNG.");
  }

  const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height));
  const largura = Math.round(bitmap.width * escala);
  const altura = Math.round(bitmap.height * escala);

  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ErroArquivo("Seu navegador não conseguiu processar a imagem.");
  ctx.fillStyle = "#fff"; // PNG com transparência vira fundo branco
  ctx.fillRect(0, 0, largura, altura);
  ctx.drawImage(bitmap, 0, 0, largura, altura);
  bitmap.close();

  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", QUALIDADE));
  if (!blob) throw new ErroArquivo("Falha ao comprimir a imagem.");
  if (blob.size > LIMITE_BYTES) throw new ErroArquivo("A imagem continua acima de 10 MB.");
  return { blob, extensao: "jpg", tipo: "image/jpeg" };
}

/** AAAA/MM/<id>.<ext> — pasta pelo mês da data da nota. */
export function caminhoFoto(dataEmissao: string, id: string, extensao: string) {
  return `${dataEmissao.slice(0, 4)}/${dataEmissao.slice(5, 7)}/${id}.${extensao}`;
}
