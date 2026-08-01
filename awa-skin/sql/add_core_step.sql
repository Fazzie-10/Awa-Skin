-- Add core_step column for routine step grouping
alter table nigerian_prices add column if not exists core_step text;
