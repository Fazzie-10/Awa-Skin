-- Migration V2: Add location and sub_category columns to nigerian_prices for Dashboard execution
ALTER TABLE nigerian_prices ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE nigerian_prices ADD COLUMN IF NOT EXISTS sub_category TEXT;
CREATE INDEX IF NOT EXISTS idx_nigerian_prices_location ON nigerian_prices(location);
CREATE INDEX IF NOT EXISTS idx_nigerian_prices_core_step ON nigerian_prices(core_step);
