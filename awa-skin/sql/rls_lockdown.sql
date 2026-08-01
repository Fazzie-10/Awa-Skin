-- Remove anon INSERT on ingredients (seeding is done)
drop policy if exists "Anyone can insert ingredients" on ingredients;

-- Verify remaining policies are read-only for anon
-- anon should only SELECT from ingredients, products, product_ingredients, nigerian_prices
