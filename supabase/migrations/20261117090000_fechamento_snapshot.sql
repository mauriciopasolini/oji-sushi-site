-- =============================================================================
-- Etapa 7 · Fechamento do mês com SNAPSHOT (decisões 111 a 113).
--
-- * public.fechamentos: uma linha por fechamento (versão 1, 2… a cada refechamento
--   depois de uma reabertura). Guarda o snapshot (JSON montado pelo app com o mesmo
--   motor do painel), a assinatura dos dados e um resumo em colunas (para o
--   histórico e para o DRE futuro). Só inclusão: ninguém altera nem apaga.
-- * public.fechar_mes(mes, snapshot, assinatura) substitui fechar_mes(mes):
--     1. exige o checklist inteiro (interno.pendencias_fechamento);
--     2. recalcula a assinatura e recusa se os dados mudaram desde a montagem;
--     3. grava o snapshot e fecha o mês, na mesma transação.
-- * reabrir_mes(mes, motivo) não muda: o snapshot anterior fica como histórico.
-- Aditiva para os dados: nenhum mês está fechado quando ela é aplicada.
-- =============================================================================

create table public.fechamentos (
  id           uuid primary key default gen_random_uuid(),
  mes_id       uuid not null references public.meses (id),
  versao       integer not null check (versao >= 1),
  snapshot     jsonb not null,
  assinatura   jsonb not null,
  venda_base   numeric(12,2) not null,
  cmv_valor    numeric(12,2) not null,
  cmv_pct      numeric(8,6),
  cmv_tipo     text not null check (cmv_tipo in ('real', 'compras')),
  criado_por   uuid references public.perfis (id),
  criado_em    timestamptz not null default now(),
  unique (mes_id, versao)
);

alter table public.fechamentos enable row level security;
revoke all on public.fechamentos from anon;
revoke insert, update, delete, truncate on public.fechamentos from authenticated, service_role;
create policy fechamentos_select on public.fechamentos for select to authenticated using ((select interno.eh_membro()));

-- Só inclusão, e só por dentro de fechar_mes.
create or replace function interno.tg_fechamentos()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'O snapshot do fechamento não pode ser alterado nem apagado.' using errcode = '42501';
  end if;
  if coalesce(current_setting('cmv.gravar_snapshot', true), '') <> 'on' then
    raise exception 'Use a função fechar_mes para gravar o fechamento.' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger fechamentos_regras
  before insert or update or delete on public.fechamentos
  for each row execute function interno.tg_fechamentos();

-- -----------------------------------------------------------------------------
-- Checklist do fechamento: lista do que falta (vazia = pode fechar).
-- Mesmas regras de lib/cmv/fechamento/checklist.ts.
-- -----------------------------------------------------------------------------
create or replace function interno.pendencias_fechamento(p_mes_id uuid)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  v_comp date;
  v_fim  date;
  v_erp  numeric;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_r    text[] := '{}';
  n      bigint;
begin
  select competencia, venda_base_erp into v_comp, v_erp from public.meses where id = p_mes_id;
  if v_comp is null then
    return array['mês inexistente'];
  end if;
  v_fim := (v_comp + interval '1 month' - interval '1 day')::date;

  if v_hoje <= v_fim then
    v_r := v_r || format('o mês só termina em %s', to_char(v_fim, 'DD/MM/YYYY'));
  end if;

  select count(*) into n
    from generate_series(v_comp, v_fim, interval '1 day') g(d)
   where not exists (select 1 from public.vendas_turno v where v.data = g.d::date)
     and not exists (select 1 from public.fechamento_turno f where f.data = g.d::date);
  if n > 0 then
    v_r := v_r || format('%s dia(s) sem venda registrada', n);
  end if;

  select count(*) into n from public.conflitos_venda c
   where c.resolucao is null and c.data between v_comp and v_fim;
  if n > 0 then
    v_r := v_r || format('%s conflito(s) de venda sem resolver', n);
  end if;

  if not exists (select 1 from public.contagens c where c.mes_id = p_mes_id and c.tipo = 'fechamento' and c.status = 'finalizada') then
    v_r := v_r || 'contagem de fechamento não finalizada'::text;
  end if;

  select count(*) into n from public.notas x where x.mes_id = p_mes_id and x.status = 'ativa' and x.conferencia = 'pendente';
  if n > 0 then
    v_r := v_r || format('%s nota(s) pendente(s) de conferência', n);
  end if;

  select count(*) into n from public.notas x
   where x.mes_id = p_mes_id and x.status = 'ativa' and x.tipo = 'sem_nota' and x.pendencia_justificativa is null;
  if n > 0 then
    v_r := v_r || format('%s compra(s) aguardando nota fiscal sem justificativa', n);
  end if;

  select count(distinct f.id) into n
    from public.notas x join public.fornecedores f on f.id = x.fornecedor_id
   where x.mes_id = p_mes_id and x.status = 'ativa' and f.revisado_em is null;
  if n > 0 then
    v_r := v_r || format('%s fornecedor(es) novo(s) sem revisão', n);
  end if;

  if v_erp is null then
    v_r := v_r || 'total ERP + delivery não informado'::text;
  end if;
  return v_r;
end $$;

