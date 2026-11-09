#!/bin/sh
# Confere que a landing servida em BASE_URL é byte a byte idêntica à tag estado-original
# e que nada fora de public/ é servido. Ex.: sh scripts/verificar-landing.sh http://localhost:3000
# Única alteração autorizada no index.html: a linha do link "Acesso equipe" no rodapé
# (aprovada em 09/11/2026). Ela tem de aparecer exatamente uma vez; sem ela, o arquivo
# tem de ser idêntico ao original.
# uso: verify.sh BASE_URL
B="$1"; fail=0
LINK_EQUIPE='  <p style="margin: 8px 0 0; text-align: center; font-size: 12px;"><a href="/painel" style="color: var(--gray-text); text-decoration: none;">Acesso equipe</a></p>'
hash() { sha256sum | cut -d' ' -f1; }
check() { # path ref
  got=$(curl -s "$B$1" | hash); want=$(git show "estado-original:$2" | hash)
  ct=$(curl -s -o /dev/null -w "%{http_code} %{content_type}" "$B$1")
  if [ "$got" = "$want" ]; then echo "OK   $1  ($ct)"; else echo "FAIL $1  ($ct)"; fail=1; fi
}
check_index() { # path
  pagina=$(mktemp); curl -s "$B$1" > "$pagina"
  n=$(grep -cxF "$LINK_EQUIPE" "$pagina")
  got=$(grep -vxF "$LINK_EQUIPE" "$pagina" | hash); want=$(git show "estado-original:index.html" | hash)
  ct=$(curl -s -o /dev/null -w "%{http_code} %{content_type}" "$B$1"); rm -f "$pagina"
  if [ "$n" = 1 ] && [ "$got" = "$want" ]; then echo "OK   $1  ($ct; original + link Acesso equipe)"
  else echo "FAIL $1  ($ct; link encontrado $n vez(es); resto idêntico: $([ "$got" = "$want" ] && echo sim || echo NÃO))"; fail=1; fi
}
check_index /
check_index /index.html
check /logo.png logo.png
check /cardapio/menu-pokes.pdf cardapio/menu-pokes.pdf
check /cardapio/menu-sushis.pdf cardapio/menu-sushis.pdf
for p in /docs/cmv/PROMPT.md /package.json /next.config.ts /vercel.json /.claude/settings.local.json /.env.local /README.md /app/layout.tsx; do
  c=$(curl -s -o /dev/null -w "%{http_code}" "$B$p"); [ "$c" = 404 ] && echo "OK   $p -> 404" || { echo "FAIL $p -> $c"; fail=1; }
done
printf "     /painel headers: "; curl -sI "$B/painel" | grep -i x-robots-tag
exit $fail
