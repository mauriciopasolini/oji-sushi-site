"""Gera os ícones do site e do painel a partir de public/logo.png (decisão 104).

Usa só o símbolo "oji" (os pixels pretos do logo), em off-white, sobre uma placa
vermelha (#E8321A, o --red da landing). O painel leva um ponto escuro no canto.

Uso (na raiz do repositório):  python scripts/gerar-icones.py [--previa ARQUIVO.png]
Requer Pillow. Os arquivos gerados são versionados; rode de novo só se o desenho mudar.
"""
import argparse
from pathlib import Path

from PIL import Image, ImageDraw

RAIZ = Path(__file__).resolve().parent.parent
LOGO = RAIZ / "public" / "logo.png"
SITE = RAIZ / "public"
PAINEL = RAIZ / "public" / "icones-painel"

RED = (0xE8, 0x32, 0x1A)  # --red da landing
FG = (255, 248, 240)      # off-white
INK = (40, 6, 5)          # ponto do painel

S = 1024        # tamanho do desenho mestre
RAIO = 0.22     # arredondamento da placa


def simbolo() -> Image.Image:
    """Máscara (L) do símbolo preto, com borda suave, recortada justa."""
    im = Image.open(LOGO).convert("RGBA")
    r, g, b, a = im.split()
    lum = Image.merge("RGB", (r, g, b)).convert("L")
    # preto -> 255; o vermelho do logo (lum ~114) e o branco -> 0
    m = Image.eval(lum, lambda v: max(0, min(255, int((90 - v) * 255 / 90))))
    m = Image.composite(m, Image.new("L", im.size, 0), a)
    return m.crop(m.getbbox())


SIMBOLO = simbolo()


def placa(tam: int, *, painel: bool, maskable: bool = False) -> Image.Image:
    pequeno = tam <= 48
    base = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(base)
    if maskable:
        # cobre o quadrado todo; o símbolo fica na zona segura (círculo de 80%)
        d.rectangle([0, 0, S, S], fill=RED)
        area, desloc = 0.56, 0.0
    else:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * RAIO), fill=RED)
        # 16/32/48 px: símbolo o maior possível, margem mínima
        area, desloc = (0.90, 0.02 if painel else 0.0) if pequeno else (0.74, 0.0)

    w, h = SIMBOLO.size
    k = area * S / max(w, h)
    sym = SIMBOLO.resize((round(w * k), round(h * k)), Image.LANCZOS)
    x = (S - sym.width) // 2
    y = (S - sym.height) // 2 - int(desloc * S)
    base.paste(Image.new("RGBA", sym.size, FG + (255,)), (x, y), sym)

    if painel:
        if maskable:
            rr, cx, cy, anel = 0.075, 0.76, 0.74, 0.025
        elif pequeno:
            rr, cx, cy, anel = 0.13, 0.80, 0.80, 0.045
        else:
            rr, cx, cy, anel = 0.115, 0.80, 0.80, 0.03
        rr, cx, cy, anel = (int(v * S) for v in (rr, cx, cy, anel))
        d.ellipse([cx - rr - anel, cy - rr - anel, cx + rr + anel, cy + rr + anel], fill=RED)
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=INK)

    return base.resize((tam, tam), Image.LANCZOS)


def salvar_ico(caminho: Path, *, painel: bool) -> None:
    imgs = [placa(t, painel=painel) for t in (16, 32, 48)]
    imgs[-1].save(caminho, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)], append_images=imgs[:-1])


def gerar() -> None:
    # Site (landing): só favicon.ico e apple-touch-icon, sem a marca do painel.
    salvar_ico(SITE / "favicon.ico", painel=False)
    placa(180, painel=False).save(SITE / "apple-touch-icon.png", optimize=True)

    # Painel
    PAINEL.mkdir(exist_ok=True)
    salvar_ico(PAINEL / "favicon.ico", painel=True)
    placa(32, painel=True).save(PAINEL / "icon-32.png", optimize=True)
    placa(180, painel=True).save(PAINEL / "apple-touch-icon.png", optimize=True)
    for t in (192, 512):
        placa(t, painel=True).save(PAINEL / f"icon-{t}.png", optimize=True)
        placa(t, painel=True, maskable=True).save(PAINEL / f"icon-maskable-{t}.png", optimize=True)


def previa(saida: Path) -> None:
    variantes = [("site", False, False), ("painel", True, False), ("maskable", True, True)]
    fundos = [(241, 243, 244), (32, 33, 36)]
    folha = Image.new("RGB", (3 * 420, 2 * 260), (255, 255, 255))
    for c, (_, painel, mask) in enumerate(variantes):
        for r, cor in enumerate(fundos):
            x0, y0 = c * 420, r * 260
            ImageDraw.Draw(folha).rectangle([x0 + 5, y0 + 5, x0 + 415, y0 + 255], fill=cor)
            if not mask:
                i16, i32 = placa(16, painel=painel), placa(32, painel=painel)
                folha.paste(i16, (x0 + 20, y0 + 20), i16)
                folha.paste(i32, (x0 + 45, y0 + 12), i32)
                big = i32.resize((128, 128), Image.NEAREST)
                folha.paste(big, (x0 + 20, y0 + 70), big)
                i180 = placa(180, painel=painel)
                folha.paste(i180, (x0 + 220, y0 + 40), i180)
            else:
                m = placa(192, painel=True, maskable=True)
                # simula o recorte circular do Android
                circ = Image.new("L", m.size, 0)
                ImageDraw.Draw(circ).ellipse([0, 0, 191, 191], fill=255)
                folha.paste(m, (x0 + 15, y0 + 30))
                folha.paste(m, (x0 + 215, y0 + 30), circ)
    folha.save(saida)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--previa", type=Path, help="só gera a folha de prévia neste arquivo")
    a = ap.parse_args()
    if a.previa:
        previa(a.previa)
    else:
        gerar()
