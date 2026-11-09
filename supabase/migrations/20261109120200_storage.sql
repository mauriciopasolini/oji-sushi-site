-- =============================================================================
-- Módulo CMV · 0003 · Storage: bucket privado "notas"
-- Caminho: AAAA/MM/<nota_id>.<ext>   (ext: jpg, jpeg, png, webp, pdf)
-- Exibição sempre por URL assinada de curta duração. Sem DELETE (nota nunca é apagada).
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('notas', 'notas', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Caminho no formato esperado e mês da pasta não fechado.
create or replace function interno.caminho_nota_gravavel(p_nome text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare m text[];
begin
  m := regexp_match(p_nome, '^(\d{4})/(0[1-9]|1[0-2])/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|pdf)$');
  if m is null then
    return false;
  end if;
  return not interno.mes_fechado_em(make_date(m[1]::int, m[2]::int, 1));
end $$;

revoke execute on function interno.caminho_nota_gravavel(text) from public;
grant execute on function interno.caminho_nota_gravavel(text) to authenticated, service_role;

create policy notas_fotos_select on storage.objects for select to authenticated
  using (bucket_id = 'notas' and (select interno.eh_membro()));

create policy notas_fotos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'notas' and (select interno.eh_membro()) and interno.caminho_nota_gravavel(name));

-- UPDATE permite substituir a foto (upsert) enquanto o mês estiver aberto.
create policy notas_fotos_update on storage.objects for update to authenticated
  using (bucket_id = 'notas' and (select interno.eh_membro()) and interno.caminho_nota_gravavel(name))
  with check (bucket_id = 'notas' and (select interno.eh_membro()) and interno.caminho_nota_gravavel(name));
