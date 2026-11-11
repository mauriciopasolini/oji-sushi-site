-- =============================================================================
-- Módulo CMV · 0009 · Etapa 6: mescla de fornecedores e contagem de estoque
--
-- * Mesclar fornecedores (só admin, RPC auditada): as notas do duplicado em
--   meses ABERTOS passam para o fornecedor que fica, sem perder a conferência;
--   as de meses fechados continuam como estão (o mês fechado é imutável) e o
--   duplicado fica desativado, apontando para o principal (mesclado_em_id).
-- * Contagem de estoque: rascunho → finalizada. Finalizada não aceita mudança
--   (nem nos itens); só o admin reabre, com motivo (auditado).
-- Migração apenas aditiva: o banco é compartilhado com a produção.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Auditoria: novas ações
-- -----------------------------------------------------------------------------
alter table public.auditoria drop constraint auditoria_acao_check;
alter table public.auditoria add constraint auditoria_acao_check
  check (acao in ('insert', 'update', 'cancel', 'reopen', 'close', 'merge', 'finalize', 'delete'));

-- -----------------------------------------------------------------------------
-- FORNECEDORES: mescla
-- -----------------------------------------------------------------------------
alter table public.fornecedores
  add column mesclado_em_id uuid references public.fornecedores (id),
  add column mesclado_em    timestamptz,
  add constraint fornecedores_mescla_coerente check (
    (mesclado_em_id is null and mesclado_em is null) or
    (mesclado_em_id is not null and mesclado_em is not null and mesclado_em_id <> id and not ativo)
  );

-- Notas: igual à versão anterior, exceto que a troca de fornecedor feita pela
-- mescla (flag de sessão cmv.mescla_fornecedor, só ligada dentro da RPC) não
-- devolve a nota para "pendente".
create or replace function interno.tg_notas_antes()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_admin   boolean := interno.eh_admin();
  v_srv     boolean := interno.eh_servico();
  v_motivo  text    := nullif(trim(new.motivo_edicao), '');
  v_mescla  boolean := coalesce(current_setting('cmv.mescla_fornecedor', true), '') = 'on';
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
  if old.status = 'cancelada' and new.status = 'ativa' then
    if not (v_admin or v_srv) then
      raise exception 'Somente o administrador pode reativar uma nota cancelada.' using errcode = '42501';
    end if;
    if v_motivo is null then
      raise exception 'Informe o motivo para reativar a nota.' using errcode = 'P0001';
    end if;
    new.motivo_cancelamento := null;
  end if;

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

  v_negocio := (new.data_emissao, new.fornecedor_id, new.categoria_id, new.tipo, new.numero, new.valor,
                new.vencimento, new.forma_pagamento, new.descricao, new.observacao, new.foto_path)
       is distinct from
               (old.data_emissao, old.fornecedor_id, old.categoria_id, old.tipo, old.numero, old.valor,
                old.vencimento, old.forma_pagamento, old.descricao, old.observacao, old.foto_path);
  if v_negocio then
    if v_motivo is null and not v_srv then
      raise exception 'Informe o motivo da edição.' using errcode = 'P0001';
    end if;
    if old.conferencia <> 'pendente' and new.conferencia = old.conferencia and not v_mescla then
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

