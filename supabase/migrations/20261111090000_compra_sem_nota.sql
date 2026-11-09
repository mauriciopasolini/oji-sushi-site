-- =============================================================================
-- Módulo CMV · 0008 · Mercadoria que chega sem nota fiscal
-- Tipo "sem_nota" (aguardando a nota fiscal): entra no orçamento pela data de
-- chegada como qualquer nota ativa. Foto obrigatória (romaneio, pedido, recibo
-- ou a mercadoria) e observação obrigatória. Quando a nota chega, a mesma
-- entrada é editada (com motivo; a foto antiga fica na auditoria e no bucket).
-- O fechamento do mês exige zero pendentes ou uma justificativa por pendente.
-- =============================================================================

alter table public.notas drop constraint notas_tipo_check;
alter table public.notas add constraint notas_tipo_check
  check (tipo in ('nfe', 'cupom', 'comanda', 'outro', 'sem_nota'));

alter table public.notas add constraint notas_sem_nota_com_observacao
  check (tipo <> 'sem_nota' or length(trim(coalesce(observacao, ''))) > 0);

-- Justificativa do administrador para fechar o mês com a compra ainda sem nota.
alter table public.notas add column pendencia_justificativa text;

create index notas_sem_nota_idx on public.notas (data_emissao) where tipo = 'sem_nota' and status = 'ativa';

create or replace function interno.tg_notas_sem_nota()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.pendencia_justificativa is not null and not (interno.eh_admin() or interno.eh_servico()) then
      raise exception 'Somente o administrador pode justificar uma compra sem nota.' using errcode = '42501';
    end if;
  else
    if new.pendencia_justificativa is distinct from old.pendencia_justificativa
       and not (interno.eh_admin() or interno.eh_servico()) then
      raise exception 'Somente o administrador pode justificar uma compra sem nota.' using errcode = '42501';
    end if;
  end if;
  -- Saiu de "sem nota" (a nota fiscal chegou): a justificativa perde o sentido.
  if new.tipo <> 'sem_nota' then
    new.pendencia_justificativa := null;
  else
    new.pendencia_justificativa := nullif(trim(new.pendencia_justificativa), '');
  end if;
  return new;
end $$;

revoke execute on function interno.tg_notas_sem_nota() from public;
grant execute on function interno.tg_notas_sem_nota() to authenticated, service_role;

-- "0" para rodar antes de notas_antes (a auditoria registra o valor final).
create trigger notas_0_sem_nota
  before insert or update on public.notas
  for each row execute function interno.tg_notas_sem_nota();

-- fechar_mes: igual à versão anterior + checagem das compras sem nota.
create or replace function public.fechar_mes(p_mes_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_antes jsonb; v_depois jsonb; v_pendentes int;
begin
  if not (interno.eh_admin() or interno.eh_servico()) then
    raise exception 'Somente o administrador pode fechar o mês.' using errcode = '42501';
  end if;
  select to_jsonb(m) into v_antes from public.meses m where id = p_mes_id and status = 'aberto' for update;
  if v_antes is null then
    raise exception 'Mês inexistente ou já fechado.' using errcode = 'P0001';
  end if;
  select count(*) into v_pendentes from public.notas n
   where n.mes_id = p_mes_id and n.status = 'ativa' and n.tipo = 'sem_nota' and n.pendencia_justificativa is null;
  if v_pendentes > 0 then
    raise exception 'Há % compra(s) aguardando nota fiscal sem justificativa. Lance a nota fiscal ou justifique cada pendente.', v_pendentes
      using errcode = 'P0001', hint = 'pendentes_nota_fiscal';
  end if;
  perform set_config('cmv.permitir_status', 'on', true);
  update public.meses set status = 'fechado', fechado_por = auth.uid(), fechado_em = now()
   where id = p_mes_id returning to_jsonb(meses.*) into v_depois;
  perform set_config('cmv.permitir_status', 'off', true);
  perform interno.auditar('meses', p_mes_id::text, 'close', v_antes, v_depois, null);
end $$;

revoke execute on function public.fechar_mes(uuid) from public, anon;
grant execute on function public.fechar_mes(uuid) to authenticated, service_role;
