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

## 2026-11-09 — Etapa 2: motor de cálculo

31. **Motor em funções puras** (`lib/cmv/engine.ts`): sem banco, sem relógio e sem fuso. "Hoje" e "hoje_ref" são parâmetros. Datas são **datas civis de SP** (`"AAAA-MM-DD"`). A conversão de instante para data acontece só em `lib/cmv/datas.ts`, com `date-fns` + `@date-fns/tz` no fuso `America/Sao_Paulo`. A aritmética de calendário usa `Date.UTC` e não depende do fuso da máquina. Os testes rodam com `TZ=UTC`, como a Vercel.
32. **Centavos inteiros** (`lib/cmv/dinheiro.ts`). `centavos()` converte o `numeric` do banco (string) e o texto pt-BR sem passar por float. Valores derivados (tetos, orçamentos, projeções) são arredondados ao centavo no ponto em que são calculados.
33. **Meta diária arredondada pelo acumulado:** `acumulada(n) = round(meta × Σpeso(1..n) / Σpeso)` e `meta_dia(n) = acumulada(n) − acumulada(n−1)`. Cada acumulado é exato ao centavo e a soma dos dias fecha a meta do mês.
34. **`hoje_ref`** = ontem, se tiver venda completa; senão, o último dia com venda completa antes de hoje. Sem vendas → nenhum dia decorrido, fator 1, projeção = meta. Por enquanto o painel considera "completo" qualquer dia com venda; a regra fina (os dois turnos, todas as origens) entra com a sincronização (Etapa 5).
35. **Semanas futuras no orçamento:** distribuem o que sobra depois da semana atual, supondo que ela consuma o **maior valor entre o orçamento e o já comprado**. No cenário do briefing (nada comprado na S2) isso dá exatamente os 5.889,60 do teste 3. Além disso, faz um estouro na semana atual reduzir **na hora** as semanas seguintes (critério de aceite), sem esperar a semana virar. O limite de 125% vale também para as semanas futuras.
36. **Semanas encerradas** mostram o orçamento como foi calculado no início de cada uma, com o teto da projeção atual. São usadas no "esperado até hoje" do semáforo.
37. **Semáforo:** `desvio% = (comprado no mês − esperado até hoje) / esperado`. Verde ≤ 0%, amarelo ≤ 10%, vermelho > 10% (`LIMIARES_RITMO`). Os dias decorridos da semana incluem hoje. Esperado = 0 com compra > 0 → vermelho.
38. **Mês encerrado** (hoje depois do fim do mês): `semanaAtual = null`, todas as semanas encerradas, sem "disponível agora".
39. **CMV:** a régua usa o CMV real quando há as duas contagens; senão, o CMV de compras. `divergenciaBase = caixa − ERP` aparece no relatório.
40. **Vitest 4.1.12 + Vite 7.3.8, com `rollup` fixado em 4.67.5** (`overrides`). O Vitest 5 usa o rolldown, cujo binário nativo é bloqueado pelo Smart App Control desta máquina. A versão WASM do rolldown não lida com caminhos `C:\`. O rollup mais recente (4.68.2) também é bloqueado, por ainda não ter reputação. A 4.67.5 é aceita e já inclui a correção do GHSA-mw96-cpmx-2vgc. `npm audit`: 0 vulnerabilidades. Ao atualizar dependências com binário nativo, teste antes nesta máquina.

## 2026-11-10 — Etapa 3: notas

41. **Troca de categoria vale só para a nota** (decisão do Mauricio). A coluna `notas.categoria_fora_do_padrao` é calculada pelo banco (trigger `notas_0_categoria_padrao`) no lançamento e sempre que a categoria ou o fornecedor mudam, comparando com a categoria padrão do fornecedor *naquele momento*. A conferência destaca essas notas. O usuário não consegue alterar a marcação diretamente.
42. **Fluxo de lançamento:** o navegador gera o `id` da nota, comprime a foto (lado maior 1600 px, JPEG 0,8, rotação EXIF corrigida; PDF vai como está), envia ao bucket em `AAAA/MM/<id>.<ext>` com a sessão do usuário e chama a server action `criarNota`. A action valida tudo de novo, **confere se a foto existe no bucket** e grava. Se a gravação falhar, o próximo envio reaproveita a foto já enviada. Reenviar o mesmo formulário não duplica a nota (mesmo `id`).
43. **Foto substituída na edição** ganha um nome novo (`AAAA/MM/<uuid>.<ext>`). A foto antiga continua no bucket e o caminho anterior fica na auditoria (nada é sobrescrito).
44. **Dois botões de foto:** "Tirar foto" (`capture="environment"`, abre a câmera direto, como pede o briefing) e "Arquivo / PDF" (sem `capture`), porque com `capture` o celular não deixa escolher PDF nem foto da galeria.
45. **Padrões por fornecedor:** com prazo cadastrado, a forma de pagamento padrão é boleto e o vencimento é data + prazo. Sem prazo, o padrão é "caixa", sem vencimento. Os dois são editáveis em "mais detalhes" e deixam de mudar sozinhos quando o usuário mexe neles.
46. **Data da nota não pode ser futura.** Mês fechado é barrado pelo banco: o trigger impede gravar a nota e a política do Storage impede enviar a foto.
47. **Botões rápidos:** os 5 fornecedores com mais notas nos últimos 90 dias, completados por ordem alfabética enquanto não houver histórico. "Fruteira de hoje" abre o formulário com o fornecedor Fruteira.
48. **A secret key continua fora da Vercel.** Upload, URL assinada (10 min) e todas as gravações usam a sessão do usuário, com RLS. A secret key só entra quando houver processo sem usuário (cron de sincronização, Etapa 5).
49. **`numeric` chega do PostgREST como número JSON**, não como string. Tudo passa por `centavos()`, que aceita os dois formatos.
50. **Lista de notas:** miniaturas com a imagem inteira (`loading="lazy"`), porque o redimensionamento de imagem do Supabase é recurso pago. Com fotos de ~200 KB fica aceitável; revisar se a lista ficar pesada no 4G.
51. **`/painel/cmv` provisório:** mostra o "disponível nesta semana" de cada categoria (do motor) e confirma a nota recém-lançada. O painel completo é a Etapa 4.

## 2026-11-10 — Etapa 4: painel

52. **Troca de senha** já existe desde o ajuste pós-Etapa 1 (item 30): `/painel/conta/senha`, link no cabeçalho, obrigatória no primeiro acesso.
53. **Orçamento provisório** (pedido do Mauricio para a entrada em uso no meio do mês). `diasSemVenda()` no motor lista os dias de 1 até ontem sem venda registrada. Enquanto houver algum, o painel mostra o aviso "Dados de venda incompletos: orçamento provisório" com os dias faltantes, marca o card principal como "provisório" e gera um alerta. Um dia conta como registrado se tem linha em `vendas_turno` (manual ou planilha), mesmo zerada, ou aba sincronizada em `fechamento_turno`. Para dias sem movimento, a tela de vendas tem "Sem movimento neste dia", que grava venda zero.
54. **Alertas** (`lib/cmv/alertas.ts`, função pura com testes): orçamento provisório, teto do mês estourado ou sem saldo (erro), semana estourada (avisa que as próximas semanas já foram reduzidas), ritmo vermelho e fornecedores novos (só admin). Os alertas de caixa entram na Etapa 5.
55. **Vendas manuais** (`/painel/cmv/vendas`): grade do mês (dias sem venda em destaque, com a meta do dia) e um editor por dia com turno × origem, com os mesmos campos da planilha. Gravação por upsert em (data, turno, origem) com `fonte='manual'`. Linhas vindas da planilha aparecem somente leitura e nunca são sobrescritas (a action ignora e o RLS bloqueia). Só o admin remove lançamentos manuais.
56. **Painel** (`/painel/cmv`):
    - card principal da 1ª categoria (Pescados) com o disponível da semana, barra comprado/orçamento da semana, semáforo e "S2 · 08 a 14/11";
    - cards das demais categorias com teto, comprado, saldo e disponível da semana;
    - bloco de vendas com projeção conservadora em destaque, tendência, realizado × meta acumulada e últimas atualizações;
    - CMV parcial com a faixa da régua;
    - tabela semanal por categoria;
    - alertas e botões flutuantes;
    - navegação por mês (`?mes=AAAA-MM`), sem botões de lançamento em mês passado ou fechado.
57. **Limpeza de dados de teste** (`npm run limpar-teste`). Funciona em dois passos: o 1º só lista e gera um código ligado ao plano exato (hash dos ids); o 2º exige `--confirmar <código>`, e se os dados mudarem no meio o código não confere. Apaga todas as notas (e a auditoria delas), os fornecedores fora do cadastro inicial, os meses criados automaticamente que ficarem sem uso e todas as fotos. Com `--vendas`, apaga também as vendas. Recusa rodar se houver mês fechado. As proteções contra exclusão (triggers) são desligadas só dentro da transação. `--ensaio` executa e desfaz, para conferir.

## 2026-11-10 — Ajuste da tabela semanal (pedido do Mauricio)

58. **Semana encerrada:** a coluna "Orçamento atual" mostra o **comprado** (em cinza), porque a sobra já foi redistribuída. O orçamento original da semana continua no motor (`orcamento`) e é usado no ritmo. A tela usa `orcamentoAtual`.
59. **Linha "Mês"** = comprado nas semanas encerradas + semana atual + semanas futuras (`alocadoMes`). Na **semana atual** entra o maior entre orçamento e comprado, a mesma regra da base das semanas futuras (item 35). Assim um estouro da semana atual, que já foi descontado das semanas seguintes, não aparece como reserva.
60. **Linha "Reserva (não alocado pela trava de 125%)"** = teto − Mês. Mês + Reserva = teto, sempre. Reserva negativa só acontece quando as compras já passaram do teto; nesse caso a linha se chama "Compras acima do teto", em vermelho.
61. **Arredondamentos que fecham:** o planejado original passou a ser arredondado pelo acumulado (como a meta diária), então a soma das 4 semanas = teto exato. A soma das semanas futuras nunca passa da base disponível nem por 1 centavo. Teste de propriedade com 768 cenários (4 projeções × 32 datas × 6 conjuntos de compras): Mês + Reserva = teto; soma do planejado = teto; reserva ≥ 0 sempre que as compras não passaram do teto; semana encerrada = comprado. Os 8 testes obrigatórios continuam com os mesmos valores.

## 2026-11-10 — Etapa 5 (parte 1): leitor da planilha validado com a planilha real

62. **Chave do Google** em `GOOGLE_SERVICE_ACCOUNT_JSON` (JSON em base64), gravada por `npm run configurar-google -- "<arquivo.json>"`, que não exibe o conteúdo. Cliente: `@googleapis/sheets`, o pacote só da API Sheets, bem menor que `googleapis`; escopo `spreadsheets.readonly`; leitura com `UNFORMATTED_VALUE` (números chegam como número).
63. **Layout real da aba diária** ("Caixas OJI Sushi"):
    - "TURNO 1" em B1 e "TURNO 2" em I1, mas o bloco 2 começa em H. O bloco começa na menor coluna entre o título do turno e a seção "Restaurante" correspondente.
    - Rótulos na coluna A/H, valores em C/J. A "Loja" tem os sub-rótulos Dinheiro/Cartão na coluna B/I.
    - Restaurante | Despesas ficam lado a lado, e o resumo (Total do Dia, Total Pedidos, Dinheiro em Caixa) fica em E/F e L/M.
    - Por isso cada seção é um **retângulo**: colunas até a próxima seção à direita, linhas até a próxima seção na mesma faixa de colunas. A busca do valor à direita não sai da seção, para o resumo não vazar para as origens.
    - A aba 08/11 real virou teste fixo (`parser.test.ts`).
64. **A planilha é anual:** 340 abas `DD/MM` num arquivo só (mais Metas e Motoboys). A sincronização filtra as abas pelo mês da competência; o ano vem da competência.
65. **Validação 08/11:** T1 2.253,81 · T2 2.792,77 · dia 5.046,58, idênticos aos valores informados. Acumulado 01–08/11 pelas partes: **30.670,84**. A aba Metas mostra 30.779,84: são **R$ 109,00 a mais**, exatamente a soma da "Qtd. Pedidos" do Oji Tele T2 de 01 a 07/11 (21+15+12+16+13+15+17). Os valores "Vendido" da aba Metas são digitados à mão e foram copiados quando o Total do Oji Tele T2 ainda tinha o erro de fórmula (somava a Qtd. Pedidos). As abas diárias hoje estão corretas (`=SUM(J13:J15)`). O sistema usa a soma das partes, como manda o briefing.

## 2026-11-10 — Etapa 5 (parte 2): sincronização

66. **Planejamento puro + execução separada.** `lib/cmv/planilha/planejar.ts` (testado) decide o que gravar, o que é conflito e o que é alerta. `sincronizar.ts` lê o Google e o banco, aplica o plano com a **secret key** (só servidor) e registra cada execução em `sincronizacoes`.
67. **Quais dias:** do dia 1 até **ontem** (a aba de hoje ainda está sendo preenchida). Todo dia lido grava as 8 linhas (2 turnos × 4 origens), mesmo zeradas, mais 2 `fechamento_turno` com `bruto` = leitura do turno + grade inteira da aba. Upsert por (data, turno, origem) / (data, turno): é idempotente.
68. **Vendas manuais (pedido do Mauricio: avisar, não ignorar).**
    - Manual **igual** à planilha (mesmos valores; qtd. de pedidos vazia no manual não conta como diferença) → é **conciliada**: passa a ser da planilha.
    - Manual **diferente** → **não é sobrescrita**. Vira registro em `conflitos_venda`, alerta no painel e card na tela de Vendas com "Usar a planilha" / "Manter o manual", decisão só do admin, auditada. Enquanto pendente, vale o manual.
    - "Manter o manual" grava a impressão digital dos valores da planilha: se a planilha mudar depois, o conflito reaparece.
    - Conflito que deixa de existir (alguém corrigiu) é removido na sincronização seguinte.
69. **Planilha do mês:** `meses.planilha_url`; sem link no mês, vale o do mês configurado mais recente (a planilha é anual). O admin edita em Vendas → Planilha do mês, que mostra o e-mail da conta de serviço. O link de novembro já foi gravado (é o da mensagem do Mauricio).
70. **Gatilhos.** O botão "Sincronizar agora" pode ser usado por qualquer membro. A sincronização **automática ao abrir o painel** roda em segundo plano (componente cliente chama uma server action) se a última tiver mais de 30 min. O **cron** roda às 04:00 de São Paulo (`0 7 * * *` UTC em `vercel.json`) em `/api/cron/sync-vendas`, com `Authorization: Bearer CRON_SECRET` (comparação em tempo constante). Cada gatilho sincroniza o mês atual e, se ontem for do mês anterior **e esse mês existir no sistema**, também ele. Assim, no dia 1º fecha o último dia, mas meses fora do módulo não são importados.
71. **Concorrência:** não inicia se houver sincronização "executando" do mesmo mês iniciada há menos de 3 minutos. Mês fechado é ignorado (e o banco também bloquearia).
72. **Alertas de caixa** (no painel):
    - falha da última sincronização (erro);
    - conflitos pendentes;
    - "possível cupom não lançado": despesa Mercado > 0 no caixa e nenhuma nota ativa de Mercado na data;
    - totais da planilha que não batem com as partes (origem e Total do Dia);
    - abas faltando ou vazias até ontem;
    - planilha não configurada (só admin).

    Divergências e abas vêm do resumo da última sincronização bem-sucedida; Mercado sem nota é calculado na hora, a partir de `fechamento_turno` e `notas`.
73. **Modo ensaio** (`ensaio: true`): lê a planilha e o banco e monta o plano sem gravar nada (nem o registro). É usado no teste de integração `npm run test:integracao`, com a planilha real: 01–08/11 = 30.670,84, 64 linhas, 16 fechamentos, 0 conflitos, 0 divergências.
74. **Segredos na Vercel** (`SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `CRON_SECRET`, como "sensitive", em Production e Preview) são enviados pelo próprio Mauricio com `npm run vercel:segredos`. O script lê do `.env.local` e não exibe nada. O `CRON_SECRET` foi gerado localmente (32 bytes aleatórios).
75. **O cron só roda em Production** (branch `main`). Até o merge, a sincronização no preview é pelo botão ou pela automática.
76. **Entrada em uso (09/11/2026):**
    - dados de teste limpos com `limpar-teste --vendas` (1 nota cancelada e 1 foto);
    - 1ª sincronização real pela rota do cron, rodando localmente: 01–08/11 = **R$ 30.670,84**, 64 linhas, 16 fechamentos, 0 conflitos, 0 divergências;
    - 2ª execução sem alterar nada (idempotente);
    - painel: aviso de provisório some, projeção R$ 100.150,65, Pescados disponível na S2 R$ 9.041,39 (limite de 125%).
