# Status do módulo de CMV

Atualizado em **10/11/2026**. Branch de trabalho: `cmv/etapa-1`. Produção: `main`, publicada em https://www.ojisushi.com.br.

## 1. Pronto e em produção

O último merge na `main` é o `ace8c62` (indicadores de CMV). A `cmv/etapa-1` tem a Etapa 6 a mais (seção 2).

**Landing**
- Byte a byte igual à tag `estado-original`, com uma única exceção autorizada: o link "Acesso equipe" no rodapé (decisão 78).
- `scripts/verificar-landing.sh` confere isso. Passou em produção depois de cada merge de hoje.

**Etapas 1 a 5 do `PROMPT.md`**
- Login, papéis (admin e gestor) e troca de senha obrigatória.
- Regras de acesso e de mês fechado garantidas no banco.
- Notas: lançar com foto obrigatória, editar com motivo, cancelar e consultar o histórico. O gestor pode criar fornecedor (marcado como "novo").
- Motor de cálculo: meta diária, projeção, teto por categoria, orçamento semanal com trava de 125%, CMV e régua.
- Painel com alertas.
- Vendas: grade, lançamento manual e sincronização com a planilha "Caixas OJI Sushi". A sincronização roda pelo botão, de forma automática ao abrir o painel e pelo cron diário às 04:00 de São Paulo (`/api/cron/sync-vendas`).
- Conflitos entre venda manual e planilha, e divergências da planilha.

**Ajustes de hoje (todos em produção)**
- Barra de vendas verde acima da meta.
- CMV "—" sem compras.
- Coluna Total da tela Vendas colorida pela meta, com ▲/▼ e diferença ao passar o mouse ou tocar.
- Compra sem nota fiscal ("Sem nota (aguardando)"), aviso de possível duplicidade e fechamento que exige zero pendentes ou justificativa.

**Dados reais no banco**
- Vendas de 01 a 08/11/2026: 64 linhas, total **R$ 30.670,84**.
- Meses: 11/2026 (meta R$ 95.000, com planilha) e 12/2026 (meta R$ 100.000).
- 4 fornecedores iniciais (Frumar, FEMSA, Fruteira, Mercado).
- O Douglas começou a lançar: em 10/11 à noite eram **39 notas** (36 ativas em novembro, todas pendentes de conferência) e **16 fornecedores** (12 "novos", cadastrados por ele).

## 2. Só na branch, aguardando merge

**Etapa 6: conferência, fornecedores e contagem de estoque** (decisões 92 a 99), aguardando o teste do Mauricio no preview.
- `/painel/cmv/conferencia` (admin): nota a nota, foto com zoom, Conferida/Divergente, atalhos C/D/←/→, filtros, destaques e progresso. O status de conferência ficou clicável na lista e na página da nota.
- `/painel/cmv/fornecedores` (admin): editar, desativar, marcar como revisado, mesclar e cadastrar. O alerta de fornecedores novos virou link.
- `/painel/cmv/contagem` (gestor e admin) e `/painel/cmv/contagem/itens` (admin): cadastro de itens, contagem no celular com rascunho automático e finalização. A contagem finalizada entra no CMV real (estoque inicial/final).
- **A migração `20261112090000_etapa6_fornecedores_contagem.sql` já está aplicada no banco compartilhado** (é aditiva; decisão 99).
- **Prazo:** os itens de contagem precisam estar cadastrados antes de 30/11 (primeira contagem real).

## 3. Pendências abertas

| # | Pendência | Situação / o que se sabe |
|---|---|---|
| 1 | **Loop de redirecionamento no preview** | Relatado pelo Mauricio; não investigado nesta sessão. Ao retomar: reproduzir no alias do preview (`oji-sushi-site-git-cmv-etapa-1-mauricio-s-projects17.vercel.app`), olhar `proxy.ts` (redireciona `/painel` ↔ `/painel/login`) e a proteção de deploy da Vercel (o preview pode exigir login da Vercel antes do app). |
| 2 | **Restringir o `limpar-teste`** | O script (`scripts/limpar-dados-teste.mjs`) já pede código de confirmação. Falta limitar o que ele pode apagar (ex.: só registros marcados como teste ou criados por usuários de teste), agora que há dados reais. |
| 3 | **Limpeza pontual das notas de teste** | ✅ **Concluída hoje.** Foram apagadas 5 notas canceladas (1 Frumar de R$ 121,00 em 09/11 e 4 "TESTE AUTOMATIZADO" de 06/2027), 10 registros de histórico, 1 foto e o mês 06/2027. Tudo numa transação, com conferência das vendas (R$ 30.670,84 intactos). |
| 4 | **Troca de foto na edição** | Relatado pelo Mauricio; detalhe a confirmar com ele. Hoje a edição aceita foto nova com nome novo (a antiga fica no bucket e na auditoria; a página da nota lista "Fotos anteriores"). A foto vai para a pasta do mês da data da nota. |
| 5 | **Backup semanal** | Não iniciado. Definir o que copiar (banco e bucket `notas`), para onde e quem roda. O Supabase CLI não roda nesta máquina (Smart App Control), então o backup deve usar `pg_dump`/biblioteca `postgres` ou um agendamento na nuvem. |
| 6 | **Banco separado para o preview** | Não iniciado. Hoje preview e produção usam o **mesmo** Supabase (`zjmzujzgwgkplghszuyi`): o que se lança no preview vai para o banco real e as migrações valem para os dois na hora em que são aplicadas. |
| 7 | **Cores da coluna Total em Vendas** | ✅ **Concluída hoje** e em produção (decisão 81). Falta só ver num celular de verdade o comportamento ao tocar. |
| 8 | **Etapa 6: conferência, fornecedores e contagem** | Na branch, aguardando OK (seção 2). Depois do merge: o Mauricio cadastra os itens de contagem; a 1ª contagem real é em 30/11/2026. |
| 9 | **Etapa 7: fechamento do mês e PDF/Excel** | Checklist do fechamento: zero compras aguardando nota fiscal ou uma justificativa por pendente (o banco já recusa fechar sem isso: decisão 86). Incluir no relatório a tabela "CMV por semana" (`calcularCmvSemanas`, decisão 89). |
| 10 | **Etapa 8: revisão final e `docs/cmv/OPERACAO.md`** | Também: tela de configurações (Etapa 9 do briefing). A mescla de fornecedores saiu na Etapa 6. |

