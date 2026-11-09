# Prompt para o Claude Code — Módulo de Gestão de CMV (Oji Sushi)

> Cole este prompt inteiro no Claude Code, na raiz do repositório de `ojisushi.com.br`.

---

## Contexto

Você vai construir o primeiro módulo interno do site **ojisushi.com.br** (Next.js, deploy na Vercel): um painel de **gestão de CMV e Vendas** para a gerência do restaurante Oji Sushi, que opera três marcas na mesma cozinha (Oji, Shakai, Wabi). O site público atual é uma landing institucional e **não pode ser alterado nem quebrado**.

Usuários:
- **Douglas** (papel `gestor`): gerente da operação. Lança as notas de compra pelo celular, faz a contagem de estoque e acompanha o painel. Precisa de uma interface simples, rápida e mobile first.
- **Mauricio** (papel `admin`): sócio. Configura metas, confere as notas no início do mês seguinte, fecha o mês e exporta o relatório.

O problema que estamos resolvendo: hoje o controle é uma planilha com metas fixas em reais por semana e um campo "Efetuado" digitado à mão. O gerente não sabe quanto ainda pode comprar, e o estouro só aparece no fim do mês. O módulo precisa recalcular **a cada nota lançada e a cada sincronização de venda** quanto resta comprar no mês e na semana, descontando automaticamente os estouros das semanas seguintes.

## Regras de trabalho

1. **Antes de escrever código**, inspecione o repositório: versão do Next.js, App Router ou Pages Router, estilização (Tailwind?), componentes, gerenciador de pacotes, estrutura de pastas e configuração da Vercel. Apresente um resumo e um **plano de implementação em etapas**, e espere meu OK.
2. Trabalhe nas etapas abaixo, **uma por vez**, com commit ao fim de cada uma e um resumo do que foi feito e de como testar.
3. Se algo neste prompt conflitar com o que existe no repositório, **pergunte antes** de decidir.
4. Salve este prompt em `docs/cmv/PROMPT.md` e mantenha um `docs/cmv/DECISOES.md` com cada decisão técnica tomada.
5. Nunca exponha `SUPABASE_SERVICE_ROLE_KEY` nem a credencial do Google no cliente.
6. **Toda regra de data usa o fuso `America/Sao_Paulo`** (cuidado com `new Date()` em UTC no servidor da Vercel). Use uma biblioteca de datas com suporte a fuso (ex.: `date-fns-tz`).
7. Dinheiro: `numeric(12,2)` no Postgres; no TypeScript, calcule em **centavos inteiros**. Formatação pt-BR (`R$ 1.234,56`).
8. Interface em português do Brasil.

## Stack

- Next.js (a versão do repositório), rotas sob **`/painel/cmv`**, protegidas por middleware de autenticação e com `noindex`.
- **Supabase** (projeto novo e isolado): Postgres, Auth (e-mail + senha), Storage, RLS. Use `@supabase/ssr`.
- `googleapis` para a Google Sheets API, com **conta de serviço**.
- Vercel Cron para a sincronização diária, com rota protegida por `CRON_SECRET`.
- PDF gerado no servidor (ex.: `@react-pdf/renderer`) e XLSX com `exceljs`.
- Testes unitários do motor de cálculo com **Vitest**.

Variáveis de ambiente (crie `.env.example`):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON` (JSON em base64), `CRON_SECRET`.

## Modelo de dados (Supabase / Postgres)

Crie migrações SQL versionadas em `supabase/migrations`. Nomes em português, snake_case.

```
perfis            (id uuid = auth.users.id, nome, papel ['admin','gestor'], ativo, criado_em)

categorias_cmv    (id, nome, slug, pct_meta numeric(12,10), ordem, ativa)
  seed (insira como expressão, para manter precisão): 'Pescados e Linha Seca' 24.0/90 | 'Bebidas' 2.0/90 |
        'Mercado' 3.0/90 | 'Fruteira' 2.5/90   → somam exatamente 35%

fornecedores      (id, nome, cnpj null, categoria_padrao_id, prazo_vencimento_dias null, ativo)
  seed: Frumar → Pescados e Linha Seca | FEMSA → Bebidas | Fruteira → Fruteira | Mercado (genérico) → Mercado