77. **Divergências da planilha visíveis em dois lugares** (pedido do Mauricio):
    - no painel, como alerta com dia, turno, origem e valores, apontando para `Vendas#divergencias`;
    - na tela Vendas, na seção "Divergências na planilha" (tabela com total da planilha × soma das partes × diferença) e com a marca "divergência" no dia da grade.

    Fonte: o resumo da última sincronização bem-sucedida (é atualizado a cada sincronização; some quando a planilha é corrigida).
78. **Link "Acesso equipe" no rodapé da landing** (pedido e autorização do Mauricio, 09/11/2026): é a única alteração permitida no `public/index.html`. Uma linha logo abaixo do selo da PZO, 12 px, na cor `var(--gray-text)` do rodapé, sem sublinhado, apontando para `/painel`: sem login, vai para o login; logado, vai para o painel. O estilo é inline, sem mexer no CSS da página. O `scripts/verificar-landing.sh` exige essa linha exatamente uma vez e, retirada a linha, o arquivo tem de ser byte a byte igual à tag `estado-original`. Logo e PDFs continuam idênticos.
79. **Barra de vendas: cor pelo sentido certo.** Vender acima da meta acumulada é bom, então a barra fica verde. Até 10% abaixo fica amarela; mais que 10% abaixo, vermelha (`corVendas`, `LIMIAR_VENDAS_AMARELO = 0.1`). O percentual ao lado segue a mesma cor. As barras de compra continuam como antes (passar do orçamento é ruim).
80. **CMV parcial sem compras:** com zero compras no mês (e sem CMV real), o percentual é `null`, então o painel mostra "—", o texto "Sem compras lançadas no mês" e nenhuma faixa da régua. Antes aparecia "0,0%" com a faixa mais baixa, como se o mês estivesse ótimo.
81. **Tela Vendas: Total do dia colorido pela meta do dia** (pedido do Mauricio). É só visual; nenhuma regra de cálculo mudou.
    - Total maior ou igual à meta: verde (`text-green-700`) com ▲. Total menor que a meta: vermelho (`text-red-700`) com ▼. São os mesmos tons do painel, e o negrito continua. Na linha selecionada, que tem fundo escuro, usam-se as variantes claras (`-300`) para manter o contraste.
    - Ficam neutros: dia sem venda (—), dia "sem movimento" (registrado com total zero) e dia sem meta. Dias futuros não aparecem na grade.
    - A diferença ("+R$ 517,68 (+16,0%) vs. meta") aparece ao passar o mouse (só em dispositivos com mouse) ou ao tocar. Tocar fora ou apertar Esc fecha. O botão tem `aria-label` com o texto completo. A regra fica em `lib/cmv/meta-dia.ts` (`compararComMeta`), com testes.