create or replace function public.mesclar_fornecedores(p_manter uuid, p_remover uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_manter  public.fornecedores;
  v_remover public.fornecedores;
  v_movidas int;
  v_fechadas int;
begin
  if not (interno.eh_admin() or interno.eh_servico()) then
    raise exception 'Somente o administrador pode mesclar fornecedores.' using errcode = '42501';
  end if;
  if p_manter is null or p_remover is null or p_manter = p_remover then
    raise exception 'Escolha dois fornecedores diferentes.' using errcode = 'P0001';
  end if;

  -- Trava os dois na mesma ordem (evita deadlock entre mesclas simultâneas).
  perform 1 from public.fornecedores where id in (p_manter, p_remover) order by id for update;
  select * into v_manter  from public.fornecedores where id = p_manter;
  select * into v_remover from public.fornecedores where id = p_remover;
  if v_manter.id is null or v_remover.id is null then
    raise exception 'Fornecedor inexistente.' using errcode = 'P0001';
  end if;
  if v_remover.mesclado_em_id is not null then
    raise exception 'O fornecedor "%" já foi mesclado.', v_remover.nome using errcode = 'P0001';
  end if;
  if v_manter.mesclado_em_id is not null or not v_manter.ativo then
    raise exception 'O fornecedor que fica ("%") precisa estar ativo.', v_manter.nome using errcode = 'P0001';
  end if;

  perform set_config('cmv.mescla_fornecedor', 'on', true);
  update public.notas
     set fornecedor_id = p_manter,
         motivo_edicao = format('Mescla de fornecedores: "%s" → "%s"', v_remover.nome, v_manter.nome)
   where fornecedor_id = p_remover
     and not interno.mes_fechado_em(data_emissao);
  get diagnostics v_movidas = row_count;
  perform set_config('cmv.mescla_fornecedor', 'off', true);

  select count(*) into v_fechadas from public.notas where fornecedor_id = p_remover;

  update public.fornecedores
     set ativo = false,
         mesclado_em_id = p_manter,
         mesclado_em = now(),
         revisado_em = coalesce(revisado_em, now()),
         revisado_por = coalesce(revisado_por, auth.uid())
   where id = p_remover;

  perform interno.auditar(
    'fornecedores', p_remover::text, 'merge',
    jsonb_build_object('removido', to_jsonb(v_remover), 'mantido', to_jsonb(v_manter)),
    jsonb_build_object('mantido_id', p_manter, 'notas_movidas', v_movidas, 'notas_em_mes_fechado', v_fechadas),
    format('"%s" mesclado em "%s"', v_remover.nome, v_manter.nome)
  );

  return jsonb_build_object('notas_movidas', v_movidas, 'notas_em_mes_fechado', v_fechadas);
end $$;

revoke execute on function public.mesclar_fornecedores(uuid, uuid) from public, anon;
grant execute on function public.mesclar_fornecedores(uuid, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- ITENS DE CONTAGEM: nomes normalizados e auditoria
-- -----------------------------------------------------------------------------
create unique index itens_contagem_nome_normalizado_uk
  on public.itens_contagem (lower(btrim(regexp_replace(nome, '\s+', ' ', 'g'))));

create or replace function interno.tg_itens_contagem()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.nome := btrim(regexp_replace(new.nome, '\s+', ' ', 'g'));
  if length(new.nome) = 0 then
    raise exception 'Informe o nome do item.' using errcode = 'P0001';
  end if;
  perform interno.auditar('itens_contagem', new.id::text, lower(tg_op),
    case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new), null);
  return new;
end $$;

revoke execute on function interno.tg_itens_contagem() from public;
grant execute on function interno.tg_itens_contagem() to authenticated, service_role;

create trigger itens_contagem_regras
  before insert or update on public.itens_contagem
  for each row execute function interno.tg_itens_contagem();

-- -----------------------------------------------------------------------------
-- CONTAGENS: rascunho → finalizada
-- -----------------------------------------------------------------------------
alter table public.contagens
  add column status         text not null default 'rascunho' check (status in ('rascunho', 'finalizada')),
  add column finalizada_por uuid references public.perfis (id),
  add column finalizada_em  timestamptz,
  add column atualizado_em  timestamptz not null default now(),
  add constraint contagens_finalizacao_coerente check (
    (status = 'rascunho' and finalizada_por is null and finalizada_em is null) or
    (status = 'finalizada' and finalizada_em is not null)
  );

-- Roda depois de contagens_mes_aberto (ordem alfabética dos triggers).
create or replace function interno.tg_contagens_regras()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_reabrir boolean := coalesce(current_setting('cmv.reabrir_contagem', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    if old.status = 'finalizada' then
      raise exception 'Contagem finalizada não pode ser apagada.' using errcode = 'P0001';
    end if;
    perform interno.auditar('contagens', old.id::text, 'delete', to_jsonb(old), null, null);
    return old;
  end if;

  if new.data > (now() at time zone 'America/Sao_Paulo')::date
     and (tg_op = 'INSERT' or new.data is distinct from old.data) then
    raise exception 'A data da contagem não pode ser no futuro.' using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' then
    new.status := 'rascunho';
    new.finalizada_por := null;
    new.finalizada_em := null;
    new.atualizado_em := now();
    perform interno.auditar('contagens', new.id::text, 'insert', null, to_jsonb(new), null);
    return new;
  end if;

  -- UPDATE
  new.mes_id := old.mes_id;
  new.tipo := old.tipo;
  new.realizada_por := old.realizada_por;
  new.criado_em := old.criado_em;

  if old.status = 'finalizada' then
    if new.status = 'rascunho' and v_reabrir then
      new.finalizada_por := null;
      new.finalizada_em := null;
    elsif (to_jsonb(new) - 'atualizado_em') is distinct from (to_jsonb(old) - 'atualizado_em') then
      raise exception 'A contagem já foi finalizada. Peça ao administrador para reabri-la.' using errcode = 'P0001', hint = 'contagem_finalizada';
    end if;
  elsif new.status = 'finalizada' then
    if not exists (select 1 from public.contagem_itens i where i.contagem_id = new.id) then
      raise exception 'A contagem não tem nenhum item.' using errcode = 'P0001';
    end if;
    new.finalizada_por := auth.uid();
    new.finalizada_em := now();
  else
    new.finalizada_por := null;
    new.finalizada_em := null;
  end if;
  new.atualizado_em := now();

  if new.status is distinct from old.status then
    perform interno.auditar('contagens', new.id::text,
      case when new.status = 'finalizada' then 'finalize' else 'reopen' end,
      to_jsonb(old), to_jsonb(new) || jsonb_build_object(
        'total', (select coalesce(sum(i.valor), 0) from public.contagem_itens i where i.contagem_id = new.id)),
      nullif(current_setting('cmv.motivo', true), ''));
  end if;
  return new;
end $$;

revoke execute on function interno.tg_contagens_regras() from public;
grant execute on function interno.tg_contagens_regras() to authenticated, service_role;

create trigger contagens_regras
  before insert or update or delete on public.contagens
  for each row execute function interno.tg_contagens_regras();

-- Itens: nada muda numa contagem finalizada.
create or replace function interno.tg_contagem_itens_regras()
returns trigger language plpgsql set search_path = '' as $$
declare v_status text;
begin
  select status into v_status from public.contagens
   where id = case when tg_op = 'DELETE' then old.contagem_id else new.contagem_id end;
  -- No DELETE em cascata da contagem (rascunho) a linha-mãe já não aparece: segue.
  if v_status = 'finalizada' then
    raise exception 'A contagem já foi finalizada. Peça ao administrador para reabri-la.' using errcode = 'P0001', hint = 'contagem_finalizada';
  end if;
  if tg_op = 'UPDATE' and (new.contagem_id, new.item_id) is distinct from (old.contagem_id, old.item_id) then
    raise exception 'Não é possível mover o item para outra contagem.' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

revoke execute on function interno.tg_contagem_itens_regras() from public;
grant execute on function interno.tg_contagem_itens_regras() to authenticated, service_role;

create trigger contagem_itens_regras
  before insert or update or delete on public.contagem_itens
  for each row execute function interno.tg_contagem_itens_regras();

-- Só o admin reabre uma contagem finalizada, com motivo.
create or replace function public.reabrir_contagem(p_contagem_id uuid, p_motivo text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if not (interno.eh_admin() or interno.eh_servico()) then
    raise exception 'Somente o administrador pode reabrir a contagem.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_motivo, ''))) = 0 then
    raise exception 'Informe o motivo para reabrir a contagem.' using errcode = 'P0001';
  end if;
  perform set_config('cmv.reabrir_contagem', 'on', true);
  perform set_config('cmv.motivo', trim(p_motivo), true);
  update public.contagens set status = 'rascunho' where id = p_contagem_id and status = 'finalizada';
  if not found then
    raise exception 'Contagem inexistente ou não finalizada.' using errcode = 'P0001';
  end if;
  perform set_config('cmv.reabrir_contagem', 'off', true);
  perform set_config('cmv.motivo', '', true);
end $$;

revoke execute on function public.reabrir_contagem(uuid, text) from public, anon;
grant execute on function public.reabrir_contagem(uuid, text) to authenticated, service_role;

-- Contagem de fechamento finalizada de um mês (estoque final) — usada pelo painel
-- e, para o mês seguinte, como estoque inicial.
create index contagens_mes_status_idx on public.contagens (mes_id, status);
