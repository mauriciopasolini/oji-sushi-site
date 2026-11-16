-- =============================================================================
-- Contagem de estoque: a DATA da contagem fica separada do MÊS DE FECHAMENTO
-- a que ela pertence ("Fechamento de"). Decisão 109.
--
-- contagens.mes_id já era o mês de fechamento (o estoque final de um mês é a
-- contagem finalizada com mes_id = esse mês). O que muda:
--   * padrão: o mês da data; nos dias 1 e 2, o mês anterior (contagem que passou
--     da meia-noite ou foi finalizada na manhã seguinte);
--   * o fechamento tem de ser o mês da data ou o anterior (para todos);
--   * fora do padrão, só o admin (ou o servidor);
--   * mes_id pode mudar enquanto a contagem é rascunho (antes era travado),
--     com auditoria 'update'. Finalizada continua imutável.
-- Aditiva: não há contagens gravadas quando ela é aplicada.
-- =============================================================================

create or replace function interno.fechamento_padrao(p_data date)
returns date language sql immutable set search_path = '' as $$
  select case
    when extract(day from p_data) <= 2 then (date_trunc('month', p_data) - interval '1 month')::date
    else date_trunc('month', p_data)::date
  end
$$;

revoke execute on function interno.fechamento_padrao(date) from public;
grant execute on function interno.fechamento_padrao(date) to authenticated, service_role;

-- Valida o par (mês de fechamento, data). Roda como quem chamou (não é security
-- definer) para enxergar o papel real; meses é legível para membros.
create or replace function interno.validar_fechamento_contagem(p_mes_id uuid, p_data date)
returns void language plpgsql stable set search_path = '' as $$
declare
  v_comp   date;
  v_mes    date := date_trunc('month', p_data)::date;
  v_ant    date := (date_trunc('month', p_data) - interval '1 month')::date;
  v_padrao date := interno.fechamento_padrao(p_data);
begin
  select competencia into v_comp from public.meses where id = p_mes_id;
  if v_comp is null then
    raise exception 'Mês de fechamento não encontrado.' using errcode = 'P0001';
  end if;
  if v_comp <> v_mes and v_comp <> v_ant then
    raise exception 'Uma contagem feita em % só pode ser o fechamento de % ou de %.',
      to_char(p_data, 'DD/MM/YYYY'), to_char(v_ant, 'MM/YYYY'), to_char(v_mes, 'MM/YYYY')
      using errcode = 'P0001', hint = 'fechamento_invalido';
  end if;
  if v_comp <> v_padrao and not (interno.eh_admin() or interno.eh_servico()) then
    raise exception 'Pela data (%), esta contagem é o fechamento de %. Só o administrador pode escolher outro mês.',
      to_char(p_data, 'DD/MM/YYYY'), to_char(v_padrao, 'MM/YYYY')
      using errcode = 'P0001', hint = 'fechamento_so_admin';
  end if;
end $$;

revoke execute on function interno.validar_fechamento_contagem(uuid, date) from public;
grant execute on function interno.validar_fechamento_contagem(uuid, date) to authenticated, service_role;

-- Mesma função da decisão 97, com a validação do fechamento e mes_id editável no rascunho.
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
    perform interno.validar_fechamento_contagem(new.mes_id, new.data);
    new.status := 'rascunho';
    new.finalizada_por := null;
    new.finalizada_em := null;
    new.atualizado_em := now();
    perform interno.auditar('contagens', new.id::text, 'insert', null, to_jsonb(new), null);
    return new;
  end if;

  -- UPDATE
  new.tipo := old.tipo;
  new.realizada_por := old.realizada_por;
  new.criado_em := old.criado_em;

  if old.status = 'finalizada' then
    -- Finalizada: nada muda (inclusive data e mês de fechamento), salvo a reabertura.
    if new.status = 'rascunho' and v_reabrir then
      new.mes_id := old.mes_id;
      new.data := old.data;
      new.finalizada_por := null;
      new.finalizada_em := null;
    elsif (to_jsonb(new) - 'atualizado_em') is distinct from (to_jsonb(old) - 'atualizado_em') then
      raise exception 'A contagem já foi finalizada. Peça ao administrador para reabri-la.' using errcode = 'P0001', hint = 'contagem_finalizada';
    end if;
  else
    if new.data is distinct from old.data or new.mes_id is distinct from old.mes_id then
      perform interno.validar_fechamento_contagem(new.mes_id, new.data);
    end if;
    if new.status = 'finalizada' then
      if not exists (select 1 from public.contagem_itens i where i.contagem_id = new.id) then
        raise exception 'A contagem não tem nenhum item.' using errcode = 'P0001';
      end if;
      new.finalizada_por := auth.uid();
      new.finalizada_em := now();
    else
      new.finalizada_por := null;
      new.finalizada_em := null;
    end if;
  end if;
  new.atualizado_em := now();

  if new.mes_id is distinct from old.mes_id then
    perform interno.auditar('contagens', new.id::text, 'update',
      jsonb_build_object('mes_id', old.mes_id, 'data', old.data),
      jsonb_build_object('mes_id', new.mes_id, 'data', new.data),
      'mês de fechamento alterado');
  end if;

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