82. **Compra sem nota fiscal: tipo `sem_nota` ("Sem nota (aguardando)")** (pedido do Mauricio).
    - **Pendente de nota fiscal** é um estado derivado (`tipo = 'sem_nota'` e `status = 'ativa'`, função `ehPendenteNF`), não um novo valor de `status`. A compra continua ativa e entra no orçamento pela data (rótulo "Data de chegada") como qualquer nota; o motor não mudou.
    - O banco exige observação (`notas_sem_nota_com_observacao`). A foto continua obrigatória, mas pode ser romaneio, pedido, recibo ou a mercadoria.
    - No formulário, a opção fica visível ("Mercadoria chegou sem nota fiscal"), sem depender de "Mais detalhes". Marcada, ela mostra a observação obrigatória e troca os rótulos da foto e da data.
83. **Quando a nota chega, a mesma entrada é editada.** O botão "A nota fiscal chegou" abre `/editar?nf=1`, que já vem com o tipo NF-e e o motivo "Nota fiscal recebida" (o gestor pode trocar).
    - Ao sair de `sem_nota`, o app exige foto nova e, para NF-e ou cupom, o número.
    - A foto antiga continua no bucket (sem DELETE) e na auditoria (`antes.foto_path`). A página da nota lista as "Fotos anteriores".
    - Segue as regras de qualquer edição: motivo obrigatório e conferência volta a pendente.
    - A data **não** muda sozinha: o aviso orienta manter a data de chegada (é ela que define a semana do orçamento).
