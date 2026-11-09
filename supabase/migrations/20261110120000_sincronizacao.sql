-- =============================================================================
-- Módulo CMV · 0007 · Sincronização com a planilha de fechamento de caixa
-- =============================================================================

-- Registro de cada execução (botão, automática ao abrir o painel, cron).
create table public.sincronizacoes (
  id            uuid primary key default gen_random_uuid(),
  competencia   date not null check (extract(day from competencia) = 1),
  gatilho       text not null check (gatilho in ('manual', 'automatica', 'cron')),
  status        text not null default 'executando' check (status in ('executando', 'ok', 'erro', 'ignorada')),
  iniciado_em   timestamptz not null default now(),
  concluido_em  timestamptz,
  usuario_id    uuid references public.perfis (id),
  -- dias lidos, linhas gravadas, abas faltando/vazias, divergências, conflitos, avisos
  resumo        jsonb,
  erro          text
);
create index sincronizacoes_competencia_idx on public.sincronizacoes (competencia, iniciado_em desc);

-- Venda manual que diverge da planilha: NUNCA é sobrescrita nem ignorada em silêncio.
-- Fica pendente até o admin escolher manter a manual ou usar a planilha.
create table public.conflitos_venda (
  id                 uuid primary key default gen_random_uuid(),
  data               date not null,
  turno              smallint not null check (turno in (1, 2)),
  origem             text not null check (origem in ('restaurante', 'oji_tele', 'shakai_tele', 'wabi_tele')),
  valores_manual     jsonb not null,
  valores_planilha   jsonb not null,
  total_manual       numeric(12,2) not null,
  total_planilha     numeric(12,2) not null,
  -- impressão digital dos valores da planilha: se a planilha mudar depois de uma
  -- decisão "manter manual", o conflito reaparece
  assinatura_planilha text not null,
  detectado_em       timestamptz not null default now(),
  resolucao          text check (resolucao in ('manter_manual', 'usar_planilha')),
  resolvido_por      uuid references public.perfis (id),
  resolvido_em       timestamptz,
  constraint conflitos_resolucao_coerente check ((resolucao is null) = (resolvido_em is null))
);
create unique index conflitos_venda_pendente_uk on public.conflitos_venda (data, turno, origem) where resolucao is null;
create index conflitos_venda_data_idx on public.conflitos_venda (data);

alter table public.sincronizacoes  enable row level security;
alter table public.conflitos_venda enable row level security;
revoke all on public.sincronizacoes, public.conflitos_venda from anon;

-- Leitura para membros. Escrita: a sincronização usa a secret key (service_role);
-- a resolução de conflito é feita pelo admin.
create policy sincronizacoes_select on public.sincronizacoes for select to authenticated using ((select interno.eh_membro()));
create policy conflitos_select on public.conflitos_venda for select to authenticated using ((select interno.eh_membro()));
create policy conflitos_resolver on public.conflitos_venda for update to authenticated
  using ((select interno.eh_admin())) with check ((select interno.eh_admin()));

-- Resolver conflito só com mês aberto (a resolução pode reescrever a venda).
create or replace function interno.tg_conflitos_mes_aberto()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform interno.exigir_mes_aberto(new.data);
  if tg_op = 'UPDATE' and new.resolucao is not null and old.resolucao is null then
    new.resolvido_em := now();
    new.resolvido_por := coalesce(auth.uid(), new.resolvido_por);
    perform interno.auditar('conflitos_venda', new.id::text, 'update', to_jsonb(old), to_jsonb(new), new.resolucao);
  end if;
  return new;
end $$;
revoke execute on function interno.tg_conflitos_mes_aberto() from public;

create trigger conflitos_mes_aberto
  before insert or update on public.conflitos_venda
  for each row execute function interno.tg_conflitos_mes_aberto();