meses             (id, competencia date [1º dia do mês], meta_venda numeric, meta_cmv_pct numeric default 0.35,
                   pesos_semana jsonb default [6.5,6.5,5.5,5.5], limite_acumulo_pct numeric default 1.25,
                   planilha_url text, venda_base_erp numeric null, status ['aberto','fechado'],
                   fechado_por, fechado_em)
  seed: 2026-11 meta 95000 | 2026-12 meta 100000 | padrão para meses novos: 90000

pesos_dia_semana  (dia_semana 0-6, peso numeric)
  seed (dom..sáb): 3300, 2700, 2500, 3300, 2950, 3700, 4200

regua_cmv         (id, faixa, limite_superior_pct, cor, ordem)
  seed: Ótimo ≤ 0.360 | Bom ≤ 0.375 | Atenção ≤ 0.390 | Crítico > 0.390

notas             (id, mes_id, data_emissao date, fornecedor_id, categoria_id, tipo ['nfe','cupom','comanda','outro'],
                   numero text null, valor numeric(12,2) > 0, vencimento date null,
                   forma_pagamento ['boleto','caixa','pix','outro'], descricao text null, observacao text null,
                   foto_path text NOT NULL, status ['ativa','cancelada'], motivo_cancelamento text null,
                   conferencia ['pendente','conferida','divergente'] default 'pendente',
                   conferencia_obs text null, conferida_por null, conferida_em null,
                   criado_por, criado_em, atualizado_em)

vendas_turno      (id, data date, turno [1,2], origem ['restaurante','oji_tele','shakai_tele','wabi_tele'],
                   dinheiro, credito, debito, pix, loja_dinheiro, loja_cartao, online, total_calculado,
                   qtd_pedidos int null, fonte ['planilha','manual'], sincronizado_em)
  unique (data, turno, origem)

fechamento_turno  (id, data, turno, total_dia_planilha, total_pedidos, despesa_mercado, despesa_motoboy,
                   despesa_outros, divergencia numeric, bruto jsonb, sincronizado_em)
  unique (data, turno)

itens_contagem    (id, nome, unidade ['kg','un','cx','pct','l'], categoria_id, custo_unitario_ref, ordem, ativo)
contagens         (id, mes_id, data date, tipo ['fechamento'], realizada_por, criado_em)
contagem_itens    (id, contagem_id, item_id, quantidade, custo_unitario, valor)

auditoria         (id, tabela, registro_id, acao ['insert','update','cancel','reopen','close'],
                   antes jsonb, depois jsonb, motivo, usuario_id, em)  — append-only
