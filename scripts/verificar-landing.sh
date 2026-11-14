#!/bin/sh
# Confere que a landing servida em BASE_URL é byte a byte idêntica à tag estado-original
# e que nada fora de public/ é servido. Ex.: sh scripts/verificar-landing.sh http://localhost:3000
# Alterações autorizadas no index.html (cada linha tem de aparecer exatamente uma vez;
# retiradas essas linhas, o arquivo tem de ser idêntico ao original):
#   - link "Acesso equipe" no rodapé (decisão 78, 09/11/2026);
#   - as duas tags <link> do favicon no <head> (decisão 104, 14/11/2026).
# Os ícones do site (favicon.ico, apple-touch-icon.png) não existem na tag: são
# comparados com os arquivos de public/ deste checkout.
# Previews protegidos (*.vercel.app): manda o cabeçalho x-vercel-protection-bypass com
# VERCEL_AUTOMATION_BYPASS_SECRET (do ambiente ou do .env.local; decisão 105). Em outros
# domínios o segredo nunca é enviado.
# uso: verify.sh BASE_URL
B="$1"; fail=0
BYPASS="${VERCEL_AUTOMATION_BYPASS_SECRET:-$(grep -s '^VERCEL_AUTOMATION_BYPASS_SECRET=' .env.local | cut -d= -f2- | tr -d '\r')}"
case "$B" in https://*.vercel.app|https://*.vercel.app/) ;; *) BYPASS="" ;; esac
curl() { if [ -n "$BYPASS" ]; then command curl -H "x-vercel-protection-bypass: $BYPASS" "$@"; else command curl "$@"; fi; }
[ -n "$BYPASS" ] && echo "     (preview protegido: usando o bypass de automação)"
LINK_EQUIPE='  <p style="margin: 8px 0 0; text-align: center; font-size: 12px;"><a href="/painel" style="color: var(--gray-text); text-decoration: none;">Acesso equipe</a></p>'
LINK_ICON='  <link rel="icon" href="/favicon.ico" sizes="any" />'
LINK_APPLE='  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />'
AUTORIZADAS=$(printf '%s\n%s\n%s' "$LINK_EQUIPE" "$LINK_ICON" "$LINK_APPLE")
hash() { sha256sum | cut -d' ' -f1; }
check() { # path ref
  got=$(curl -s "$B$1" | hash); want=$(git show "estado-original:$2" | hash)
  ct=$(curl -s -o /dev/null -w "%{http_code} %{content_type}" "$B$1")
  if [ "$got" = "$want" ]; then echo "OK   $1  ($ct)"; else echo "FAIL $1  ($ct)"; fail=1; fi
}
check_local() { # path arquivo-local
  got=$(curl -s "$B$1" | hash); want=$(hash < "$2")
  ct=$(curl -s -o /dev/null -w "%{http_code} %{content_type}" "$B$1")
  if [ "$got" = "$want" ]; then echo "OK   $1  ($ct)"; else echo "FAIL $1  ($ct)"; fail=1; fi
}
check_index() { # path
  pagina=$(mktemp); curl -s "$B$1" > "$pagina"
  ns=""; ok=1
  for linha in "$LINK_EQUIPE" "$LINK_ICON" "$LINK_APPLE"; do
    n=$(grep -cxF "$linha" "$pagina"); ns="$ns$n "; [ "$n" = 1 ] || ok=0
  done
  got=$(grep -vxF "$AUTORIZADAS" "$pagina" | hash); want=$(git show "estado-original:index.html" | hash)
  ct=$(curl -s -o /dev/null -w "%{http_code} %{content_type}" "$B$1"); rm -f "$pagina"
  if [ "$ok" = 1 ] && [ "$got" = "$want" ]; then echo "OK   $1  ($ct; original + Acesso equipe + 2 tags de favicon)"
  else echo "FAIL $1  ($ct; linhas autorizadas encontradas [equipe icon apple]: $ns; resto idêntico: $([ "$got" = "$want" ] && echo sim || echo NÃO))"; fail=1; fi
}
check_index /
check_index /index.html
check /logo.png logo.png
check /cardapio/menu-pokes.pdf cardapio/menu-pokes.pdf
check /cardapio/menu-sushis.pdf cardapio/menu-sushis.pdf
check_local /favicon.ico public/favicon.ico
check_local /apple-touch-icon.png public/apple-touch-icon.png
for p in /docs/cmv/PROMPT.md /package.json /next.config.ts /vercel.json /.claude/settings.local.json /.env.local /README.md /app/layout.tsx; do
  c=$(curl -s -o /dev/null -w "%{http_code}" "$B$p"); [ "$c" = 404 ] && echo "OK   $p -> 404" || { echo "FAIL $p -> $c"; fail=1; }
done
printf "     /painel headers: "; curl -sI "$B/painel" | grep -i x-robots-tag
exit $fail
