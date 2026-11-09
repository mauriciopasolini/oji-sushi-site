-- =============================================================================
-- Módulo CMV · 0005 · Gestor cria fornecedor no lançamento + troca de senha
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Fornecedores criados pelo gestor ficam "novos" (revisado_em nulo) até o admin revisar.
-- O gestor só cria (nome + categoria). Editar, desativar e mesclar: só admin.
-- -----------------------------------------------------------------------------
alter table public.fornecedores
  add column criado_por   uuid references public.perfis (id) default auth.uid(),
  add column revisado_em  timestamptz,
  add column revisado_por uuid references public.perfis (id);

update public.fornecedores set revisado_em = now() where revisado_em is null;  -- seeds = cadastro do admin

-- Evita "Frumar" e "frumar " duplicados.
create unique index fornecedores_nome_normalizado_uk
  on public.fornecedores (lower(btrim(regexp_replace(nome, '\s+', ' ', 'g'))));

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

revoke execute on function interno.tg_fornecedores() from public;

create trigger fornecedores_regras
  before insert or update on public.fornecedores
  for each row execute function interno.tg_fornecedores();

create policy fornecedores_insert_membro on public.fornecedores for insert to authenticated
  with check ((select interno.eh_membro()));

-- -----------------------------------------------------------------------------
-- Troca de senha obrigatória no primeiro acesso
-- -----------------------------------------------------------------------------
alter table public.perfis add column deve_trocar_senha boolean not null default false;

-- O próprio usuário confirma que trocou a senha (não pode mexer em mais nada do perfil).
create or replace function public.confirmar_troca_senha()
returns void language sql volatile security definer set search_path = '' as $$
  update public.perfis set deve_trocar_senha = false where id = (select auth.uid())
$$;

revoke execute on function public.confirmar_troca_senha() from public, anon;
grant execute on function public.confirmar_troca_senha() to authenticated;