## 4. Decisões de hoje (em `docs/cmv/DECISOES.md`)

- **1 a 77:** etapas 1 a 5 e a entrada em produção.
- **78:** link "Acesso equipe" no rodapé, a única alteração permitida no `index.html`. O `verificar-landing.sh` exige essa linha exatamente uma vez.
- **79:** barra de vendas verde na meta ou acima; amarela até 10% abaixo; vermelha mais abaixo.
- **80:** CMV parcial sem compras mostra "—", "Sem compras lançadas no mês" e nenhuma faixa da régua.
- **81:** coluna Total da tela Vendas colorida pela meta do dia, com ▲/▼ e diferença.
- **82 a 86:** compra sem nota fiscal, que cobre:
  - o tipo `sem_nota`;
  - a conversão quando a nota chega, com histórico de foto;
  - os pendentes no painel e na lista;
  - o aviso de duplicidade (5% e 15 dias, constantes em `lib/cmv/duplicidade.ts`);
  - o fechamento que exige justificativa.
- **87 a 91:** dia em andamento (parcial) e indicadores de CMV (projetado, por semana fechada, parcial informativo, ritmo sem prorrateio).
- **92 a 99:** Etapa 6, que cobre:
  - a conferência e os destaques de cada nota;
  - o visor com zoom;
  - a tela de fornecedores e a mescla (notas de mês fechado ficam, conferência mantida);
  - a contagem com rascunho e finalização no banco;
  - o estoque no CMV real;
  - a migração aplicada antes do merge.

## 5. Como retomar

### Variáveis de ambiente (`.env.local`, nunca no git; modelo em `.env.example`)
| Variável | Uso |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chave publishable (`sb_publishable_…`) |
| `SUPABASE_SERVICE_ROLE_KEY` | chave secret (`sb_secret_…`), **só servidor** |
| `SUPABASE_DB_URL` | Postgres pelo session pooler (`aws-1-sa-east-1.pooler.supabase.com`), só para scripts locais; **não** vai para a Vercel |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | conta de serviço em base64 (gravada por `npm run configurar-google`), **só servidor** |
| `CRON_SECRET` | segredo do cron |

Na Vercel (Production e Preview) estão todas, menos `SUPABASE_DB_URL`. Para enviá-las: `npm run vercel:segredos`. Segredos nunca passam pelo chat.

### Comandos
```sh
git checkout cmv/etapa-1 && git pull
npm install
npm run db:status          # migrações aplicadas (9, até 20261112090000_etapa6_fornecedores_contagem.sql)
npm test                   # 158 testes de cálculo
npm run db:test-rls        # 86 testes de regras no banco (transação desfeita: não grava nada)
npm run typecheck
npm run build && npx next start -p 3123   # servidor local
sh scripts/verificar-landing.sh http://localhost:3123
```

### O que conferir primeiro
1. `git status` limpo e `cmv/etapa-1` igual à `main` (`git log --oneline -1` nas duas: `8740515` ou um commit de docs depois dele).
2. `npm run db:status` sem migração pendente; `npm test` e `npm run db:test-rls` passando.
3. Produção: `sh scripts/verificar-landing.sh https://www.ojisushi.com.br`.
4. Banco: as vendas sincronizadas pelo cron das 04:00 (09/11 em diante) e as notas que o Douglas tiver lançado. A partir daqui há **dados reais**: testes de ponta a ponta não podem gravar no banco sem limpeza aprovada.

### Cuidados do ambiente
- O **Smart App Control** bloqueia binários sem assinatura: sem Supabase CLI (migrações por `npm run db:migrate`) e com Vitest 4 / Vite 7 e `overrides.rollup = 4.67.5`. Não desligar o Smart App Control.
- O merge na `main` (produção) só acontece com OK explícito do Mauricio. Depois de cada merge, rodar `verificar-landing.sh` contra produção.
- O banco proíbe apagar notas, auditoria e meses. Uma limpeza exige transação com as travas desligadas só dentro dela, e aprovação explícita.
