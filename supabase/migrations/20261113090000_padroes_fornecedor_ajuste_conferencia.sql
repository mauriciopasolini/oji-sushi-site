-- =============================================================================
-- Módulo CMV · 0010 · Padrões por fornecedor e ajuste na conferência
--
-- * fornecedores.tipo_padrao / forma_pagamento_padrao: preenchem o lançamento
--   (editáveis). Nulos = regra antiga (NF-e; boleto com prazo, caixa sem prazo).
-- * ajustar_nota_conferencia(): o admin corrige tipo e forma de pagamento na
--   tela de conferência, sem a edição completa; auditado com o motivo
--   "ajuste na conferência" e sem devolver a nota para "pendente".
-- * A flag de sessão que preserva a conferência passa a se chamar
--   cmv.manter_conferencia (usada pela mescla e pelo ajuste).
-- Migração apenas aditiva: o banco é compartilhado com a produção.
-- =============================================================================

alter table public.fornecedores
  add column tipo_padrao text check (tipo_padrao is null or tipo_padrao in ('nfe', 'cupom', 'comanda', 'outro')),
  add column forma_pagamento_padrao text check (forma_pagamento_padrao is null or forma_pagamento_padrao in ('boleto', 'caixa', 'pix', 'outro'));

-- Seeds (pedido do Mauricio). FEMSA: só o tipo; a forma segue a regra do prazo.
update public.fornecedores set tipo_padrao = 'nfe', forma_pagamento_padrao = 'boleto' where nome = 'Frumar';
update public.fornecedores set tipo_padrao = 'nfe' where nome = 'FEMSA';
update public.fornecedores set tipo_padrao = 'comanda' where nome = 'Fruteira';
update public.fornecedores set tipo_padrao = 'cupom' where nome = 'Mercado';

-- Gestor que cadastra fornecedor no lançamento não define padrões (o admin revisa).
create or replace function interno.tg_fornecedores()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_priv boolean := interno.eh_admin() or interno.eh_servico();
begin
  new.nome := btrim(regexp_replace(new.nome, '\s+', ' ', 'g'));

  if tg_op = 'INSERT' then
    if v_priv then
      new.criado_por   := coalesce(auth.uid(), new.criado_por);
      new.revisado_em  := coalesce(new.revisado_em, now());
      new.revisado_por := coalesce(new.revisado_por, auth.uid());
    else
      -- Gestor: só nome + categoria; o resto fica para o admin revisar.
      new.criado_por := auth.uid();
      new.ativo := true;
      new.cnpj := null;
      new.prazo_vencimento_dias := null;
      new.tipo_padrao := null;
      new.forma_pagamento_padrao := null;
      new.revisado_em := null;
      new.revisado_por := null;
    end if;
    perform interno.auditar('fornecedores', new.id::text, 'insert', null, to_jsonb(new),
      case when v_priv then null else 'criado pelo gestor no lançamento de nota' end);
  else
    new.criado_por := old.criado_por;
    perform interno.auditar('fornecedores', new.id::text, 'update', to_jsonb(old), to_jsonb(new), null);
  end if;
  return new;
end $$;

-- Notas: igual à 0009, com a flag renomeada.
create or replace function interno.tg_notas_antes()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_admin   boolean := interno.eh_admin();
  v_srv     boolean := interno.eh_servico();
  v_motivo  text    := nullif(trim(new.motivo_edicao), '');
  v_manter_conf boolean := coalesce(current_setting('cmv.manter_conferencia', true), '') = 'on';
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
    if old.conferencia <> 'pendente' and new.conferencia = old.conferencia and not v_manter_conf then
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

  perform set_config('cmv.manter_conferencia', 'on', true);
  update public.notas
     set fornecedor_id = p_manter,
         motivo_edicao = format('Mescla de fornecedores: "%s" → "%s"', v_remover.nome, v_manter.nome)
   where fornecedor_id = p_remover
     and not interno.mes_fechado_em(data_emissao);
  get diagnostics v_movidas = row_count;
  perform set_config('cmv.manter_conferencia', 'off', true);

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

create or replace function public.ajustar_nota_conferencia(p_nota_id uuid, p_tipo text, p_forma_pagamento text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_nota public.notas;
begin
  if not (interno.eh_admin() or interno.eh_servico()) then
    raise exception 'Somente o administrador ajusta notas na conferência.' using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('nfe', 'cupom', 'comanda', 'outro', 'sem_nota') then
    raise exception 'Tipo de documento inválido.' using errcode = 'P0001';
  end if;
  if p_forma_pagamento is null or p_forma_pagamento not in ('boleto', 'caixa', 'pix', 'outro') then
    raise exception 'Forma de pagamento inválida.' using errcode = 'P0001';
  end if;
  select * into v_nota from public.notas where id = p_nota_id for update;
  if v_nota.id is null or v_nota.status <> 'ativa' then
    raise exception 'Nota não encontrada ou cancelada.' using errcode = 'P0001';
  end if;
  -- Entrar ou sair de "sem nota" tem regras próprias (foto, número, observação): edição completa.
  if (v_nota.tipo = 'sem_nota') <> (p_tipo = 'sem_nota') then
    raise exception 'Compra sem nota fiscal: use a edição da nota ("A nota fiscal chegou").' using errcode = 'P0001';
  end if;
  if (v_nota.tipo, v_nota.forma_pagamento) = (p_tipo, p_forma_pagamento) then
    return;
  end if;
  perform set_config('cmv.manter_conferencia', 'on', true);
  update public.notas
     set tipo = p_tipo, forma_pagamento = p_forma_pagamento, motivo_edicao = 'ajuste na conferência'
   where id = p_nota_id;
  perform set_config('cmv.manter_conferencia', 'off', true);
end $$;

revoke execute on function public.ajustar_nota_conferencia(uuid, text, text) from public, anon;
grant execute on function public.ajustar_nota_conferencia(uuid, text, text) to authenticated, service_role;
