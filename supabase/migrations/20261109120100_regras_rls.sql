-- =============================================================================
-- Módulo CMV · 0002 · Funções, triggers de integridade/auditoria e RLS
--
-- Princípios:
--   * Mês fechado bloqueia escrita em notas, vendas, fechamento de turno e
--     contagens NO BANCO (triggers valem para todos os papéis, inclusive admin
--     e service_role; para mudar, reabra o mês com motivo).
--   * Nota nunca é apagada. Edição exige motivo. Tudo vai para auditoria.
--   * Gestor não altera configuração nem conferência.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Identidade e papel
-- -----------------------------------------------------------------------------
create or replace function interno.papel_atual()
returns text language sql stable security definer set search_path = '' as $$
  select p.papel from public.perfis p where p.id = (select auth.uid()) and p.ativo
$$;

create or replace function interno.eh_membro()
returns boolean language sql stable security definer set search_path = '' as $$
  select interno.papel_atual() is not null
$$;

create or replace function interno.eh_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(interno.papel_atual() = 'admin', false)
$$;

-- Processos de servidor: secret key (role service_role no JWT) ou conexão
-- direta ao banco como postgres (migrações, scripts). NÃO é security definer,
-- para enxergar a sessão real.
create or replace function interno.eh_servico()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(auth.role(), case when session_user = 'postgres' then 'service_role' end) = 'service_role'
$$;

-- -----------------------------------------------------------------------------
-- Meses
-- -----------------------------------------------------------------------------
create or replace function interno.mes_fechado_em(p_data date)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.meses m
    where m.competencia = date_trunc('month', p_data)::date and m.status = 'fechado'
  )
$$;

create or replace function interno.exigir_mes_aberto(p_data date)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_data is not null and interno.mes_fechado_em(p_data) then
    raise exception 'O mês %/% está fechado. Peça ao administrador para reabri-lo.',
      to_char(p_data, 'MM'), to_char(p_data, 'YYYY')
      using errcode = 'P0001', hint = 'mes_fechado';
  end if;
end $$;

