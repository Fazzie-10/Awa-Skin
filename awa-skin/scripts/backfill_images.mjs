// Backfill products.image_url from Nigerian shop product pages (og:image).
// Usage: node scripts/backfill_images.mjs [--limit 200]
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  try {
    const raw = readFileSync(resolve(__dirname, "..", ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  } catch {
    // .env.local optional
  }
}
loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE env vars");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const limit = parseInt(process.argv.find(a => a.startsWith("--limit"))?.split("=")[1] || "200", 10);

const { data: prices, error } = await supabase
  .from("nigerian_prices")
  .select("product_url")
  .not("product_url", "is", null)
  .limit(1000);

if (error) {
  console.error("Failed to fetch prices:", error.message);
  process.exit(1);
}

const urls = [...new Set((prices || []).map(p => p.product_url).filter(Boolean))].slice(0, limit);
console.log(`Fetching og:image for ${urls.length} product URLs...`);

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
let updated = 0;
let failed = 0;

for (let i = 0; i < urls.length; i++) {
  const url = urls[i];
  let ogImage = null;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      const html = await res.text();
      const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
      ogImage = m ? m[1] : null;
    }
  } catch {
    failed++;
  }

  if (ogImage) {
    const { error: upErr } = await supabase
      .from("products")
      .update({ image_url: ogImage })
      .eq("product_url", url);
    if (!upErr) updated++;
  }

  if ((i + 1) % 50 === 0) {
    console.log(`  ${i + 1}/${urls.length} (${updated} updated, ${failed} failed)`);
  }
  await new Promise(r => setTimeout(r, 250));
}

console.log(`Done: ${updated} products updated, ${failed} URLs failed`);
