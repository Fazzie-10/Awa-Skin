import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const SUPABASE_URL = 'https://acaxoayevnzuyitprwkk.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY. Run with: node --env-file=.env.local seed_prices.mjs');
  process.exit(1);
}
const HEADERS = { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/\s*\[.*?\]\s*/g, ' ')
    .replace(/\b\d+\s*(ml|g|oz|fl\s*oz|pcs|pack|pump|sachet)\b/gi, ' ')
    .replace(/\b\d+x\d+/g, ' ')
    .replace(/\b\d+%\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function sql(query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
    method: 'POST', headers: HEADERS, body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.log(`  SQL error (${res.status}):`, body.slice(0, 200));
    return null;
  }
  return res.json();
}

async function fetchAll(table, select, filter = '') {
  const all = [];
  let start = 0;
  const limit = 1000;
  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}${filter}&limit=${limit}&offset=${start}`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`  Fetch error for ${table}: ${res.status} ${body.slice(0, 200)}`);
      break;
    }
    const rows = await res.json();
    if (!rows || !rows.length) break;
    all.push(...rows);
    if (rows.length < limit) break;
    start += limit;
  }
  return all;
}

async function run() {
  // Step 1: Create the nigerian_prices table
  console.log('Creating nigerian_prices table...');
  const ddl = `
    CREATE TABLE IF NOT EXISTS nigerian_prices (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      product_name TEXT NOT NULL,
      brand TEXT NOT NULL DEFAULT '',
      price_naira NUMERIC(10,2),
      product_url TEXT NOT NULL DEFAULT '',
      source_shop TEXT NOT NULL DEFAULT '',
      product_id UUID REFERENCES products(id)
    );
  `;
  await sql(ddl);
  console.log('  Done (or already exists)');

  // Step 2: Insert CSV data
  console.log('Reading nigerian_prices.csv...');
  const csvRaw = readFileSync(join(DATA_DIR, 'nigerian_prices.csv'), 'utf-8').trim();
  const lines = csvRaw.split('\n');
  const header = lines[0].split(',');
  const priceRows = lines.slice(1).map(line => {
    const vals = line.split(',');
    return {
      product_name: (vals[0] || '').trim(),
      brand: (vals[1] || '').trim(),
      price_naira: parseFloat(vals[2]) || 0,
      product_url: (vals[3] || '').trim(),
      source_shop: (vals[4] || '').trim(),
    };
  });
  console.log(`  ${priceRows.length} price rows to insert`);

  // Clear existing data and re-insert
  console.log('Clearing existing data...');
  await fetch(`${SUPABASE_URL}/rest/v1/nigerian_prices`, {
    method: 'DELETE',
    headers: HEADERS,
  }).catch(() => {});

  console.log('Inserting in batches...');
  const batchSize = 500;
  for (let i = 0; i < priceRows.length; i += batchSize) {
    const batch = priceRows.slice(i, i + batchSize);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/nigerian_prices`, {
      method: 'POST',
      headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`  Batch ${i / batchSize} failed: ${res.status} ${body.slice(0, 150)}`);
    } else {
      console.log(`  Batch ${i / batchSize + 1}/${Math.ceil(priceRows.length / batchSize)} OK`);
    }
  }

  // Step 3: Link prices to products by name matching
  console.log('Fetching all products...');
  const products = await fetchAll('products', 'id,name');
  console.log(`  ${products.length} products loaded`);

  // Build normalized product name map
  const normMap = products.map(p => ({
    id: p.id,
    name: p.name,
    norm: normalizeName(p.name),
  }));

  console.log('Linking prices to products by name...');
  let linked = 0;
  let skipped = 0;

  for (const price of priceRows) {
    const priceNorm = normalizeName(price.product_name);
    if (!priceNorm) { skipped++; continue; }

    let bestMatch = null;
    let bestScore = 0;

    for (const prod of normMap) {
      const pn = prod.norm;
      // Check containment both ways
      let score = 0;
      if (pn.includes(priceNorm) || priceNorm.includes(pn)) {
        score = Math.min(priceNorm.length, pn.length) / Math.max(priceNorm.length, pn.length);
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = prod;
      }
    }

    if (bestMatch && bestScore > 0.3) {
      const updateRes = await fetch(
        `${SUPABASE_URL}/rest/v1/nigerian_prices?product_name=eq.${encodeURIComponent(price.product_name)}&source_shop=eq.${encodeURIComponent(price.source_shop)}`,
        {
          method: 'PATCH',
          headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify({ product_id: bestMatch.id }),
        },
      );
      if (updateRes.ok) linked++;
      else {
        const t = await updateRes.text().catch(() => '');
        console.log(`  Link fail for "${price.product_name}" -> "${bestMatch.name}": ${t.slice(0, 100)}`);
        skipped++;
      }
    } else {
      skipped++;
    }
  }

  console.log(`\nResults:`);
  console.log(`  Total price rows: ${priceRows.length}`);
  console.log(`  Linked to product: ${linked}`);
  console.log(`  Unlinked (orphan): ${skipped}`);

  // Show orphans
  if (skipped > 0) {
    console.log('\nSample orphans (first 10):');
    let count = 0;
    for (const price of priceRows) {
      const priceNorm = normalizeName(price.product_name);
      const hasMatch = normMap.some(p => p.norm.includes(priceNorm) || priceNorm.includes(p.norm));
      if (!hasMatch && count < 10) {
        console.log(`  - "${price.product_name}" (${price.brand}, ${price.source_shop})`);
        count++;
      }
    }
  }

  console.log('\nDone!');
}

run().catch(console.error);
