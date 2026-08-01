import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const SUPABASE_URL = 'https://acaxoayevnzuyitprwkk.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY. Run with: node --env-file=.env.local seed.mjs');
  process.exit(1);
}

const BRAND_MAP = {
  'Neogen Dermalogy': 'Neogen', 'Amore Pacific': 'Amorepacific', 'AmorePacific': 'Amorepacific',
  'PyunkangYul': 'Pyunkang Yul', 'Skin Food': 'Skinfood', "TIA'M": 'TIAM', 'JUMISO': 'Jumiso',
  'iUnik': 'iUNIK', 'VT Cosmetics': 'VT', 'Dr.Belmeur': 'Dr. Belmeur',
  'haruharu': 'Haruharu Wonder', 'manyo': 'Manyo Factory', 'innisfree': 'Innisfree',
  "Paula's Choice Skincare": "Paula's Choice", 'ROUND LAB': 'Round Lab', 'LANEIGE': 'Laneige',
  'MARY & MAY': 'Mary & May', 'ONE THING': 'One Thing',
};

function normalizeBrand(name) {
  name = (name || '').trim();
  return BRAND_MAP[name] || name;
}

function parseIngredients(str) {
  if (!str || str.trim() === 'None') return [];
  return str.split(',').map(s => s.trim()).filter(Boolean);
}

function inferProperties(name) {
  const n = name.toLowerCase();
  const funcs = [];
  let treatsAcne = false, fadesPig = false;
  if (/salicylic|bha|benzoyl|retinol|retinoid|tretinoin|adapalene|tea tree|niacinamide|zinc.*pca|azelaic|sulfur|glycolic|lactic/.test(n)) treatsAcne = true;
  if (/vitamin c|ascorbic|kojic|arbutin|niacinamide|tranexamic|glutathione|retinol|azelaic|hydroquinone|licorice/.test(n)) fadesPig = true;
  if (/hyaluronic|glycerin|squalane|ceramide|panthenol|betaine|propylene|butylene|propanediol/.test(n)) funcs.push('moisturizer');
  if (!funcs.length) funcs.push('unknown');
  return { functions: funcs, treats_acne: treatsAcne, fades_pigmentation: fadesPig };
}

function parseCsv(path) {
  const text = readFileSync(path, 'utf-8');
  const lines = text.split('\n').filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = [];
    let inQuote = false, cur = '';
    for (const ch of line) {
      if (ch === '"') inQuote = !inQuote;
      else if (ch === ',' && !inQuote) { vals.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    vals.push(cur.trim());
    const obj = {};
    headers.forEach((h, i) => obj[h] = vals[i] || '');
    return obj;
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const headers = {
  'apikey': SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'resolution=merge-duplicates',
};

async function restInsert(table, rows) {
  const total = rows.length;
  const BATCH = 400;
  for (let i = 0; i < total; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`  ERROR batch ${i}-${Math.min(i+BATCH, total)}/${total} in ${table}:`, text.slice(0, 300));
      return false;
    }
    console.log(`  ${Math.min(i + BATCH, total)}/${total} into ${table}`);
    await sleep(200);
  }
  return true;
}

async function restFetch(table, select) {
  let all = [];
  let rangeStart = 0;
  const PAGE = 1000;
  while (true) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=${select}`, {
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Range': `${rangeStart}-${rangeStart + PAGE - 1}`,
      },
    });
    if (!res.ok) throw new Error(`Fetch ${table} failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    if (!data.length) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    rangeStart += PAGE;
  }
  return all;
}