84. **Pendentes no painel e na lista.**
    - Painel: alerta "X compra(s) aguardando nota fiscal", que conta pendentes de qualquer mês e aparece mesmo olhando um mês fechado.
    - Lista: faixa no topo, filtro "Aguardando nota fiscal" (todos os meses), linha com borda âmbar, "⏳ Aguardando NF" e a observação.
    - A tela de conferência ainda não existe (Etapa 6). Ela vai usar o mesmo `ehPendenteNF`.
85. **Aviso de possível duplicidade** (`lib/cmv/duplicidade.ts`, constantes `DUPLICIDADE.tolerancia = 0.05` e `DUPLICIDADE.janelaDias = 15`).
    - Regra: outra nota **ativa** do mesmo fornecedor, com |novo − existente| ≤ 5% do existente (em centavos) e datas a até 15 dias, para trás ou para frente. Assim pega também o lançamento atrasado. Os limites são inclusivos.
    - A checagem roda **antes** do envio da foto (ação `verificarDuplicidade`), assim não sobra arquivo órfão quando a pessoa desiste. Roda ao criar e, na edição, só se fornecedor, valor ou data mudaram. A própria nota é excluída.
    - Ordem: "sem nota" primeiro, depois o valor mais próximo e por fim a data mais próxima.
    - Botões: [Abrir a existente] e [É outra compra, salvar]. Se a existente é "sem nota", o aviso fica âmbar e o botão principal passa a ser "Editar a pendente (lançar a nota fiscal)".
