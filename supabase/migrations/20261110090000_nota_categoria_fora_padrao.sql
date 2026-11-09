-- =============================================================================
-- Módulo CMV · 0006 · Nota com categoria diferente da padrão do fornecedor
-- A troca de categoria vale só para a nota. O banco registra, no momento do
-- lançamento/edição, se a categoria diverge da padrão do fornecedor, para a
-- tela de conferência destacar (mesmo que o padrão do fornecedor mude depois).
-- =============================================================================

alter table public.notas
  add column categoria_fora_do_padrao boolean not null default false;

create or replace function interno.tg_notas_categoria_padrao()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT'
     or new.categoria_id is distinct from old.categoria_id
     or new.fornecedor_id is distinct from old.fornecedor_id then
    new.categoria_fora_do_padrao := new.categoria_id is distinct from
      (select f.categoria_padrao_id from public.fornecedores f where f.id = new.fornecedor_id);
  else
    new.categoria_fora_do_padrao := old.categoria_fora_do_padrao;  -- não editável diretamente
  end if;
  return new;
end $$;

revoke execute on function interno.tg_notas_categoria_padrao() from public;

-- Nome com "0" para rodar ANTES de notas_antes (ordem alfabética), assim a
-- auditoria já registra o valor calculado.
create trigger notas_0_categoria_padrao
  before insert or update on public.notas
  for each row execute function interno.tg_notas_categoria_padrao();