-- -----------------------------------------------------------------------------
-- Assinatura dos dados do mês (centavos inteiros). Igual a assinaturaDe() em
-- lib/cmv/fechamento/montar.ts.
-- -----------------------------------------------------------------------------
create or replace function interno.assinatura_fechamento(p_mes_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_comp date;
  v_fim  date;
  v_erp  numeric;
  v_ant  uuid;
  v_estoque_final bigint;
  v_estoque_inicial bigint;
begin
  select competencia, venda_base_erp into v_comp, v_erp from public.meses where id = p_mes_id;
  v_fim := (v_comp + interval '1 month' - interval '1 day')::date;
  select id into v_ant from public.meses where competencia = (v_comp - interval '1 month')::date;

  select round(sum(i.valor) * 100)::bigint into v_estoque_final
    from public.contagens c join public.contagem_itens i on i.contagem_id = c.id
   where c.mes_id = p_mes_id and c.tipo = 'fechamento' and c.status = 'finalizada';
  select round(sum(i.valor) * 100)::bigint into v_estoque_inicial
    from public.contagens c join public.contagem_itens i on i.contagem_id = c.id
   where c.mes_id = v_ant and c.tipo = 'fechamento' and c.status = 'finalizada';

  return jsonb_build_object(
    'notas', (select count(*) from public.notas x where x.mes_id = p_mes_id and x.status = 'ativa'),
    'notasTotal', (select coalesce(round(sum(x.valor) * 100), 0)::bigint from public.notas x where x.mes_id = p_mes_id and x.status = 'ativa'),
    'vendasTotal', (select coalesce(round(sum(v.total_calculado) * 100), 0)::bigint from public.vendas_turno v where v.data between v_comp and v_fim),
    'erp', case when v_erp is null then null else round(v_erp * 100)::bigint end,
    'estoqueFinal', v_estoque_final,
    'estoqueInicial', v_estoque_inicial
  );
end $$;

revoke execute on function interno.pendencias_fechamento(uuid) from public;
revoke execute on function interno.assinatura_fechamento(uuid) from public;
grant execute on function interno.pendencias_fechamento(uuid) to authenticated, service_role;
grant execute on function interno.assinatura_fechamento(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- fechar_mes com checklist, assinatura e snapshot. A versão antiga (só o id) sai:
-- fechar sem snapshot não é mais possível.
-- -----------------------------------------------------------------------------
drop function public.fechar_mes(uuid);

create or replace function public.fechar_mes(p_mes_id uuid, p_snapshot jsonb, p_assinatura jsonb)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare
  v_antes  jsonb;
  v_depois jsonb;
  v_comp   date;
  v_pend   text[];
  v_assin  jsonb;
  v_versao integer;
begin
  if not (interno.eh_admin() or interno.eh_servico()) then
    raise exception 'Somente o administrador pode fechar o mês.' using errcode = '42501';
  end if;
  select to_jsonb(m), m.competencia into v_antes, v_comp from public.meses m where id = p_mes_id and status = 'aberto' for update;
  if v_antes is null then
    raise exception 'Mês inexistente ou já fechado.' using errcode = 'P0001';
  end if;

  v_pend := interno.pendencias_fechamento(p_mes_id);
  if coalesce(array_length(v_pend, 1), 0) > 0 then
    raise exception 'Não é possível fechar o mês: %.', array_to_string(v_pend, '; ')
      using errcode = 'P0001', hint = 'checklist';
  end if;

  v_assin := interno.assinatura_fechamento(p_mes_id);
  if p_assinatura is null or v_assin is distinct from p_assinatura then
    raise exception 'Os dados do mês mudaram enquanto o fechamento era preparado. Recarregue a página e tente de novo.'
      using errcode = 'P0001', hint = 'assinatura';
  end if;

  if p_snapshot is null
     or p_snapshot->>'competencia' is distinct from v_comp::text
     or (p_snapshot->>'formato') is distinct from '1'
     or (p_snapshot->>'previa') is distinct from 'false'
     or p_snapshot->'assinatura' is distinct from p_assinatura
     or jsonb_typeof(p_snapshot->'base'->'base') is distinct from 'number'
     or jsonb_typeof(p_snapshot->'cmv'->'valor') is distinct from 'number'
     or (p_snapshot->'cmv'->>'tipo') not in ('real', 'compras') then
    raise exception 'Snapshot do fechamento inválido.' using errcode = 'P0001', hint = 'snapshot';
  end if;

  select coalesce(max(f.versao), 0) + 1 into v_versao from public.fechamentos f where f.mes_id = p_mes_id;

  perform set_config('cmv.gravar_snapshot', 'on', true);
  insert into public.fechamentos (mes_id, versao, snapshot, assinatura, venda_base, cmv_valor, cmv_pct, cmv_tipo, criado_por)
  values (
    p_mes_id, v_versao, p_snapshot, p_assinatura,
    (p_snapshot->'base'->>'base')::numeric / 100,
    (p_snapshot->'cmv'->>'valor')::numeric / 100,
    (p_snapshot->'cmv'->>'pct')::numeric,
    p_snapshot->'cmv'->>'tipo',
    auth.uid()
  );
  perform set_config('cmv.gravar_snapshot', 'off', true);

  perform set_config('cmv.permitir_status', 'on', true);
  update public.meses set status = 'fechado', fechado_por = auth.uid(), fechado_em = now()
   where id = p_mes_id returning to_jsonb(meses.*) into v_depois;
  perform set_config('cmv.permitir_status', 'off', true);

  perform interno.auditar('meses', p_mes_id::text, 'close', v_antes,
    v_depois || jsonb_build_object('versao_fechamento', v_versao, 'assinatura', p_assinatura), null);
  return v_versao;
end $$;

revoke execute on function public.fechar_mes(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.fechar_mes(uuid, jsonb, jsonb) to authenticated, service_role;