86. **Fechamento exige zero pendentes ou justificativa por pendente.** É garantido no banco: `fechar_mes` recusa enquanto houver nota ativa `sem_nota` do mês com `pendencia_justificativa` vazia.
    - Só o admin grava a justificativa (trigger `notas_0_sem_nota`), na página da nota. Ela não é campo de negócio: não exige motivo nem reabre a conferência, mas fica auditada.
    - A justificativa é limpa quando a nota deixa de ser `sem_nota`.
    - A tela de fechamento (Etapa 7) vai mostrar isso como item do checklist.

## 2026-11-10 — Dia em andamento (pedido do Mauricio)

87. **A sincronização também lê a aba de hoje, mas o dia parcial não entra no cálculo.**
    - **Turno preenchido** = soma das partes das origens > 0. **Dia completo** = os dois turnos preenchidos (`lib/cmv/dia-atual.ts`, funções puras com testes).
    - **Parcial:** nada de hoje é gravado em `vendas_turno` nem em `fechamento_turno`. Os turnos lidos ficam só no resumo da sincronização (`sincronizacoes.resumo.diaAtual`), sem migração. Não gera alerta de aba faltando/vazia nem conflito com venda manual.
    - **Completo:** hoje entra no plano como qualquer dia (gravação, conflitos, divergências) e passa a contar. Cada nova sincronização no mesmo dia regrava os valores (upsert).
    - **Motor:** `calcularPainel` ganhou `hojeCompleto` (padrão `false`). Sem ele, as vendas de hoje ficam fora de tudo: projeção, ritmo (fator), cores e CMV. Com ele, `hoje_ref` pode ser hoje. O painel calcula `hojeCompleto` pelo banco: turnos 1 e 2 com total > 0, venha da planilha ou de lançamento manual.
    - **Depois da meia-noite** o dia vira "ontem" e a sincronização o grava como sempre, completo ou não. A sincronização automática ao abrir o painel passa a rodar também quando a última foi num **dia anterior** (em SP), mesmo com menos de 30 min (`precisaSincronizar`). O cron das 04:00 continua.
    - **Exibição:**
      - no painel, abaixo de "Vendas até…": etiqueta "parcial" + "10/11 · Turno 1: R$ 1.654,23 · Turno 2: aguardando";
      - na tela Vendas, a mesma linha no topo, e na linha de hoje da grade os turnos com valor, "aguardando" e o Total em cor neutra com a etiqueta "parcial" (sem ▲▼);
      - o "Total no mês" exclui o parcial e mostra "+ R$ X parcial de hoje".
    - **Banco × planilha:** turno a turno, vale o banco (ex.: lançamento manual) quando tem valor; senão, a leitura da planilha.
    - **Dia gravado no meio do preenchimento** (ex.: T2 só com o restaurante): as linhas são da planilha, então cada sincronização seguinte do mesmo dia e a das 04:00 (em que ele já é "ontem") regravam o dia inteiro com os valores atuais da planilha (upsert, sem conflito). Teste em `planejar.test.ts`.
    - **Limitação aceita:** se a planilha ficar completa, for gravada e depois um turno for apagado no mesmo dia, o valor gravado permanece até a sincronização depois da meia-noite, que regrava o dia.

