-- =============================================================================
-- Módulo CMV · 0004 · Dados iniciais (idempotente)
-- =============================================================================

-- Categorias: % como expressão para manter a precisão (somam exatamente 0.35).
insert into public.categorias_cmv (nome, slug, pct_meta, ordem) values
  ('Pescados e Linha Seca', 'pescados-linha-seca', 24.0 / 90, 1),
  ('Bebidas',               'bebidas',              2.0 / 90, 2),
  ('Mercado',               'mercado',              3.0 / 90, 3),
  ('Fruteira',              'fruteira',             2.5 / 90, 4)
on conflict (slug) do nothing;

insert into public.fornecedores (nome, categoria_padrao_id)
select f.nome, c.id
from (values
  ('Frumar',   'pescados-linha-seca'),
  ('FEMSA',    'bebidas'),
  ('Fruteira', 'fruteira'),
  ('Mercado',  'mercado')
) as f (nome, slug)
join public.categorias_cmv c on c.slug = f.slug
on conflict (nome) do nothing;

-- Meses com meta definida (novos meses usam o padrão de 90.000 da coluna).
insert into public.meses (competencia, meta_venda) values
  ('2026-11-01', 95000),
  ('2026-12-01', 100000)
on conflict (competencia) do nothing;

-- Pesos de venda por dia da semana (0 = domingo … 6 = sábado).
insert into public.pesos_dia_semana (dia_semana, peso) values
  (0, 3300), (1, 2700), (2, 2500), (3, 3300), (4, 2950), (5, 3700), (6, 4200)
on conflict (dia_semana) do nothing;

insert into public.regua_cmv (faixa, limite_superior_pct, cor, ordem) values
  ('Ótimo',   0.360, '#16a34a', 1),
  ('Bom',     0.375, '#65a30d', 2),
  ('Atenção', 0.390, '#d97706', 3),
  ('Crítico', null,  '#dc2626', 4)
on conflict (faixa) do nothing;

-- Histórico (carga manual). Outubro tem o CMV em R$ por categoria; o % é calculado.
insert into public.historico_mensal (competencia, venda, cmv_valor, cmv_pct, detalhe) values
  ('2026-05-01', 93821.99, null, 0.367, null),
  ('2026-06-01', 92965.26, null, 0.365, null),
  ('2026-07-01', 95596.00, null, 0.386, null),
  ('2026-08-01', 94348.31, null, 0.376, null),
  ('2026-09-01', 84413.69, null, 0.405, null),
  ('2026-10-01', 85921.54, 30223.90, round(30223.90 / 85921.54, 6),
     '{"pescados-linha-seca": 22917.59, "bebidas": 2172.06, "mercado": 2917.87, "fruteira": 2216.38}'::jsonb)
on conflict (competencia) do nothing;
