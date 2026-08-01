import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const API = 'https://acaxoayevnzuyitprwkk.supabase.co/rest/v1';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY. Run with: node --env-file=.env.local _seed_prices_agentic.mjs');
  process.exit(1);
}
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' };

function parseCsv(path) {
  const text = readFileSync(path, 'utf-8');
  const lines = text.split('\n').filter(l => l.trim());
  const headers = [];
  let inQuote = false, cur = '';
  for (const ch of lines[0]) {
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ',' && !inQuote) { headers.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  headers.push(cur.trim());

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = [];
    inQuote = false; cur = '';
    for (const ch of lines[i]) {
      if (ch === '"') inQuote = !inQuote;
      else if (ch === ',' && !inQuote) { vals.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    vals.push(cur.trim());
    const obj = {};
    headers.forEach((h, j) => obj[h] = vals[j] || '');
    rows.push(obj);
  }
  return rows;
}

async function main() {
  console.log('Reading nigerian_prices_agentic.csv...');
  const allRows = parseCsv(join(DATA_DIR, 'nigerian_prices_agentic.csv'));
  console.log(`  Total rows: ${allRows.length}`);

  const faceRows = allRows.filter(r => r.sub_category === 'Face');
  console.log(`  Face rows: ${faceRows.length}`);

  const mapped = faceRows.map(r => ({
    product_name: (r.product_name || '').trim(),
    brand: (r.brand || '').trim(),
    price_naira: Math.round(parseFloat(r.price_naira) || 0),
    product_url: (r.product_url || '').trim(),
    source_shop: (r.source_shop || '').trim(),
    core_step: (r.core_step || '').trim(),
  }));

  console.log('\nClearing existing nigerian_prices...');
  const delRes = await fetch(`${API}/nigerian_prices?id=neq.0`, {
    method: 'DELETE',
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, Prefer: 'return=minimal' },
  });
  if (!delRes.ok) {
    const text = await delRes.text();
    console.error(`DELETE failed: ${text.slice(0, 200)}`);
    process.exit(1);
  }
  console.log('  Cleared.');

  console.log(`\nInserting ${mapped.length} face rows...`);
  const BATCH = 500;
  for (let i = 0; i < mapped.length; i += BATCH) {
    const batch = mapped.slice(i, i + BATCH);
    const res = await fetch(`${API}/nigerian_prices`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`ERROR at ${i}: ${text.slice(0, 300)}`);
      process.exit(1);
    }
    console.log(`  ${Math.min(i + BATCH, mapped.length)}/${mapped.length}`);
  }

  console.log('\nDone!');
  console.log(`  Inserted ${mapped.length} Face product prices`);
}

main().catch(e => { console.error(e); process.exit(1); });