## 2026-11-10 — Indicadores de CMV sem a distorção do calendário de compras (pedido do Mauricio)

As compras são concentradas na segunda (para seg–qui) e na sexta (para sex–dom). Por isso o CMV parcial e o ritmo prorrateado por dia davam "47,3% Crítico" e "acima do ritmo" com as compras dentro do planejado.

88. **CMV projetado de fechamento: indicador principal do card de CMV, com a régua** (`calcularCmvProjetado`).
    - Fórmula: (compras ativas do mês + planejado restante) ÷ projeção conservadora.
    - Planejado restante, por categoria = planejado **original** das semanas futuras + max(0, planejado original da semana atual − comprado na semana atual). Semanas encerradas não somam nada.
    - O planejado original (não o redistribuído) faz a compra além do plano aparecer no %.
    - Abaixo: "Para fechar em 35%, ainda pode comprar até R$ X no mês" (teto total − compras do mês). Se as compras já passaram do teto, a frase mostra quanto passaram, em vermelho.
89. **CMV por semana fechada** (`calcularCmvSemanas`, seção "CMV por semana" no painel).
    - Uma linha por semana: venda, compras por categoria (pela data da nota), CMV total e CMV da categoria principal (Pescados e Linha Seca).
    - **Semana fechada** = o último dia já passou e todos os dias dela têm venda registrada. Só ela mostra %.
    - Demais situações, sem %: a semana atual aparece "em andamento", com valores parciais em cinza (sem o dia parcial de hoje, decisão 87); semana passada com dia sem venda fica "aguardando vendas"; semanas futuras, "—".
    - **Acumulado das semanas fechadas**: soma da venda e das compras das semanas fechadas, com o mesmo cálculo.
    - **Régua por categoria**: a régua do total escalada pela meta da categoria (`reguaDaCategoria`: limite × pct_meta_cat ÷ meta_cmv_pct). Pescados (26,67%) fica assim: Ótimo ≤ 27,43%, Bom ≤ 28,57%, Atenção ≤ 29,71%, Crítico acima. O total usa a régua como está (meta de 35%).
    - O relatório de fechamento (Etapa 7) deve incluir esta mesma tabela, a partir da mesma função.