historico_mensal  (competencia, venda, cmv_valor, cmv_pct, detalhe jsonb)  — carga manual de meses anteriores
```

Seed do `historico_mensal`:
| competência | venda | CMV % |
|---|---|---|
| 2026-05 | 93821.99 | 36,7% |
| 2026-06 | 92965.26 | 36,5% |
| 2026-07 | 95596.00 | 38,6% |
| 2026-08 | 94348.31 | 37,6% |
| 2026-09 | 84413.69 | 40,5% |
| 2026-10 | 85921.54 | 35,2% (CMV 30223.90: Pescados 22917.59, Bebidas 2172.06, Mercado 2917.87, Fruteira 2216.38) |

**RLS:**
- `gestor`: lê tudo do módulo; insere e edita `notas`, `contagens` e `vendas_turno` (manual) **apenas em mês aberto**; não altera metas, configurações nem conferência.
- `admin`: tudo, inclusive conferir, fechar e reabrir mês.
- Mês fechado: nenhuma escrita em notas, contagens ou vendas daquele mês (garanta isso também no banco, não só na UI).
- Toda edição ou cancelamento de nota grava em `auditoria` (trigger). Nota nunca é apagada.

**Storage:** bucket privado `notas`, caminho `AAAA/MM/<nota_id>.<ext>`, aceita JPEG/PNG/WebP/PDF, até 10 MB. O cliente comprime imagens antes do upload (lado maior até ~1600 px, JPEG ~0,8). Exiba com URL assinada de curta duração.

## Motor de cálculo — `lib/cmv/engine.ts` (funções puras + testes)

Implemente como **funções puras**, sem acesso ao banco, recebendo os dados e devolvendo os resultados. Toda a UI consome esse módulo.

**Semanas do mês:** blocos fixos por dia do mês: S1 = 1–7, S2 = 8–14, S3 = 15–21, S4 = 22 até o último dia.

**Meta diária:**
```
peso_dia(d)   = pesos_dia_semana[dia_semana(d)]
meta_dia(d)   = meta_venda_mes × peso_dia(d) / Σ peso_dia(todos os dias do mês)
```

**Projeção de venda (regra assimétrica, conservadora):**
```
hoje_ref         = ontem (ou o último dia com venda sincronizada e completa)
realizado        = Σ venda total de 1 até hoje_ref
meta_acumulada   = Σ meta_dia de 1 até hoje_ref
meta_restante    = meta_venda_mes − meta_acumulada
fator_ritmo      = realizado / meta_acumulada            (se meta_acumulada = 0 → 1)
projecao         = realizado + meta_restante × min(1, fator_ritmo)
projecao_tendencia (informativa) = realizado / dias_decorridos × dias_do_mes
```

**Teto e saldo por categoria:**
```
teto_cat   = projecao × pct_meta_cat
saldo_cat  = teto_cat − Σ notas ativas da categoria no mês
```

**Orçamento da semana corrente (por categoria):**
```
pesos_restantes        = pesos das semanas k..4 (k = semana atual)
saldo_inicio_semana    = teto_cat − Σ notas da categoria em semanas anteriores a k
planejado_original_k   = teto_cat × peso_k / Σ todos os pesos
orcamento_semana       = min( saldo_inicio_semana × peso_k / Σ pesos_restantes ,
                              planejado_original_k × limite_acumulo_pct )
                         (nunca negativo: se saldo ≤ 0, orçamento = 0 e o estouro fica destacado)
