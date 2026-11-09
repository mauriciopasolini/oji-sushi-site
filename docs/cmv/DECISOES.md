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

## 2026-11-09 — Etapa 1B/1C: Supabase, autenticação, schema e RLS

10. **Sem Supabase CLI.** O binário (`supabase.exe`, sem assinatura) é bloqueado pelo Smart App Control desta máquina. As migrações são aplicadas por `npm run db:migrate` (`scripts/db-migrate.mjs`, biblioteca `postgres`, via Session pooler em `SUPABASE_DB_URL`). Cada arquivo roda numa transação. O controle usa a mesma tabela da CLI (`supabase_migrations.schema_migrations`), então os arquivos continuam compatíveis com `supabase db push`.
11. **Autenticação.** O `proxy.ts` valida o JWT com `getClaims()`, renova a sessão e redireciona para `/painel/login?next=…`. O layout de `(app)` revalida com `getUser()` e exige perfil **ativo**. O RLS é a barreira final. O redirect pós-login aceita só caminhos `/painel/…` (evita open redirect).
12. **Domínios como `text` + CHECK**, não `enum`, para evoluir sem `ALTER TYPE`.
13. **`notas.mes_id` é definido por trigger** a partir de `data_emissao`. O mês é criado automaticamente, com os padrões (meta 90.000), se não existir. O cliente não consegue gravar a nota no mês errado.
14. **Mês fechado bloqueado no banco** por triggers em `notas`, `vendas_turno`, `fechamento_turno`, `contagens` e `contagem_itens`, valendo para **todos**, inclusive admin e service_role (a sincronização também respeita). Na edição, a nota não pode sair de um mês fechado nem entrar em um. Para mexer, reabra o mês.
15. **Status do mês só muda por `fechar_mes()` / `reabrir_mes(motivo)`** (RPC, só admin, auditadas). UPDATE direto em `meses.status` é recusado. Mês fechado não aceita mudança de configuração.
16. **Auditoria de notas no trigger BEFORE**, com `motivo_edicao` como campo de passagem: o app envia o motivo junto com o UPDATE, o trigger grava em `auditoria` e zera o campo. Editar campos de negócio sem motivo é recusado. Cancelar exige `motivo_cancelamento` (CHECK).
17. **Editar uma nota já conferida a devolve para `pendente`**, para o admin conferir de novo. Reativar nota cancelada: só admin, com motivo.
18. **Conferência só pelo admin.** No INSERT feito por gestor, o trigger força `pendente`. `conferida_por`/`conferida_em` são preenchidos pelo banco.
19. **Nota nunca é apagada.** Não há política de DELETE e um trigger recusa DELETE até do `postgres`. A auditoria é append-only (sem privilégio de UPDATE/DELETE e trigger que recusa).
20. **Vendas.** `total_calculado` é coluna gerada (soma das partes). O gestor só grava/edita `fonte='manual'`. Só o admin apaga.
21. **Funções auxiliares no schema `interno`**, que não é exposto na Data API e por isso não pode ser chamado via REST. As políticas usam `(select interno.eh_membro())` para avaliar uma vez por consulta.
22. **`anon` sem nenhum privilégio** nas tabelas do módulo (além do RLS).
23. **Storage.** O bucket `notas` é privado, com limite de 10 MB e só JPEG/PNG/WebP/PDF. O caminho precisa casar com `AAAA/MM/<uuid>.<ext>` e a pasta não pode ser de mês fechado. Sem DELETE.
24. **`historico_mensal.cmv_valor`** fica nulo onde só o % é conhecido (mai–set). Em outubro, o % é calculado do valor (30.223,90 / 85.921,54 = 35,18%) e o detalhe por categoria fica em `detalhe`.
25. **Usuários** criados por `npm run criar-usuario` (secret key), com senha gerada e mostrada uma vez. Rodar num terminal próprio, fora do chat. Hoje não há troca de senha pelo próprio usuário (fica para depois).
26. **Fornecedores: só o admin cadastra** (configuração). *Ponto em aberto:* se o Douglas precisar cadastrar fornecedor novo na hora de lançar a nota, liberamos o INSERT para o gestor na Etapa 3.
27. **Teste de RLS** (`npm run db:test-rls`): 40 casos simulando anônimo, sem perfil, inativo, gestor, admin e postgres, inclusive mês fechado. Roda numa transação desfeita no fim e não grava nada.

## 2026-11-09 — Ajustes pós-checkpoint da Etapa 1

28. **Gestor cria fornecedor no lançamento** (decisão do Mauricio, resolve o item 26). O gestor só faz INSERT, e o trigger mantém apenas nome e categoria: zera CNPJ e prazo e força `ativo`. Editar, desativar e mesclar continuam só com o admin. Fornecedor criado pelo gestor fica com `revisado_em` nulo: é o marcador "novo" na tela de conferência, até o admin revisar. Admin cria já revisado. Nomes são normalizados (espaços) e únicos sem diferenciar maiúsculas.
29. **Mesclar fornecedores (futuro, admin):** como notas de mês fechado não podem ser alteradas, a mescla vai desativar o duplicado e apontar para o principal (coluna futura `mesclado_em`), em vez de reescrever notas antigas.
30. **Troca de senha** em `/painel/conta/senha`, para qualquer usuário logado. Ela confere a senha atual num cliente isolado e troca via `auth.updateUser`, com mínimo de 8 caracteres. `perfis.deve_trocar_senha` obriga a troca no primeiro acesso: o layout de `(app)` redireciona, e a página fica fora de `(app)` para evitar loop. O `criar-usuario` liga a flag sempre que gera senha. O usuário só desliga a própria flag, via RPC `confirmar_troca_senha()`.
