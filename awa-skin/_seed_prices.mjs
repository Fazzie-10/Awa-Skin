import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const API = 'https://acaxoayevnzuyitprwkk.supabase.co/rest/v1';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY. Run with: node --env-file=.env.local _seed_prices.mjs');
  process.exit(1);
}
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

async function main() {
  console.log('Reading CSV...');
  const csv = readFileSync(join(DATA_DIR, 'nigerian_prices.csv'), 'utf-8');
  const lines = csv.split('\n').filter(l => l.trim());

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = [];
    let inQuote = false, cur = '';
    for (const ch of lines[i]) {
      if (ch === '"') inQuote = !inQuote;
      else if (ch === ',' && !inQuote) { vals.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    vals.push(cur.trim());
    rows.push({
      product_name: (vals[0] || '').trim(),
      brand: (vals[1] || '').trim(),
      price_naira: parseFloat(vals[2]) || 0,
      product_url: (vals[3] || '').trim(),
      source_shop: (vals[4] || '').trim(),
    });
  }
  console.log(`  ${rows.length} price rows`);

  console.log('Inserting into nigerian_prices...');
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const res = await fetch(`${API}/nigerian_prices`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`ERROR at ${i}: ${text.slice(0, 200)}`);
      process.exit(1);
    }
    console.log(`  ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }
  console.log('Done!');
}

main().catch(e => { console.error(e); process.exit(1); });