async function main() {
  console.log('='.repeat(50));
  console.log('AWA SKIN — Supabase Seed Script');
  console.log('='.repeat(50));

  const ingRows = parseCsv(join(DATA_DIR, 'ingredients_database.csv'));
  const priceRows = parseCsv(join(DATA_DIR, 'nigerian_prices.csv'));
  console.log(`\n[1] Loaded ${ingRows.length} ingredient rows, ${priceRows.length} price rows`);

  const pricesByUrl = {};
  for (const p of priceRows) {
    const url = (p.product_url || '').trim().toLowerCase();
    if (url) pricesByUrl[url] = { price: p.price_naira ? parseInt(p.price_naira, 10) : null, shop: p.source_shop || null };
  }

  console.log('\n[2] Extracting unique ingredients...');
  const ingredientMap = new Map();
  for (const row of ingRows) {
    for (const ing of parseIngredients(row.ingredients_list)) {
      const key = ing.toLowerCase();
      if (!ingredientMap.has(key)) ingredientMap.set(key, { name: ing, ...inferProperties(ing) });
    }
  }
  console.log(`  ${ingredientMap.size} unique ingredients`);

  console.log(`\n[3] Inserting ${ingredientMap.size} ingredients...`);
  const ingBatch = [];
  for (const [, props] of ingredientMap) ingBatch.push(props);
  const ingOk = await restInsert('ingredients', ingBatch);
  if (!ingOk) { console.log('  Aborting.'); process.exit(1); }

  console.log('\n[4] Fetching ingredient IDs...');
  const dbIngredients = await restFetch('ingredients', 'id,name');
  const ingIdMap = new Map();
  for (const r of dbIngredients) ingIdMap.set(r.name.toLowerCase(), r.id);
  console.log(`  ${ingIdMap.size} ingredient IDs`);

  console.log(`\n[5] Inserting ${ingRows.length} products...`);
  const prodBatch = ingRows.map(row => {
    const urlLower = (row.product_url || '').trim().toLowerCase();
    const info = pricesByUrl[urlLower] || {};
    let cat = 'unknown';
    const n = (row.product_name || '').toLowerCase();
    if (/cleanser|wash|foam|soap/.test(n)) cat = 'cleanser';
    else if (/toner|mist/.test(n)) cat = 'toner';
    else if (/serum|ampoule|essence/.test(n)) cat = 'serum';
    else if (/moisturizer|cream|lotion|sleeping mask/.test(n)) cat = 'moisturizer';
    else if (/sunscreen|sun cream|spf|sun stick/.test(n)) cat = 'sunscreen';
    else if (/exfoliant|peeling|scrub|acid|bha|aha/.test(n)) cat = 'exfoliant';
    else if (/mask|patch/.test(n)) cat = 'mask';
    else if (/treatment|retinol|spot/.test(n)) cat = 'treatment';
    return {
      name: (row.product_name || '').trim(), brand: normalizeBrand(row.brand || ''),
      price: info.price, product_url: (row.product_url || '').trim(),
      source_website: info.shop, raw_ingredients: parseIngredients(row.ingredients_list), category: cat,
    };
  });
  const prodOk = await restInsert('products', prodBatch);
  if (!prodOk) { console.log('  Aborting.'); process.exit(1); }

  console.log('\n[6] Fetching product IDs...');
  const dbProducts = await restFetch('products', 'id,product_url');
  const prodIdByUrl = new Map();
  for (const p of dbProducts) {
    const u = (p.product_url || '').trim().toLowerCase();
    if (u) prodIdByUrl.set(u, p.id);
  }
  console.log(`  ${prodIdByUrl.size} product IDs`);

  console.log('\n[7] Creating product-ingredient links...');
  const juncBatch = [];
  const seenLinks = new Set();
  for (const row of ingRows) {
    const pid = prodIdByUrl.get((row.product_url || '').trim().toLowerCase());
    if (!pid) continue;
    parseIngredients(row.ingredients_list).forEach((ing, idx) => {
      const iid = ingIdMap.get(ing.toLowerCase());
      if (!iid) return;
      const key = `${pid}:${iid}`;
      if (seenLinks.has(key)) return;
      seenLinks.add(key);
      juncBatch.push({ product_id: pid, ingredient_id: iid, order_index: idx });
    });
  }
  console.log(`  ${juncBatch.length} links`);
  if (juncBatch.length) {
    const juncOk = await restInsert('product_ingredients', juncBatch);
    if (!juncOk) console.log('  (continuing)');
  }

  console.log('\n' + '='.repeat(50));
  console.log('SEED COMPLETE');
  console.log(`  Ingredients: ${ingredientMap.size}`);
  console.log(`  Products: ${prodBatch.length}`);
  console.log(`  Links: ${juncBatch.length}`);
  console.log('='.repeat(50));
}

main().catch(e => { console.error(e); process.exit(1); });