90. **CMV parcial vira informativo**: cor neutra, sem faixa da régua, com o texto "Compras ÷ venda até ontem. Sobe após cada compra grande e se dilui até o fim do mês." A régua com cor vale só para o CMV projetado, as semanas fechadas e o fechamento. O motor continua calculando `cmv.faixa`, para uso no fechamento.
91. **Ritmo de compra sem prorrateio diário.**
    - Esperado = orçamento das semanas encerradas + orçamento **inteiro** da semana atual. O campo agora se chama `esperadoAteFimDaSemana`; com o mês encerrado, vale o orçamento de todas as semanas.
    - Semáforo: verde ≤ 0; amarelo até +10% ("Acima do ritmo (até 10%)"); vermelho acima disso ("Acima do ritmo").
    - O alerta "compras acima do ritmo" aparece sempre que o desvio passa de zero (antes só no vermelho), com o texto "o planejado até o fim desta semana é R$ X". O alerta de semana estourada continua tendo prioridade.
    - Cenário de 10/11 (Pescados, projeção 100.517,64): S1 6.868,73 e S2 5.171,46 dão CMV projetado de 26,28% (Ótimo) e nenhum alerta de ritmo; o CMV da S1 é 26,81%. Os dois valores estão nos testes.

## 2026-11-10 — Etapa 6: conferência, fornecedores e contagem de estoque

92. **Conferência** (`/painel/cmv/conferencia`, só admin; item "Conferência" no menu).
    - Navega nota a nota pelas notas **ativas** do mês, em ordem de data e de lançamento. Filtros: pendentes (padrão), conferidas, divergentes e todas; também por categoria e fornecedor.
    - Depois de marcar, avança sozinha. Se a nota sai do filtro (ex.: conferida em "pendentes"), vai para a seguinte; se era a última, para a anterior. "Voltar para pendente" fica na mesma nota.
    - Atalhos no desktop: **C** conferida, **D** divergente (abre a observação; Enter confirma, Esc cancela), **← →** anterior/próxima. Não disparam com o foco num campo.
    - Divergente exige observação (CHECK que já existia, mais validação na action). A conferência continua só do admin e bloqueada em mês fechado (triggers da Etapa 1).
    - Progresso "23 de 36 conferidas", com divergentes e pendentes ao lado. **Divergente conta como revisada, mas não como conferida**; a barra mostra as duas cores.
    - Na lista de notas e na página da nota, o status vira um menu para o admin: Conferida, Divergente (com observação) e Voltar para pendente. O gestor continua vendo só o texto.
93. **Destaques de cada nota** (`lib/cmv/conferencia.ts`, funções puras com testes), do mais grave para o menos grave:
    - **possível duplicidade**: a regra da decisão 85 (mesmo fornecedor, valor até 5%, até 15 dias), com link para a outra nota. Vale o pedido do Mauricio na Etapa 6, não os "3 dias" do briefing. A busca inclui as notas dos 15 dias antes e depois do mês;
    - **sem nota (aguardando)**, com a observação ou a justificativa do fechamento;
    - **fornecedor novo**, com link para Fornecedores;
    - **categoria trocada** (`categoria_fora_do_padrao`);
    - **caixa relacionado**: só para notas de Mercado e só com o caixa do dia sincronizado. Compara a despesa "Mercado" do caixa com a soma das notas de Mercado do dia:
      - diferença até R$ 1,00 ou até 5%, o que for maior (`TOLERANCIA_CAIXA`): "Confere com o caixa" (verde);
      - caixa maior que as notas: "possível cupom não lançado";
      - notas maiores que o caixa: "parte paga fora do caixa ou lançada na data errada";
      - nota paga "no caixa" num dia com despesa de Mercado zerada: também gera aviso.

    Os dias com despesa de Mercado e **nenhuma** nota de Mercado não têm nota em que aparecer. Eles ficam numa lista no topo da tela.
94. **Visor da foto, sem biblioteca** (`conferencia/visor-foto.tsx`).
    - Roda do mouse: zoom no ponto do cursor.
    - Pinça e arrasto: Pointer Events, com `touch-action: none` só dentro do quadro.
    - Duplo clique ou toque: aproxima ou volta. Botões − / % / + / Abrir.
    - Zoom de 1× a 8×, sem deixar a imagem sair do quadro.
    - PDF aparece num `iframe`, com link para abrir em outra aba.
95. **Fornecedores** (`/painel/cmv/fornecedores`, só admin; item no menu).
    - Lista com nome, categoria padrão, prazo, CNPJ, nº de notas no mês escolhido e selo "novo". Os novos vêm primeiro. Filtros: ativos, novos, inativos e todos. O admin também cadastra fornecedor por aqui, e o cadastro já nasce revisado.
    - Editar nome, categoria padrão, prazo (0 a 365 dias) e CNPJ (14 dígitos; a máscara é removida). Mudar a categoria padrão **não** altera as notas já lançadas (decisão 41).
    - **Marcar como revisado** preenche `revisado_em` e `revisado_por`: o selo some e o fornecedor sai do alerta do painel. O alerta "X fornecedor(es) novo(s)" agora leva para `Fornecedores?filtro=novos`.
    - Desativar/reativar: o fornecedor inativo some do lançamento de notas, mas as notas dele continuam.
