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
