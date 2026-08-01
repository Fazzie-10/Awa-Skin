-- ============================================
-- AWA SKIN — Complete Database Migration
-- Run this in Supabase Dashboard > SQL Editor
-- ============================================

-- 1. Create tables
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    brand TEXT NOT NULL,
    price INTEGER,
    product_url TEXT,
    source_website TEXT,
    image_url TEXT,
    raw_ingredients JSONB,
    category TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ingredients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    functions TEXT[] DEFAULT '{}',
    treats_acne BOOLEAN DEFAULT false,
    fades_pigmentation BOOLEAN DEFAULT false,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.product_ingredients (
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    ingredient_id UUID NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
    order_index INTEGER,
    PRIMARY KEY (product_id, ingredient_id)
);

CREATE TABLE IF NOT EXISTS public.skin_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT,
    acne_severity JSONB,
    pigmentation_severity JSONB,
    questionnaire_responses JSONB,
    skin_type TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES public.skin_assessments(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    reason TEXT,
    step_order INTEGER,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_products_brand ON public.products(brand);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category);
CREATE INDEX IF NOT EXISTS idx_products_source ON public.products(source_website);
CREATE INDEX IF NOT EXISTS idx_ingredients_treats_acne ON public.ingredients(treats_acne);
CREATE INDEX IF NOT EXISTS idx_ingredients_fades_pigmentation ON public.ingredients(fades_pigmentation);
CREATE INDEX IF NOT EXISTS idx_product_ingredients_product ON public.product_ingredients(product_id);
CREATE INDEX IF NOT EXISTS idx_product_ingredients_ingredient ON public.product_ingredients(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_assessment ON public.recommendations(assessment_id);
CREATE INDEX IF NOT EXISTS idx_skin_assessments_user ON public.skin_assessments(user_id);

-- 3. RLS
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skin_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recommendations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Products are publicly readable" ON public.products;
DROP POLICY IF EXISTS "Ingredients are publicly readable" ON public.ingredients;
DROP POLICY IF EXISTS "Product ingredients are publicly readable" ON public.product_ingredients;
DROP POLICY IF EXISTS "Anyone can insert assessments" ON public.skin_assessments;
DROP POLICY IF EXISTS "Anyone can read assessments" ON public.skin_assessments;
DROP POLICY IF EXISTS "Anyone can read recommendations" ON public.recommendations;
DROP POLICY IF EXISTS "Anyone can insert recommendations" ON public.recommendations;

CREATE POLICY "Products are publicly readable" ON public.products FOR SELECT USING (true);
CREATE POLICY "Ingredients are publicly readable" ON public.ingredients FOR SELECT USING (true);
CREATE POLICY "Product ingredients are publicly readable" ON public.product_ingredients FOR SELECT USING (true);
CREATE POLICY "Anyone can insert assessments" ON public.skin_assessments FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can read assessments" ON public.skin_assessments FOR SELECT USING (true);
CREATE POLICY "Anyone can read recommendations" ON public.recommendations FOR SELECT USING (true);
CREATE POLICY "Anyone can insert recommendations" ON public.recommendations FOR INSERT WITH CHECK (true);

-- 4. Matching view
CREATE OR REPLACE VIEW public.vw_product_ingredient_details AS
SELECT 
    p.id AS product_id,
    p.name AS product_name,
    p.brand,
    p.price,
    p.category,
    p.source_website,
    p.product_url,
    p.image_url,
    jsonb_agg(
        jsonb_build_object(
            'ingredient_id', i.id,
            'name', i.name,
            'functions', i.functions,
            'treats_acne', i.treats_acne,
            'fades_pigmentation', i.fades_pigmentation,
            'order_index', pi.order_index
        ) ORDER BY pi.order_index NULLS LAST
    ) AS ingredients
FROM public.products p
JOIN public.product_ingredients pi ON pi.product_id = p.id
JOIN public.ingredients i ON i.id = pi.ingredient_id
GROUP BY p.id, p.name, p.brand, p.price, p.category, p.source_website, p.product_url, p.image_url;

-- 5. Ingredients seed data
INSERT INTO public.ingredients (name, functions, treats_acne, fades_pigmentation, description) VALUES
('Niacinamide', ARRAY['soothing', 'brightening', 'antioxidant'], true, true, 'Vitamin B3 — reduces inflammation, fades dark spots, strengthens barrier'),
('Salicylic Acid', ARRAY['exfoliant', 'anti-inflammatory'], true, false, 'Beta hydroxy acid — penetrates pores, treats acne and blackheads'),
('Vitamin C (Ascorbic Acid)', ARRAY['antioxidant', 'brightening'], false, true, 'Potent antioxidant that fades hyperpigmentation and boosts collagen'),
('Hyaluronic Acid', ARRAY['hydrating'], false, false, 'Holds 1000x its weight in water — deep hydration without clogging pores'),
('Retinol', ARRAY['antioxidant', 'cell-communicating'], true, true, 'Vitamin A derivative — accelerates cell turnover, treats acne and pigmentation'),
('Azelaic Acid', ARRAY['anti-inflammatory', 'brightening'], true, true, 'Treats acne rosacea and fades post-inflammatory hyperpigmentation'),
('Centella Asiatica', ARRAY['soothing', 'healing'], true, false, 'Cica — calms inflammation, promotes wound healing'),
('Kojic Acid', ARRAY['brightening'], false, true, 'Inhibits melanin production — fades dark spots and melasma'),
('Zinc PCA', ARRAY['anti-inflammatory', 'sebum-regulating'], true, false, 'Regulates oil production and reduces acne lesions'),
('Alpha Arbutin', ARRAY['brightening'], false, true, 'Gentle tyrosinase inhibitor for fading hyperpigmentation')
ON CONFLICT (name) DO NOTHING;

-- 6. Products seed data
INSERT INTO public.products (name, brand, price, category, source_website, product_url, raw_ingredients) VALUES
('Low pH Good Morning Gel Cleanser', 'COSRX', 8500, 'cleanser', 'buybetter.ng', 'https://buybetter.ng/products/cosrx-low-ph-good-morning-gel-cleanser', '["Water","Salicylic Acid","Centella Asiatica Extract","Tea Tree Oil"]'),
('Niacinamide 10% + Zinc 1%', 'The Ordinary', 9500, 'serum', 'myskincaremall.com', 'https://myskincaremall.com/products/the-ordinary-niacinamide-10-zinc-1', '["Water","Niacinamide","Zinc PCA","Salicylic Acid"]'),
('Hydrating Hyaluronic Acid Serum', 'CeraVe', 12000, 'serum', 'buybetter.ng', 'https://buybetter.ng/products/cerave-hyaluronic-acid-serum', '["Water","Hyaluronic Acid","Niacinamide","Vitamin B5"]'),
('2% BHA Liquid Exfoliant', 'Paula Choice', 18500, 'exfoliant', 'myskincaremall.com', 'https://myskincaremall.com/products/paulas-choice-2-bha-liquid-exfoliant', '["Water","Salicylic Acid","Methylpropanediol","Green Tea Extract"]'),
('Glow Serum Propolis + Niacinamide', 'Beauty of Joseon', 11000, 'serum', 'teeka4.com', 'https://teeka4.com/products/beauty-of-joseon-glow-serum', '["Propolis Extract","Niacinamide","Hyaluronic Acid","Centella Asiatica Extract"]'),
('Advanced Snail 96% Mucin Power Essence', 'COSRX', 13000, 'serum', 'buybetter.ng', 'https://buybetter.ng/products/cosrx-advanced-snail-96-mucin-power-essence', '["Snail Secretion Filtrate","Hyaluronic Acid","Beta-Glucan","Arginine"]'),
('Retinol 0.5% in Squalane', 'The Ordinary', 10500, 'treatment', 'myskincaremall.com', 'https://myskincaremall.com/products/the-ordinary-retinol-05-in-squalane', '["Squalane","Retinol","Jojoba Oil"]'),
('Freshly Juiced Vitamin Drop', 'Dear Klairs', 14500, 'serum', 'teeka4.com', 'https://teeka4.com/products/dear-klairs-freshly-juiced-vitamin-drop', '["Water","Vitamin C (Ascorbic Acid)","Hyaluronic Acid","Centella Asiatica Extract"]'),
('Centella Green Level Calming Toner', 'Purito', 11500, 'toner', 'buybetter.ng', 'https://buybetter.ng/products/purito-centella-green-level-calming-toner', '["Centella Asiatica Extract","Hyaluronic Acid","Panthenol"]'),
('Moisturizing Cream', 'CeraVe', 15000, 'moisturizer', 'myskincaremall.com', 'https://myskincaremall.com/products/cerave-moisturizing-cream', '["Water","Hyaluronic Acid","Ceramides","Niacinamide"]'),
('Advanced Snail 92 All in One Cream', 'COSRX', 14000, 'moisturizer', 'buybetter.ng', 'https://buybetter.ng/products/cosrx-advanced-snail-92-all-in-one-cream', '["Snail Secretion Filtrate","Hyaluronic Acid","Betaine"]'),
('Niacin Brightening Toner', 'Some By Mi', 10000, 'toner', 'teeka4.com', 'https://teeka4.com/products/some-by-mi-niacin-brightening-toner', '["Water","Niacinamide","Vitamin C","Salicylic Acid"]'),
('Dark Spot Correcting Glow Serum', 'Axis-Y', 12500, 'serum', 'mylabafrica.com', 'https://mylabafrica.com/products/axis-y-dark-spot-correcting-glow-serum', '["Water","Niacinamide","Alpha Arbutin","Centella Asiatica Extract"]'),
('Madagascar Centella Asiatica Ampoule', 'Skin1004', 13500, 'serum', 'myskincaremall.com', 'https://myskincaremall.com/products/skin1004-madagascar-centella-asiatica-ampoule', '["Centella Asiatica Extract","Hyaluronic Acid","Panthenol","Niacinamide"]'),
('Time Revolution The First Treatment Essence', 'Missha', 16000, 'toner', 'buybetter.ng', 'https://buybetter.ng/products/missha-time-revolution-first-treatment-essence', '["Fermented Yeast Extract","Niacinamide","Hyaluronic Acid"]'),
('Aloe Soothing Sun Cream SPF50', 'COSRX', 11000, 'sunscreen', 'teeka4.com', 'https://teeka4.com/products/cosrx-aloe-soothing-sun-cream-spf50', '["Aloe Vera Extract","Centella Asiatica Extract","Zinc Oxide"]'),
('Water Sleeping Mask', 'Laneige', 17000, 'moisturizer', 'myskincaremall.com', 'https://myskincaremall.com/products/laneige-water-sleeping-mask', '["Water","Hyaluronic Acid","Squalane","Niacinamide"]'),
('Effaclar Duo+', 'La Roche-Posay', 15500, 'treatment', 'buybetter.ng', 'https://buybetter.ng/products/la-roche-posay-effaclar-duo', '["Water","Salicylic Acid","Niacinamide","Zinc PCA"]'),
('AZA-Clear Azelaic Acid Serum', 'Axis-Y', 12000, 'serum', 'mylabafrica.com', 'https://mylabafrica.com/products/axis-y-aza-clear-azelaic-acid-serum', '["Water","Azelaic Acid","Niacinamide","Centella Asiatica Extract"]')
ON CONFLICT (id) DO NOTHING;

-- 7. Product-Ingredient links
DO $$
DECLARE
    niacin_id UUID; sal_id UUID; vitc_id UUID; ha_id UUID; ret_id UUID;
    aza_id UUID; cent_id UUID; koj_id UUID; zinc_id UUID; alpha_id UUID;
    prod RECORD;
BEGIN
    SELECT id INTO niacin_id FROM ingredients WHERE name = 'Niacinamide';
    SELECT id INTO sal_id FROM ingredients WHERE name = 'Salicylic Acid';
    SELECT id INTO vitc_id FROM ingredients WHERE name = 'Vitamin C (Ascorbic Acid)';
    SELECT id INTO ha_id FROM ingredients WHERE name = 'Hyaluronic Acid';
    SELECT id INTO ret_id FROM ingredients WHERE name = 'Retinol';
    SELECT id INTO aza_id FROM ingredients WHERE name = 'Azelaic Acid';
    SELECT id INTO cent_id FROM ingredients WHERE name = 'Centella Asiatica';
    SELECT id INTO koj_id FROM ingredients WHERE name = 'Kojic Acid';
    SELECT id INTO zinc_id FROM ingredients WHERE name = 'Zinc PCA';
    SELECT id INTO alpha_id FROM ingredients WHERE name = 'Alpha Arbutin';

    -- COSRX Low pH Good Morning Gel Cleanser
    SELECT id INTO prod FROM products WHERE name LIKE 'Low pH Good Morning%';
    INSERT INTO product_ingredients (product_id, ingredient_id, order_index) VALUES (prod.id, sal_id, 1), (prod.id, cent_id, 2) ON CONFLICT DO NOTHING;

    -- The Ordinary Niacinamide 10% + Zinc
    SELECT id INTO prod FROM products WHERE name LIKE 'Niacinamide 10%';
    INSERT INTO product_ingredients (product_id, ingredient_id, order_index) VALUES (prod.id, niacin_id, 1), (prod.id, zinc_id, 2) ON CONFLICT DO NOTHING;

    -- CeraVe Hydrating Hyaluronic Acid Serum
    SELECT id INTO prod FROM products WHERE name LIKE 'Hydrating Hyaluronic%';
    INSERT INTO product_ingredients (product_id, ingredient_id, order_index) VALUES (prod.id, ha_id, 1), (prod.id, niacin_id, 2) ON CONFLICT DO NOTHING;

    -- Paula's Choice 2% BHA
    SELECT id INTO prod FROM products WHERE name LIKE '2% BHA%';
    INSERT INTO product_ingredients (product_id, ingredient_id, order_index) VALUES (prod.id, sal_id, 1) ON CONFLICT DO NOTHING;

    -- Beauty of Joseon Glow Serum
    SELECT id INTO prod FROM products WHERE name LIKE 'Glow Serum%';
    INSERT INTO product_ingredients (product_id, ingredient_id, order_index) VALUES (prod.id, niacin_id, 1), (prod.id, ha_id, 2), (prod.id, cent_id, 3) ON CONFLICT DO NOTHING;

    -- COSRX Advanced Snail 96%
    SELECT id INTO prod FROM products WHERE name LIKE 'Advanced Snail 96%';
    INSERT INTO product_ingredients (product_id, ingredient_id, order_index) VALUES (prod.id, ha_id, 1) ON CONFLICT DO NOTHING;

    -- The Ordinary Retinol 0.5%
    SELECT id INTO prod FROM products WHERE name LIKE 'Retinol 0.5%';
    INSERT INTO product_ingredients (product_id, ingredient_id, order_index) VALUES (prod.id, ret_id, 1) ON CONFLICT DO NOTHING;

    -- Dear Klairs Freshly Juiced Vitamin Drop
    SELECT id INTO prod FROM products WHERE name LIKE 'Freshly Juiced%';
    INSERT INTO product_ingredients (product_id, ingredient_id, order_index) VALUES (prod.id, vitc_id, 1), (prod.id, ha_id, 2), (prod.id, cent_id, 3) ON CONFLICT DO NOTHING;

    -- Purito Centella Green Level Toner
    SELECT id INTO prod FROM products WHERE name LIKE 'Centella Green Level%';
    INSERT INTO product_ingredients (product_id, ingredient_id, order_index) VALUES (prod.id, cent_id, 1), (prod.id, ha_id, 2) ON CONFLICT DO NOTHING;

    -- CeraVe Moisturizing Cream
    SELECT id INTO prod FROM products WHERE name = 'Moisturizing Cream';
    INSERT INTO product_ingredients (product_id, ingredient_id, order_index) VALUES (prod.id, ha_id, 1), (prod.id, niacin_id, 2) ON CONFLICT DO NOTHING;

    -- COSRX Advanced Snail 92
    SELECT id INTO prod FROM products WHERE name LIKE 'Advanced Snail 92%';
    INSERT INTO product_ingredients (product_id, ingredient_id, order_index) VALUES (prod.id, ha_id, 1) ON CONFLICT DO NOTHING;

    -- Some By Mi Niacin Brightening Toner
    SELECT id INTO prod FROM products WHERE name LIKE 'Niacin Brightening%';
    INSERT INTO product_ingredients (product_id, ingredient_id, order_index) VALUES (prod.id, niacin_id, 1), (prod.id, vitc_id, 2), (prod.id, sal_id, 3) ON CONFLICT DO NOTHING;

    -- Axis-Y Dark Spot Correcting Glow Serum
    SELECT id INTO prod FROM products WHERE name LIKE 'Dark Spot Correcting%';
    INSERT INTO product_ingredients (product_id, ingredient_id, order_index) VALUES (prod.id, niacin_id, 1), (prod.id, alpha_id, 2), (prod.id, cent_id, 3) ON CONFLICT DO NOTHING;

    -- Skin1004 Madagascar Centella Asiatica Ampoule
    SELECT id INTO prod FROM products WHERE name LIKE 'Madagascar Centella%';
    INSERT INTO product_ingredients (product_id, ingredient_id, order_index) VALUES (prod.id, cent_id, 1), (prod.id, ha_id, 2), (prod.id, niacin_id, 3) ON CONFLICT DO NOTHING;

    -- Missha Time Revolution
    SELECT id INTO prod FROM products WHERE name LIKE 'Time Revolution%';
    INSERT INTO product_ingredients (product_id, ingredient_id, order_index) VALUES (prod.id, niacin_id, 1), (prod.id, ha_id, 2) ON CONFLICT DO NOTHING;

    -- COSRX Aloe Soothing Sun Cream
    SELECT id INTO prod FROM products WHERE name LIKE 'Aloe Soothing%';
    INSERT INTO product_ingredients (product_id, ingredient_id, order_index) VALUES (prod.id, cent_id, 1) ON CONFLICT DO NOTHING;

    -- Laneige Water Sleeping Mask
    SELECT id INTO prod FROM products WHERE name LIKE 'Water Sleeping%';
    INSERT INTO product_ingredients (product_id, ingredient_id, order_index) VALUES (prod.id, ha_id, 1), (prod.id, niacin_id, 2) ON CONFLICT DO NOTHING;

    -- La Roche-Posay Effaclar Duo+
    SELECT id INTO prod FROM products WHERE name LIKE 'Effaclar Duo%';
    INSERT INTO product_ingredients (product_id, ingredient_id, order_index) VALUES (prod.id, sal_id, 1), (prod.id, niacin_id, 2), (prod.id, zinc_id, 3) ON CONFLICT DO NOTHING;

    -- Axis-Y AZA-Clear Azelaic Acid Serum
    SELECT id INTO prod FROM products WHERE name LIKE 'AZA-Clear%';
    INSERT INTO product_ingredients (product_id, ingredient_id, order_index) VALUES (prod.id, aza_id, 1), (prod.id, niacin_id, 2), (prod.id, cent_id, 3) ON CONFLICT DO NOTHING;
END $$;