96. **Mesclar fornecedores**: RPC `mesclar_fornecedores(p_manter, p_remover)`, só admin, numa transação. Combina o pedido do Mauricio ("as notas do outro passam para ele") com a decisão 29 (mês fechado é imutável).
    - **Notas de meses abertos:** passam para o fornecedor que fica, com o motivo "Mescla de fornecedores: X → Y" na auditoria de cada nota.
      - A troca **não** devolve a nota para "pendente". O trigger `tg_notas_antes` respeita a flag de sessão `cmv.mescla_fornecedor`, que só é ligada dentro da RPC.
      - O destaque "categoria trocada" é recalculado contra a categoria padrão do fornecedor que fica.
    - **Notas de meses fechados:** continuam no duplicado. Ele fica desativado, com `mesclado_em_id` apontando para o fornecedor que fica e `mesclado_em` com a data da mescla. Um CHECK impede reativar um fornecedor mesclado.
    - **Auditoria:** registro `merge` com os dois cadastros de antes, o nº de notas movidas e o nº de notas que ficaram em mês fechado.
    - **Na tela:** o admin escolhe o outro fornecedor e **qual fica**, e confirma em dois passos.
97. **Contagem de estoque** (`/painel/cmv/contagem`, gestor e admin; item "Contagem" no menu).
    - **Rascunho e finalizada.** `contagens.status` vai de `rascunho` para `finalizada` (com `finalizada_por/em`). Continua uma contagem de fechamento por mês (unique que já existia). Regras no banco:
      - toda contagem nasce rascunho e a data não pode ser futura;
      - não finaliza sem itens;
      - finalizada não muda, nem os itens dela, para ninguém, e não pode ser apagada;
      - só volta a rascunho por `reabrir_contagem(id, motivo)` (admin, motivo obrigatório);
      - auditoria: `insert`, `finalize` (com o total), `reopen` (com o motivo) e `delete`;
      - o mês fechado continua bloqueando tudo (triggers da Etapa 1).
    - **Tela para o celular.**
      - Um cartão por item: quantidade com teclado decimal, unidade, × custo unitário e valor.
      - Agrupado por categoria, com filtro por categoria, "só os que faltam" e busca. Enter leva ao próximo item.
      - Barra fixa embaixo: total ao vivo, "n de m itens contados", estado do salvamento, "Salvar rascunho" e "Finalizar".
    - **Rascunho salvo sozinho** 2,5 s depois da última digitação, com aviso ao sair se houver alteração não salva. Item com quantidade em branco fica fora da contagem. Ao finalizar, a tela avisa, e os itens em branco são gravados como **0**.
    - **Custo pré-preenchido** com o último custo usado para o item numa contagem finalizada; sem histórico, com o custo de referência do cadastro. Para finalizar, todo item com quantidade maior que zero precisa de custo.
    - **Quantidade em milésimos inteiros** (`numeric(12,3)`): aceita "12,5", "0,250" e "1.5" (ponto do teclado). O valor na tela usa o mesmo arredondamento da coluna gerada, `round(q × c, 2)` (`lib/cmv/contagem.ts`, com testes).
    - **Mês da contagem.** Só pode ser iniciada no mês atual ou no anterior, porque a de novembro pode ser feita em 01/12. Uma faixa avisa quando a contagem do mês anterior ainda não foi finalizada (se esse mês existir no sistema e estiver aberto).
    - **Cadastro de itens** (`/painel/cmv/contagem/itens`, admin): nome (único, sem diferenciar maiúsculas e espaços), unidade (kg/un/cx/pct/l), categoria, custo de referência e ordem; editar e desativar. As alterações nos itens vão para a auditoria.
98. **Estoque no CMV.** `carregarPainel` passa ao motor o **estoque inicial** (contagem finalizada do mês anterior) e o **estoque final** (a do mês). O CMV real (`estoque inicial + compras − estoque final`) só existe com as duas. Novembro não tem contagem de outubro, então o primeiro CMV real será o de **dezembro** (contagens de 30/11 e 31/12). Novembro fecha com o CMV de compras.
99. **Migração 0009 aplicada no banco compartilhado antes do merge.**
    - É só aditiva, e a produção atual não usa nada dela. O trigger de notas é o mesmo, só com a flag da mescla a mais.
    - Antes de aplicar, foi ensaiada com `npm run db:test-rls -- --com-migracao <arquivo>`. A opção é nova e aplica a migração dentro da transação desfeita do teste.
    - Agora são 86 testes de banco, 24 deles novos (conferência, mescla e contagem).
