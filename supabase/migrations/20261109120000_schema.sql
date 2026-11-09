-- =============================================================================
-- Módulo CMV · Oji Sushi — 0001 · Schema
-- Dinheiro: numeric(12,2). Percentuais: frações (0.35 = 35%).
-- Domínios como text + CHECK (fáceis de evoluir sem ALTER TYPE).
-- =============================================================================

create schema if not exists interno;   -- funções internas (não exposto na Data API)

-- -----------------------------------------------------------------------------
-- Perfis (1:1 com auth.users)
-- -----------------------------------------------------------------------------
create table public.perfis (
  id          uuid primary key references auth.users (id) on delete cascade,
  nome        text not null check (length(trim(nome)) > 0),
  papel       text not null check (papel in ('admin', 'gestor')),
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Configuração
-- -----------------------------------------------------------------------------
create table public.categorias_cmv (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null unique,
  slug      text not null unique check (slug ~ '^[a-z0-9-]+$'),
  pct_meta  numeric(12,10) not null check (pct_meta >= 0 and pct_meta <= 1),
  ordem     integer not null default 0,
  ativa     boolean not null default true
);

create table public.fornecedores (
  id                     uuid primary key default gen_random_uuid(),
  nome                   text not null unique check (length(trim(nome)) > 0),
  cnpj                   text check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  categoria_padrao_id    uuid not null references public.categorias_cmv (id),
  prazo_vencimento_dias  integer check (prazo_vencimento_dias is null or prazo_vencimento_dias >= 0),
  ativo                  boolean not null default true,
  criado_em              timestamptz not null default now()
);

create table public.meses (
  id                  uuid primary key default gen_random_uuid(),
  competencia         date not null unique check (extract(day from competencia) = 1),
  meta_venda          numeric(12,2) not null default 90000 check (meta_venda > 0),
  meta_cmv_pct        numeric(6,4) not null default 0.35 check (meta_cmv_pct > 0 and meta_cmv_pct < 1),
  pesos_semana        jsonb not null default '[6.5, 6.5, 5.5, 5.5]'::jsonb
                        check (jsonb_typeof(pesos_semana) = 'array' and jsonb_array_length(pesos_semana) = 4),
  limite_acumulo_pct  numeric(6,4) not null default 1.25 check (limite_acumulo_pct >= 1),
  planilha_url        text,
  venda_base_erp      numeric(12,2) check (venda_base_erp is null or venda_base_erp >= 0),
  status              text not null default 'aberto' check (status in ('aberto', 'fechado')),
  fechado_por         uuid references public.perfis (id),
  fechado_em          timestamptz,
  criado_em           timestamptz not null default now(),
  constraint meses_fechamento_coerente check (
    (status = 'aberto'  and fechado_por is null and fechado_em is null) or
    (status = 'fechado' and fechado_em is not null)
  )
);

create table public.pesos_dia_semana (
  dia_semana  smallint primary key check (dia_semana between 0 and 6),   -- 0 = domingo
  peso        numeric(10,2) not null check (peso > 0)
);

create table public.regua_cmv (
  id                   uuid primary key default gen_random_uuid(),
  faixa                text not null unique,
  limite_superior_pct  numeric(6,4) check (limite_superior_pct is null or limite_superior_pct > 0),  -- null = sem teto
  cor                  text not null,
  ordem                integer not null
);

-- -----------------------------------------------------------------------------
-- Notas de compra
-- Preparada para ganhar depois: nota_itens (FK nota_id) e chave_acesso (NF-e).
-- -----------------------------------------------------------------------------
create table public.notas (
  id                   uuid primary key default gen_random_uuid(),
  mes_id               uuid not null references public.meses (id),       -- definido por trigger a partir da data
  data_emissao         date not null,
  fornecedor_id        uuid not null references public.fornecedores (id),
  categoria_id         uuid not null references public.categorias_cmv (id),
  tipo                 text not null default 'nfe' check (tipo in ('nfe', 'cupom', 'comanda', 'outro')),
  numero               text,
  valor                numeric(12,2) not null check (valor > 0),
  vencimento           date,
  forma_pagamento      text not null default 'boleto' check (forma_pagamento in ('boleto', 'caixa', 'pix', 'outro')),
  descricao            text,
  observacao           text,
  foto_path            text not null check (length(foto_path) > 0),
  status               text not null default 'ativa' check (status in ('ativa', 'cancelada')),
  motivo_cancelamento  text,
  conferencia          text not null default 'pendente' check (conferencia in ('pendente', 'conferida', 'divergente')),
  conferencia_obs      text,
  conferida_por        uuid references public.perfis (id),
  conferida_em         timestamptz,
  -- Parâmetro de passagem: o app envia o motivo da edição aqui; o trigger grava
  -- em auditoria e zera o campo. Nunca fica preenchido na tabela.
  motivo_edicao        text,
  criado_por           uuid not null default auth.uid() references public.perfis (id),
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now(),
  constraint notas_cancelamento_com_motivo check (status <> 'cancelada' or length(trim(coalesce(motivo_cancelamento, ''))) > 0),
  constraint notas_divergente_com_obs check (conferencia <> 'divergente' or length(trim(coalesce(conferencia_obs, ''))) > 0)
);
create index notas_mes_categoria_idx on public.notas (mes_id, categoria_id) where status = 'ativa';
create index notas_data_idx on public.notas (data_emissao);
create index notas_fornecedor_idx on public.notas (fornecedor_id, data_emissao);

-- -----------------------------------------------------------------------------
-- Vendas (planilha de fechamento de caixa ou manual)
-- -----------------------------------------------------------------------------
create table public.vendas_turno (
  id               uuid primary key default gen_random_uuid(),
  data             date not null,
  turno            smallint not null check (turno in (1, 2)),
  origem           text not null check (origem in ('restaurante', 'oji_tele', 'shakai_tele', 'wabi_tele')),
  dinheiro         numeric(12,2) not null default 0,
  credito          numeric(12,2) not null default 0,
  debito           numeric(12,2) not null default 0,
  pix              numeric(12,2) not null default 0,
  loja_dinheiro    numeric(12,2) not null default 0,
  loja_cartao      numeric(12,2) not null default 0,
  online           numeric(12,2) not null default 0,
  total_calculado  numeric(12,2) generated always as
                     (dinheiro + credito + debito + pix + loja_dinheiro + loja_cartao + online) stored,
  qtd_pedidos      integer check (qtd_pedidos is null or qtd_pedidos >= 0),
  fonte            text not null default 'manual' check (fonte in ('planilha', 'manual')),
  sincronizado_em  timestamptz,
  criado_por       uuid references public.perfis (id) default auth.uid(),
  atualizado_em    timestamptz not null default now(),
  unique (data, turno, origem)
);

create table public.fechamento_turno (
  id                  uuid primary key default gen_random_uuid(),
  data                date not null,
  turno               smallint not null check (turno in (1, 2)),
  total_dia_planilha  numeric(12,2),
  total_pedidos       integer,
  despesa_mercado     numeric(12,2) not null default 0,
  despesa_motoboy     numeric(12,2) not null default 0,
  despesa_outros      numeric(12,2) not null default 0,
  divergencia         numeric(12,2),
  bruto               jsonb,
  sincronizado_em     timestamptz not null default now(),
  unique (data, turno)
);

-- -----------------------------------------------------------------------------
-- Contagem de estoque
-- -----------------------------------------------------------------------------
create table public.itens_contagem (
  id                  uuid primary key default gen_random_uuid(),
  nome                text not null unique,
  unidade             text not null check (unidade in ('kg', 'un', 'cx', 'pct', 'l')),
  categoria_id        uuid not null references public.categorias_cmv (id),
  custo_unitario_ref  numeric(12,2) check (custo_unitario_ref is null or custo_unitario_ref >= 0),
  ordem               integer not null default 0,
  ativo               boolean not null default true
);

create table public.contagens (
  id             uuid primary key default gen_random_uuid(),
  mes_id         uuid not null references public.meses (id),
  data           date not null,
  tipo           text not null default 'fechamento' check (tipo in ('fechamento')),
  realizada_por  uuid not null default auth.uid() references public.perfis (id),
  criado_em      timestamptz not null default now(),
  unique (mes_id, tipo)          -- uma contagem de fechamento por mês
);

create table public.contagem_itens (
  id              uuid primary key default gen_random_uuid(),
  contagem_id     uuid not null references public.contagens (id) on delete cascade,
  item_id         uuid not null references public.itens_contagem (id),
  quantidade      numeric(12,3) not null check (quantidade >= 0),
  custo_unitario  numeric(12,2) not null check (custo_unitario >= 0),
  valor           numeric(12,2) generated always as (round(quantidade * custo_unitario, 2)) stored,
  unique (contagem_id, item_id)
);

-- -----------------------------------------------------------------------------
-- Auditoria (append-only) e histórico
-- -----------------------------------------------------------------------------
create table public.auditoria (
  id           bigint generated always as identity primary key,
  tabela       text not null,
  registro_id  text not null,
  acao         text not null check (acao in ('insert', 'update', 'cancel', 'reopen', 'close')),
  antes        jsonb,
  depois       jsonb,
  motivo       text,
  usuario_id   uuid,
  em           timestamptz not null default now()
);
create index auditoria_registro_idx on public.auditoria (tabela, registro_id, em desc);

create table public.historico_mensal (
  competencia  date primary key check (extract(day from competencia) = 1),
  venda        numeric(12,2) not null,
  cmv_valor    numeric(12,2),            -- null quando só o % é conhecido
  cmv_pct      numeric(8,6) not null,
  detalhe      jsonb
);

-- RLS em tudo (o projeto também tem o event trigger ensure_rls; aqui é explícito).
alter table public.perfis            enable row level security;
alter table public.categorias_cmv    enable row level security;
alter table public.fornecedores      enable row level security;
alter table public.meses             enable row level security;
alter table public.pesos_dia_semana  enable row level security;
alter table public.regua_cmv         enable row level security;
alter table public.notas             enable row level security;
alter table public.vendas_turno      enable row level security;
alter table public.fechamento_turno  enable row level security;
alter table public.itens_contagem    enable row level security;
alter table public.contagens         enable row level security;
alter table public.contagem_itens    enable row level security;
alter table public.auditoria         enable row level security;
alter table public.historico_mensal  enable row level security;

-- Nenhum acesso anônimo ao módulo.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
