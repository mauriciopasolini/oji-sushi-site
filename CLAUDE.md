# Oji Sushi: site e módulo de CMV

**Antes de qualquer tarefa, leia `docs/cmv/STATUS.md`, `docs/cmv/PROMPT.md` e `docs/cmv/DECISOES.md`.**

## O projeto
- **Landing pública**: arquivos estáticos em `public/` (`index.html`, `logo.png`, `cardapio/*.pdf`), publicados em https://www.ojisushi.com.br.
  - Tem de ficar byte a byte igual à tag `estado-original`. A única exceção autorizada é o link "Acesso equipe" no rodapé.
  - Confira com `sh scripts/verificar-landing.sh <URL>`.
  - Nada fora de `public/` pode ser servido publicamente.
- **Módulo de CMV** (`/painel`): Next.js 16 (App Router), React 19, TypeScript, Tailwind v4 só no painel, Supabase (Postgres, Auth e Storage) e Vercel.
  - Controla as compras (notas com foto) contra o orçamento semanal de cada categoria.
  - As vendas vêm da planilha de caixa (Google Sheets), por sincronização e cron diário.
  - Calcula meta, projeção, teto, CMV e alertas.
  - O briefing está em `docs/cmv/PROMPT.md`.

## Como trabalhar
- O usuário é Mauricio, sócio do Oji Sushi. Escreva em português do Brasil.
- Uma etapa por vez, na branch `cmv/etapa-1`. Ao fim de cada etapa: commit, resumo e "como testar", depois esperar o OK. Push na branch gera só preview.
- **Merge na `main` = produção**: só com OK explícito. Depois de cada merge, rodar `verificar-landing.sh` contra produção.
- Cada decisão técnica entra em `docs/cmv/DECISOES.md`, numerada. Ao encerrar o dia, atualize `docs/cmv/STATUS.md`.
- Dinheiro em centavos inteiros no código e `numeric(12,2)` no banco. Datas no fuso America/Sao_Paulo.
- **Segredos nunca passam pelo chat nem vão para o cliente** (`SUPABASE_SERVICE_ROLE_KEY`, credencial do Google). Use os scripts que gravam no `.env.local`.
- O banco é **compartilhado entre preview e produção** e já tem dados reais. Testes de ponta a ponta não podem deixar dados para trás. Notas, auditoria e meses não podem ser apagados.
- **Smart App Control**: sem Supabase CLI (use `npm run db:migrate`); Vitest 4 / Vite 7 com `overrides.rollup = 4.67.5`. Não sugerir desligar o Smart App Control.
- Testes: `npm test` (cálculo), `npm run db:test-rls` (regras no banco, em transação desfeita), `npm run typecheck`.