disponivel_agora       = orcamento_semana − Σ notas da categoria na semana k
```
Devolva também, para cada semana: planejado original, orçamento recalculado e comprado.

**Ritmo de compra (semáforo):**
```
esperado_ate_hoje = Σ orçamento das semanas encerradas + orçamento_semana_atual × (dias decorridos na semana / dias da semana)
desvio            = comprado_no_mes − esperado_ate_hoje
```
Verde até +0%, amarelo até +10%, vermelho acima disso (limiares configuráveis em constante).

**CMV:**
```
cmv_compras_pct = Σ notas do mês / venda_base
cmv_real        = estoque_inicial + compras − estoque_final   (só quando existirem as duas contagens)
venda_base      = min(venda do caixa, venda_base_erp)  se venda_base_erp informada; senão a venda do caixa
```
`estoque_inicial` = contagem de fechamento do mês anterior.

**Testes obrigatórios (Vitest), com estes valores:**
1. Novembro/2026, meta 95.000, pesos acima: soma bruta do mês = 96.600; meta acumulada de 01 a 08/11 = **25.520,19** (±0,01); com realizado de **30.793,84** → projeção = **100.273,65** (±0,01).
2. Mesma projeção → teto de Pescados e Linha Seca ≈ **26.739,64**; teto total (35%) ≈ **35.095,78** (tolerância ±0,05).
3. Compras de Pescados e Linha Seca na S1 = 8.000; semana atual = S2 → saldo_inicio_semana = 18.739,64; orçamento S2 ≈ **6.960,44**; S3 e S4 ≈ **5.889,60** cada.
4. Venda abaixo da meta (fator_ritmo 0,9) → a meta restante é reduzida em 10%.
5. Sobra acumulada não ultrapassa 125% do planejado original da semana.
6. Estouro maior que o saldo → orçamento da semana = 0 e flag de estouro.
7. Dias 29–31 caem na S4; meses de 28, 29, 30 e 31 dias.
8. Datas no fuso de São Paulo (uma nota às 23h30 do dia 30 pertence ao dia 30, não ao dia 1º do mês seguinte).

## Sincronização com a planilha de fechamento de caixa (Google Sheets)

- O admin informa em `meses.planilha_url` o link da planilha do mês. O Mauricio compartilha a planilha, somente leitura, com o e-mail da conta de serviço. Mostre esse e-mail na tela de configurações.
- Cada dia é uma **aba** com nome `DD/MM` (ex.: `08/11`). Existem também as abas `Metas` e `Motoboys`, que devem ser ignoradas.
- Layout de cada aba diária: dois blocos lado a lado, **"TURNO 1"** e **"TURNO 2"**. Em cada bloco:
  - **Restaurante**: Dinheiro, Crédito, Débito, Pix, Total
  - **Oji Tele**, **Shakai Tele**, **Wabi Tele**: Qtd. Pedidos; Loja → Dinheiro, Cartão; Online; Total
  - **Despesas**: Mercado, Motoboy, Outros, Total
  - Resumo: **Total do Dia** (do turno), **Total Pedidos**, **Dinheiro em Caixa**
- **Parser por âncoras de texto, nunca por coordenada fixa**: localize os títulos ("TURNO 1", "TURNO 2", "Restaurante", "Oji Tele", "Despesas", "Total do Dia"…), normalizando acentos, caixa e espaços, e leia os valores relativos a cada âncora. A planilha é copiada todo mês e pode ter pequenas variações. Converta "R$ 1.234,56" para número. Célula vazia = 0.
- Guarde o conteúdo bruto lido em `fechamento_turno.bruto` para depuração.
- **Validações** (gerar alertas no painel):
  - `Σ partes` de cada origem × "Total" da origem na planilha. Exemplo real: 08/11, Oji Tele, Turno 2 — Online 1.010,72, Total 1.024,72 (diferença de 14,00, que é a Qtd. Pedidos; provável erro de fórmula na planilha). Use sempre o **total calculado pelas partes** e registre a divergência.
  - Soma das origens × "Total do Dia" do turno.
  - Dia do mês até ontem sem aba, ou com aba vazia.
  - **Despesa "Mercado" > 0 no caixa sem nenhuma nota de categoria Mercado lançada naquela data** → alerta "possível cupom não lançado".
- Upsert idempotente em `vendas_turno` e `fechamento_turno`. Venda manual (`fonte='manual'`) não é sobrescrita pela planilha sem confirmação.
- Gatilhos: botão "Sincronizar agora"; sincronização automática ao abrir o painel se a última tiver mais de 30 min (em background, sem travar a UI); cron diário às 04:00 de São Paulo (`/api/cron/sync-vendas`).
- Comece com um **script de teste do parser** que lê uma aba e imprime o JSON. Vou te passar o link da planilha para validarmos antes de ligar o cron.

## Telas (`/painel/cmv`)

Mobile first (o Douglas usa no celular), limpa, com números grandes. Desktop também deve ficar bom para o Mauricio.

1. **Login** (`/painel/login`): e-mail e senha. Sem cadastro público; o admin cria usuários.
2. **Painel** (`/painel/cmv`):
   - Card principal: **"Pescados e Linha Seca — disponível nesta semana: R$ X"**, com barra de progresso, semáforo e "S2 · 08 a 14/11".
   - Cards de Bebidas, Mercado e Fruteira: teto do mês, comprado, saldo.
   - Bloco de vendas: realizado × meta acumulada, projeção conservadora (destaque) e projeção por tendência (secundária), e a última sincronização com botão para sincronizar.
   - CMV parcial com a faixa da régua.
   - Tabela semanal: planejado original × orçamento atual × comprado.
   - Lista de alertas.
   - Botão flutuante **"+ Lançar nota"**.
3. **Lançar nota** (`/painel/cmv/notas/nova`): fornecedor (os 5 mais usados como botões, mais uma busca) → valor (teclado numérico) → foto (`<input type="file" accept="image/*,application/pdf" capture="environment">`). A categoria vem do fornecedor (editável) e a data padrão é hoje. Campos opcionais em "mais detalhes": número, vencimento (padrão pelo prazo do fornecedor), forma de pagamento, descrição, observação. Não salva sem foto. Após salvar, volta ao painel mostrando o novo "disponível". Atalho **"Fruteira de hoje"** que abre o formulário já com o fornecedor Fruteira.
4. **Notas** (`/painel/cmv/notas`): filtros por mês, categoria, semana, fornecedor e status de conferência; miniatura da foto; editar (pede motivo) e cancelar (pede motivo).
5. **Conferência** (`/painel/cmv/conferencia`, admin): navegação nota a nota com a foto ampliada (zoom), botões **Conferida** e **Divergente** (com observação), atalhos de teclado no desktop. Destaca possíveis duplicidades (mesmo fornecedor e valor em até 3 dias) e notas ligadas a alertas de caixa.
6. **Contagem de estoque** (`/painel/cmv/contagem`): lista dos itens ativos com campo de quantidade e custo unitário pré-preenchido com o último usado. Mostra o total. Uma contagem de fechamento por mês.
7. **Vendas** (`/painel/cmv/vendas`): grade diária (dia × turno × origem), com status da sincronização, divergências e lançamento manual.
8. **Fechamento** (`/painel/cmv/fechamento`, admin): checklist — vendas completas, contagem feita, notas conferidas, base ERP informada → **Fechar mês**. Reabrir exige motivo (auditado). Botões **Exportar PDF** e **Exportar Excel**.
9. **Configurações** (`/painel/cmv/config`, admin): meta mensal e % por categoria, pesos das semanas, limite de acúmulo, régua, pesos por dia da semana, fornecedores e prazos, itens de contagem, link da planilha do mês (com o e-mail da conta de serviço), usuários.

## Relatório de fechamento

**PDF (A4)** — cabeçalho "Oji Comércio de Alimentos · Oji · Shakai · Wabi — Fechamento de CMV — <Mês/Ano>":
1. Resumo: venda base, CMV R$ e %, meta de 35%, faixa da régua, variação contra o mês anterior.
2. Nota da base de cálculo: caixa × ERP e a divergência.
3. CMV por categoria (R$ e % sobre a venda), nas mesmas linhas do DRE Gerencial.
4. Semanas: planejado original × comprado.
5. Estoque inicial, estoque final e CMV real (quando houver as duas contagens), ou a observação "CMV de compras — sem contagem de estoque".
6. Relação de notas por categoria (data, fornecedor, nº, valor, vencimento, conferida).
7. Alertas do mês.
8. Comparativo com os últimos 6 meses (`historico_mensal` + meses fechados no sistema).

**Excel**: abas `Resumo`, `CMV por categoria`, `Notas`, `Vendas diárias`, `Contagem`, `Histórico`, em formato tabular, sem células mescladas nas abas de dados.

## Etapas de entrega

1. **Fundação:** diagnóstico do repositório, Supabase (cliente SSR, middleware, login), migrações, seeds, RLS, `.env.example`, papéis. *Checkpoint: eu logo como admin e como gestor.*
2. **Motor:** `lib/cmv/engine.ts` com todos os testes passando. *Checkpoint: rodar `vitest`.*
3. **Notas:** lançamento com foto, lista, edição e cancelamento com auditoria.
4. **Painel:** consumindo o motor, com vendas manuais por enquanto.
5. **Sincronização com o Sheets:** script de teste do parser → validação com a planilha real → integração → cron.
6. **Conferência e contagem de estoque.**
7. **Fechamento e relatórios PDF/Excel.**
8. **Revisão:** RLS (tente acessar dados como gestor em mês fechado e via API direta), acessibilidade básica, performance no celular, README de operação em `docs/cmv/OPERACAO.md` (como criar usuário, como trocar a planilha do mês, como fechar o mês).

## Fora do escopo agora (não implementar, mas não bloquear)

Importação automática de NF-e pela SEFAZ, leitura do QR code de NFC-e, itens por nota e preço por kg, fechamento de caixa dentro do sistema, ficha técnica e CMV teórico, DRE completo. Modele as tabelas de forma que `notas` possa ganhar `nota_itens` e `chave_acesso` depois, sem retrabalho.

## Critérios de aceite

- O Douglas lança uma nota com foto pelo celular em menos de 30 segundos, e o "disponível nesta semana" muda na hora.
- Um estouro na semana atual reduz automaticamente o orçamento das semanas seguintes, e o painel mostra isso.
- A venda do dia anterior aparece no painel sem digitação, lida da planilha de fechamento, com divergências sinalizadas.
- O Mauricio confere as notas do mês em uma tela só e fecha o mês com relatório PDF e Excel.
- Gestor não altera metas nem conferência, e ninguém escreve em mês fechado (testado no banco).
- O site público de `ojisushi.com.br` continua idêntico.
