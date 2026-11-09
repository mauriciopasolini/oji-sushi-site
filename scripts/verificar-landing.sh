#!/bin/sh
# Confere que a landing servida em BASE_URL é byte a byte idêntica à tag estado-original
# e que nada fora de public/ é servido. Ex.: sh scripts/verificar-landing.sh http://localhost:3000
# uso: verify.sh BASE_URL
B="$1"; fail=0
check() { # path ref
  got=$(curl -s "$B$1" | sha256sum | cut -d' ' -f1); want=$(git show "estado-original:$2" | sha256sum | cut -d' ' -f1)
  ct=$(curl -s -o /dev/null -w "%{http_code} %{content_type}" "$B$1")
  if [ "$got" = "$want" ]; then echo "OK   $1  ($ct)"; else echo "FAIL $1  ($ct)"; fail=1; fi
}
check / index.html
check /index.html index.html
check /logo.png logo.png
check /cardapio/menu-pokes.pdf cardapio/menu-pokes.pdf
check /cardapio/menu-sushis.pdf cardapio/menu-sushis.pdf
for p in /docs/cmv/PROMPT.md /package.json /next.config.ts /vercel.json /.claude/settings.local.json /.env.local /README.md /app/layout.tsx; do
  c=$(curl -s -o /dev/null -w "%{http_code}" "$B$p"); [ "$c" = 404 ] && echo "OK   $p -> 404" || { echo "FAIL $p -> $c"; fail=1; }
done
printf "     /painel headers: "; curl -sI "$B/painel" | grep -i x-robots-tag
exit $fail
