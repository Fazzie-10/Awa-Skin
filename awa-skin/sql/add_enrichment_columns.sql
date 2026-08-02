-- Enrichment migration: add ingredient + image columns to nigerian_prices
-- Run this in the Supabase Dashboard (SQL editor) before scripts/enrich_nigerian_prices.py
alter table nigerian_prices add column if not exists raw_ingredients jsonb;
alter table nigerian_prices add column if not exists image_url text;
create index if not exists idx_nigerian_prices_core_step on nigerian_prices(core_step);
