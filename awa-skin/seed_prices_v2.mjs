import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const SUPABASE_URL = 'https://acaxoayevnzuyitprwkk.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY. Run with: node --env-file=.env.local seed_prices_v2.mjs');
  process.exit(1);
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
  const BATCH = 300;
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
    await sleep(150);
  }
  return true;
}

async function main() {
  console.log('='.repeat(50));
  console.log('AWA SKIN — Seeding Nigerian Prices V2 (3,352 Records)');
  console.log('='.repeat(50));

  const csvPath = join(DATA_DIR, 'nigerian_prices_clean.csv');
  const priceRows = parseCsv(csvPath);
  console.log(`\nLoaded ${priceRows.length} clean price records from ${csvPath}`);

  const batch = priceRows.map(row => ({
    product_name: (row.product_name || '').trim(),
    brand: (row.brand || 'Generic/Unlisted').trim(),
    price_naira: row.price_naira ? parseFloat(row.price_naira) : null,
    product_url: (row.product_url || '').trim(),
    source_shop: (row.source_shop || '').trim(),
    core_step: (row.core_step || 'Other').trim(),
  }));

  console.log(`\nInserting ${batch.length} rows into nigerian_prices table...`);
  const ok = await restInsert('nigerian_prices', batch);

  if (ok) {
    console.log('\n' + '='.repeat(50));
    console.log(`SUCCESSFULLY SEEDED ${batch.length} NIGERIAN PRICE RECORDS`);
    console.log('='.repeat(50));
  } else {
    console.error('Seeding failed.');
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
