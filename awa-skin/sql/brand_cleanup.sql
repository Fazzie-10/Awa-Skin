-- Cleanup: products where brand is actually an ingredient name
-- These came from mis-assigned data during seeding

-- Step 1: Find all products whose brand matches an ingredient name
select p.id, p.name, p.brand, i.name as matched_ingredient
from products p
join ingredients i on lower(p.brand) = lower(i.name)
order by p.brand;

-- Step 2: Update them to Generic/Unlisted
update products p
set brand = 'Generic/Unlisted'
from ingredients i
where lower(p.brand) = lower(i.name)
  and lower(p.brand) not in ('anua', 'cerave', 'abib', 'celimax', 'benton', 'belif', 'aestura', 'beplain');

-- Step 3: Fix "1" as brand name (data import error)
update products set brand = 'Generic/Unlisted' where brand = '1';

-- Step 4: Fix remaining ingredient names as brands
update products set brand = 'Generic/Unlisted'
where brand in (
  'Titanium Dioxideci 778911',
  'Yellow 6(C115985)',
  'Polyglyceryl'
);

-- Step 5: Fix product where a URL was concatenated into the brand field
update products set brand = 'Generic/Unlisted'
where brand like 'Dipotassium Glycyrrhizate,https://%';

-- Step 6: Verify remaining brands look clean
select brand, count(*) as cnt
from products
group by brand
order by cnt desc;
