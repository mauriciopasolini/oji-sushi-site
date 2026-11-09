# Decisões técnicas — Módulo CMV

Registro cronológico. Cada item: decisão, motivo e data.

## 2026-11-09 — Etapa 1A: conversão para Next.js

1. **Landing estática preservada byte a byte.** `index.html`, `logo.png` e `cardapio/` foram movidos sem alteração para `public/`. Um rewrite `beforeFiles` em `next.config.ts` faz `/` servir `/index.html`. A landing não passa pelo React. A verificação é feita por `scripts/verificar-landing.sh`, que compara o SHA-256 com a tag `estado-original`.
2. **Só `public/` é servido.** Antes, a Vercel (preset "Other", sem `public/`) servia a raiz do repositório inteira, inclusive `.claude/settings.local.json`. `.claude/` saiu do git e entrou no `.gitignore`.
3. **`vercel.json` com `"framework": "nextjs"`, no mesmo commit que cria `public/`.** Com o preset "Other", a simples existência de `public/` mudaria o diretório servido. Nenhuma configuração do painel da Vercel foi alterada.
4. **Next.js 16.4.5 (App Router, Turbopack), React 19.3.1, TypeScript 6.0.3 e npm.** A versão do TypeScript é a 6 (a última em JS) por compatibilidade com o type-check do `next build`. As versões são fixas (`--save-exact`).
5. **Node 24.x** em `engines`, igual ao runtime do projeto na Vercel (localmente roda Node 26).
6. **Next 16: `proxy.ts` no lugar de `middleware.ts`.** O nome mudou no Next 16; a função é a mesma do "middleware de autenticação" pedido no briefing.
7. **`noindex` em duas camadas.** Cabeçalho `X-Robots-Tag: noindex, nofollow` em `/painel/*` e `/api/*` (via `next.config.ts`), e `robots` na metadata do layout raiz do app.
8. **Chaves do Supabase.** O projeto usa as chaves novas: *publishable* (`sb_publishable_…`) em `NEXT_PUBLIC_SUPABASE_ANON_KEY` e *secret* (`sb_secret_…`) em `SUPABASE_SERVICE_ROLE_KEY`. Os nomes do briefing foram mantidos.
9. **Tailwind v4 só no painel.** Será importado apenas no layout de `/painel` (Etapa 1B), sem nenhum efeito sobre a landing.