create or replace function interno.exigir_mes_aberto_id(p_mes_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_comp date;
begin
  select competencia into v_comp from public.meses where id = p_mes_id;
  perform interno.exigir_mes_aberto(v_comp);
end $$;

-- Cria o mês (com os padrões) se ainda não existir; devolve o id.
create or replace function interno.garantir_mes(p_data date)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_comp date := date_trunc('month', p_data)::date; v_id uuid;
begin
  select id into v_id from public.meses where competencia = v_comp;
  if v_id is null then
    insert into public.meses (competencia) values (v_comp)
    on conflict (competencia) do nothing;
    select id into v_id from public.meses where competencia = v_comp;
  end if;
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- Auditoria
-- -----------------------------------------------------------------------------
create or replace function interno.auditar(
  p_tabela text, p_registro_id text, p_acao text, p_antes jsonb, p_depois jsonb, p_motivo text
) returns void language sql volatile security definer set search_path = '' as $$
  insert into public.auditoria (tabela, registro_id, acao, antes, depois, motivo, usuario_id)
  values (p_tabela, p_registro_id, p_acao, p_antes, p_depois, nullif(trim(p_motivo), ''), auth.uid())
$$;

create or replace function interno.tg_auditoria_imutavel()
returns trigger language plpgsql as $$
begin
  raise exception 'A auditoria é somente inclusão (append-only).' using errcode = 'P0001';
end $$;

create trigger auditoria_imutavel
  before update or delete on public.auditoria
  for each row execute function interno.tg_auditoria_imutavel();

-- -----------------------------------------------------------------------------
-- Utilitário: atualizado_em
-- -----------------------------------------------------------------------------
create or replace function interno.tg_atualizado_em()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- NOTAS
-- -----------------------------------------------------------------------------
create or replace function interno.tg_notas_antes()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_admin   boolean := interno.eh_admin();
  v_srv     boolean := interno.eh_servico();
  v_motivo  text    := nullif(trim(new.motivo_edicao), '');
  v_negocio boolean := false;
  v_acao    text;
begin
  new.motivo_edicao := null;   -- parâmetro de passagem, nunca persiste

  if tg_op = 'UPDATE' then
    perform interno.exigir_mes_aberto(old.data_emissao);
    new.criado_por := old.criado_por;
    new.criado_em  := old.criado_em;
  end if;
  perform interno.exigir_mes_aberto(new.data_emissao);
  new.mes_id := interno.garantir_mes(new.data_emissao);

  if tg_op = 'INSERT' then
    if not v_srv then
      new.criado_por := auth.uid();
    end if;
    if not (v_admin or v_srv) then
      new.status := 'ativa';
      new.motivo_cancelamento := null;
      new.conferencia := 'pendente';
      new.conferencia_obs := null;
      new.conferida_por := null;
      new.conferida_em := null;
    end if;
    new.atualizado_em := now();
    perform interno.auditar('notas', new.id::text, 'insert', null, to_jsonb(new) - 'motivo_edicao', null);
    return new;
  end if;

  -- UPDATE ------------------------------------------------------------------
  -- Reativar nota cancelada: só admin, com motivo.
  if old.status = 'cancelada' and new.status = 'ativa' then
    if not (v_admin or v_srv) then
      raise exception 'Somente o administrador pode reativar uma nota cancelada.' using errcode = '42501';
    end if;
    if v_motivo is null then
      raise exception 'Informe o motivo para reativar a nota.' using errcode = 'P0001';
    end if;
    new.motivo_cancelamento := null;
  end if;

  -- Conferência: só admin.
  if (new.conferencia, new.conferencia_obs) is distinct from (old.conferencia, old.conferencia_obs) then
    if not (v_admin or v_srv) then
      raise exception 'Somente o administrador pode alterar a conferência.' using errcode = '42501';
    end if;
    if new.conferencia = 'pendente' then
      new.conferida_por := null;  new.conferida_em := null;
    else
      new.conferida_por := auth.uid();  new.conferida_em := now();
    end if;
  else
    new.conferida_por := old.conferida_por;
    new.conferida_em  := old.conferida_em;
  end if;

  -- Edição de campos de negócio: exige motivo e devolve a nota para "pendente".
  v_negocio := (new.data_emissao, new.fornecedor_id, new.categoria_id, new.tipo, new.numero, new.valor,
                new.vencimento, new.forma_pagamento, new.descricao, new.observacao, new.foto_path)
       is distinct from
               (old.data_emissao, old.fornecedor_id, old.categoria_id, old.tipo, old.numero, old.valor,
                old.vencimento, old.forma_pagamento, old.descricao, old.observacao, old.foto_path);
  if v_negocio then
    if v_motivo is null and not v_srv then
      raise exception 'Informe o motivo da edição.' using errcode = 'P0001';
    end if;
    if old.conferencia <> 'pendente' and new.conferencia = old.conferencia then
      new.conferencia := 'pendente';  new.conferencia_obs := null;
      new.conferida_por := null;      new.conferida_em := null;
    end if;
  end if;

  new.atualizado_em := now();

  v_acao := case when old.status = 'ativa' and new.status = 'cancelada' then 'cancel' else 'update' end;
  perform interno.auditar(
    'notas', new.id::text, v_acao,
    to_jsonb(old) - 'motivo_edicao', to_jsonb(new) - 'motivo_edicao',
    case when v_acao = 'cancel' then new.motivo_cancelamento else v_motivo end
  );
  return new;
end $$;

create or replace function interno.tg_notas_sem_delete()
returns trigger language plpgsql as $$
begin
  raise exception 'Notas não podem ser apagadas. Cancele a nota informando o motivo.' using errcode = '42501';
end $$;

create trigger notas_antes
  before insert or update on public.notas
  for each row execute function interno.tg_notas_antes();

create trigger notas_sem_delete
  before delete on public.notas
  for each row execute function interno.tg_notas_sem_delete();

-- -----------------------------------------------------------------------------
-- VENDAS / FECHAMENTO DE TURNO
-- -----------------------------------------------------------------------------
create or replace function interno.tg_bloqueio_por_data()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform interno.exigir_mes_aberto(old.data);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform interno.exigir_mes_aberto(new.data);
    perform interno.garantir_mes(new.data);
    return new;
  end if;
  return old;
end $$;

create trigger vendas_turno_mes_aberto
  before insert or update or delete on public.vendas_turno
  for each row execute function interno.tg_bloqueio_por_data();

create trigger vendas_turno_atualizado_em
  before update on public.vendas_turno
  for each row execute function interno.tg_atualizado_em();

create trigger fechamento_turno_mes_aberto
  before insert or update or delete on public.fechamento_turno
  for each row execute function interno.tg_bloqueio_por_data();

-- -----------------------------------------------------------------------------
-- CONTAGENS
-- -----------------------------------------------------------------------------
create or replace function interno.tg_contagens_mes_aberto()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform interno.exigir_mes_aberto_id(old.mes_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform interno.exigir_mes_aberto_id(new.mes_id);
    if tg_op = 'INSERT' and not interno.eh_servico() then
      new.realizada_por := auth.uid();
    end if;
    return new;
  end if;
  return old;
end $$;

create trigger contagens_mes_aberto
  before insert or update or delete on public.contagens
  for each row execute function interno.tg_contagens_mes_aberto();

create or replace function interno.tg_contagem_itens_mes_aberto()
returns trigger language plpgsql set search_path = '' as $$
declare v_mes uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select mes_id into v_mes from public.contagens where id = old.contagem_id;
    perform interno.exigir_mes_aberto_id(v_mes);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select mes_id into v_mes from public.contagens where id = new.contagem_id;
    perform interno.exigir_mes_aberto_id(v_mes);
    return new;
  end if;
  return old;
end $$;

create trigger contagem_itens_mes_aberto
  before insert or update or delete on public.contagem_itens
  for each row execute function interno.tg_contagem_itens_mes_aberto();

-- -----------------------------------------------------------------------------
-- MESES: status só muda via fechar_mes/reabrir_mes; mês fechado é imutável.
-- -----------------------------------------------------------------------------
create or replace function interno.tg_meses()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Meses não podem ser apagados.' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if coalesce(current_setting('cmv.permitir_status', true), '') <> 'on' then
      raise exception 'Use as funções fechar_mes / reabrir_mes para mudar o status do mês.' using errcode = '42501';
    end if;
  elsif old.status = 'fechado' then
    raise exception 'O mês está fechado. Reabra-o para alterar a configuração.' using errcode = 'P0001', hint = 'mes_fechado';
  else
    perform interno.auditar('meses', new.id::text, 'update', to_jsonb(old), to_jsonb(new), null);
  end if;
  return new;
end $$;

create trigger meses_regras
  before update or delete on public.meses
  for each row execute function interno.tg_meses();

create or replace function public.fechar_mes(p_mes_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_antes jsonb; v_depois jsonb;
begin
  if not (interno.eh_admin() or interno.eh_servico()) then
    raise exception 'Somente o administrador pode fechar o mês.' using errcode = '42501';
  end if;
  select to_jsonb(m) into v_antes from public.meses m where id = p_mes_id and status = 'aberto' for update;
  if v_antes is null then
    raise exception 'Mês inexistente ou já fechado.' using errcode = 'P0001';
  end if;
  perform set_config('cmv.permitir_status', 'on', true);
  update public.meses set status = 'fechado', fechado_por = auth.uid(), fechado_em = now()
   where id = p_mes_id returning to_jsonb(meses.*) into v_depois;
  perform set_config('cmv.permitir_status', 'off', true);
  perform interno.auditar('meses', p_mes_id::text, 'close', v_antes, v_depois, null);
end $$;

create or replace function public.reabrir_mes(p_mes_id uuid, p_motivo text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_antes jsonb; v_depois jsonb;
begin
  if not (interno.eh_admin() or interno.eh_servico()) then
    raise exception 'Somente o administrador pode reabrir o mês.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_motivo, ''))) = 0 then
    raise exception 'Informe o motivo para reabrir o mês.' using errcode = 'P0001';
  end if;
  select to_jsonb(m) into v_antes from public.meses m where id = p_mes_id and status = 'fechado' for update;
  if v_antes is null then
    raise exception 'Mês inexistente ou já aberto.' using errcode = 'P0001';
  end if;
  perform set_config('cmv.permitir_status', 'on', true);
  update public.meses set status = 'aberto', fechado_por = null, fechado_em = null
   where id = p_mes_id returning to_jsonb(meses.*) into v_depois;
  perform set_config('cmv.permitir_status', 'off', true);
  perform interno.auditar('meses', p_mes_id::text, 'reopen', v_antes, v_depois, p_motivo);
end $$;

-- -----------------------------------------------------------------------------
-- Privilégios das funções
-- -----------------------------------------------------------------------------
revoke all on schema interno from public;
grant usage on schema interno to authenticated, service_role;
revoke execute on all functions in schema interno from public;
grant execute on all functions in schema interno to authenticated, service_role;

revoke execute on function public.fechar_mes(uuid) from public, anon;
revoke execute on function public.reabrir_mes(uuid, text) from public, anon;
grant execute on function public.fechar_mes(uuid) to authenticated, service_role;
grant execute on function public.reabrir_mes(uuid, text) to authenticated, service_role;

-- Auditoria: ninguém altera nem apaga (além do trigger, sem privilégio).
revoke update, delete, truncate on public.auditoria from authenticated, service_role;

-- -----------------------------------------------------------------------------
-- POLÍTICAS RLS
-- (select interno.fn()) => avaliada uma vez por consulta (initplan).
-- -----------------------------------------------------------------------------

-- perfis: membro lê todos; cada um lê o próprio (mesmo inativo); só admin escreve.
create policy perfis_select on public.perfis for select to authenticated
  using ((select interno.eh_membro()) or id = (select auth.uid()));
create policy perfis_admin on public.perfis for all to authenticated
  using ((select interno.eh_admin())) with check ((select interno.eh_admin()));

-- Leitura do módulo: qualquer membro ativo.
create policy categorias_select       on public.categorias_cmv   for select to authenticated using ((select interno.eh_membro()));
create policy fornecedores_select     on public.fornecedores     for select to authenticated using ((select interno.eh_membro()));
create policy meses_select            on public.meses            for select to authenticated using ((select interno.eh_membro()));
create policy pesos_select            on public.pesos_dia_semana for select to authenticated using ((select interno.eh_membro()));
create policy regua_select            on public.regua_cmv        for select to authenticated using ((select interno.eh_membro()));
create policy notas_select            on public.notas            for select to authenticated using ((select interno.eh_membro()));
create policy vendas_select           on public.vendas_turno     for select to authenticated using ((select interno.eh_membro()));
create policy fechamento_select       on public.fechamento_turno for select to authenticated using ((select interno.eh_membro()));
create policy itens_contagem_select   on public.itens_contagem   for select to authenticated using ((select interno.eh_membro()));
create policy contagens_select        on public.contagens        for select to authenticated using ((select interno.eh_membro()));
create policy contagem_itens_select   on public.contagem_itens   for select to authenticated using ((select interno.eh_membro()));
create policy auditoria_select        on public.auditoria        for select to authenticated using ((select interno.eh_membro()));
create policy historico_select        on public.historico_mensal for select to authenticated using ((select interno.eh_membro()));

-- Configuração: só admin escreve.
create policy categorias_admin      on public.categorias_cmv   for all to authenticated using ((select interno.eh_admin())) with check ((select interno.eh_admin()));
create policy fornecedores_admin    on public.fornecedores     for all to authenticated using ((select interno.eh_admin())) with check ((select interno.eh_admin()));
create policy meses_admin           on public.meses            for all to authenticated using ((select interno.eh_admin())) with check ((select interno.eh_admin()));
create policy pesos_admin           on public.pesos_dia_semana for all to authenticated using ((select interno.eh_admin())) with check ((select interno.eh_admin()));
create policy regua_admin           on public.regua_cmv        for all to authenticated using ((select interno.eh_admin())) with check ((select interno.eh_admin()));
create policy itens_contagem_admin  on public.itens_contagem   for all to authenticated using ((select interno.eh_admin())) with check ((select interno.eh_admin()));
create policy historico_admin       on public.historico_mensal for all to authenticated using ((select interno.eh_admin())) with check ((select interno.eh_admin()));
create policy fechamento_admin      on public.fechamento_turno for all to authenticated using ((select interno.eh_admin())) with check ((select interno.eh_admin()));

-- Notas: membro insere e edita (mês aberto e regras de conferência via trigger). Sem DELETE.
create policy notas_insert on public.notas for insert to authenticated
  with check ((select interno.eh_membro()));
create policy notas_update on public.notas for update to authenticated
  using ((select interno.eh_membro())) with check ((select interno.eh_membro()));

-- Vendas: gestor só mexe em lançamentos manuais; admin em tudo; só admin apaga.
create policy vendas_insert on public.vendas_turno for insert to authenticated
  with check ((select interno.eh_admin()) or ((select interno.eh_membro()) and fonte = 'manual'));
create policy vendas_update on public.vendas_turno for update to authenticated
  using ((select interno.eh_admin()) or ((select interno.eh_membro()) and fonte = 'manual'))
  with check ((select interno.eh_admin()) or ((select interno.eh_membro()) and fonte = 'manual'));
create policy vendas_delete on public.vendas_turno for delete to authenticated
  using ((select interno.eh_admin()));

-- Contagens: membro registra; só admin apaga a contagem inteira.
create policy contagens_insert on public.contagens for insert to authenticated with check ((select interno.eh_membro()));
create policy contagens_update on public.contagens for update to authenticated
  using ((select interno.eh_membro())) with check ((select interno.eh_membro()));
create policy contagens_delete on public.contagens for delete to authenticated using ((select interno.eh_admin()));

create policy contagem_itens_insert on public.contagem_itens for insert to authenticated with check ((select interno.eh_membro()));
create policy contagem_itens_update on public.contagem_itens for update to authenticated
  using ((select interno.eh_membro())) with check ((select interno.eh_membro()));
create policy contagem_itens_delete on public.contagem_itens for delete to authenticated using ((select interno.eh_membro()));
