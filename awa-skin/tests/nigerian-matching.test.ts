import { filterAndScoreNigerianRows, buildProductMatchFromRow } from '../src/lib/matching';
import type { NigerianPrice } from '../src/lib/matching';

let passed = 0;
let failed = 0;
const errors: string[] = [];

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    errors.push(message);
    console.log(`  ✗ ${message}`);
  }
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  const ok = actual === expected;
  if (ok) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    errors.push(`${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    console.log(`  ✗ ${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    errors.push(`${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    console.log(`  ✗ ${message}`);
    console.log(`    expected: ${JSON.stringify(expected)}`);
    console.log(`    actual:   ${JSON.stringify(actual)}`);
  }
}

function mkRow(overrides: Partial<NigerianPrice>): NigerianPrice {
  return {
    id: 1,
    product_name: 'Niacinamide Serum',
    brand: 'Brand A',
    price_naira: 5000,
    product_url: 'https://example.com/niacinamide',
    source_shop: 'SkinPop Lagos',
    location: 'Lagos',
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────
// Test group 1: filterAndScoreNigerianRows()
// ─────────────────────────────────────────────────────
console.log('\n=== filterAndScoreNigerianRows() ===');

// 1a: row whose raw_ingredients contain a recommended ingredient → matched
{
  const rows = [
    mkRow({ id: 1, raw_ingredients: ['Water', 'Niacinamide', 'Glycerin'] }),
    mkRow({ id: 2, product_name: 'Glycolic Toner', raw_ingredients: ['Water', 'Glycolic Acid'] }),
  ];
  const result = filterAndScoreNigerianRows(rows, ['Niacinamide'], []);
  assertEqual(result.length, 1, '1a: only the Niacinamide row is matched');
  assertEqual(result[0].row.id, 1, '1a: matched row is the Niacinamide serum');
  assertDeepEqual(result[0].matched, ['Niacinamide'], '1a: matched ingredient list contains Niacinamide');
}

// 1b: row containing an avoid ingredient → excluded
{
  const rows = [
    mkRow({ id: 1, raw_ingredients: ['Water', 'Niacinamide', 'Salicylic Acid'] }),
    mkRow({ id: 2, raw_ingredients: ['Water', 'Niacinamide', 'Glycerin'] }),
  ];
  const result = filterAndScoreNigerianRows(rows, ['Niacinamide'], ['Salicylic Acid']);
  assertEqual(result.length, 1, '1b: Salicylic Acid row excluded, clean Niacinamide row kept');
  assertEqual(result[0].row.id, 2, '1b: surviving row is id 2');
}

// 1c: row with empty / missing raw_ingredients → excluded
{
  const rows = [
    mkRow({ id: 1, raw_ingredients: ['Niacinamide'] }),
    mkRow({ id: 2, raw_ingredients: [] }),
    mkRow({ id: 3, raw_ingredients: undefined }),
    mkRow({ id: 4 }),
  ];
  const result = filterAndScoreNigerianRows(rows, ['Niacinamide'], []);
  assertEqual(result.length, 1, '1c: only row with real raw_ingredients survives');
  assertEqual(result[0].row.id, 1, '1c: surviving row is id 1');
}

// 1d: recommended "Niacinamide 10%" should still match raw "Niacinamide" (normalized)
{
  const rows = [mkRow({ id: 1, raw_ingredients: ['Niacinamide'] })];
  const result = filterAndScoreNigerianRows(rows, ['Niacinamide 10%'], []);
  assertEqual(result.length, 1, '1d: normalized recommended ingredient matches raw list');
}

// 1e: no recommended ingredient present → empty
{
  const rows = [mkRow({ id: 1, raw_ingredients: ['Water', 'Glycerin'] })];
  const result = filterAndScoreNigerianRows(rows, ['Niacinamide'], []);
  assertEqual(result.length, 0, '1e: no match → empty result');
}

// ─────────────────────────────────────────────────────
// Test group 2: buildProductMatchFromRow()
// ─────────────────────────────────────────────────────
console.log('\n=== buildProductMatchFromRow() ===');

// 2a: step_order mapped from core_step
{
  const step = buildProductMatchFromRow(
    mkRow({ id: 7, core_step: 'treat', price_naira: 4500 }),
    ['Niacinamide'],
    'Lagos',
  );
  assertEqual(step.step_order, 2, '2a: core_step treat → 2');
  assertEqual(step.id, 'ng-7', '2a: id prefixed with ng-');
}

// 2b: step_order falls back to getStepOrder(product_name) when core_step missing
{
  const cleanser = buildProductMatchFromRow(
    mkRow({ id: 8, product_name: 'Gentle Foaming Cleanser', core_step: undefined }),
    ['Niacinamide'],
    'Lagos',
  );
  assertEqual(cleanser.step_order, 1, '2b: no core_step, cleanser name → 1');

  const spf = buildProductMatchFromRow(
    mkRow({ id: 9, product_name: 'SPF 50 Sunscreen', core_step: undefined }),
    ['Zinc'],
    'Lagos',
  );
  assertEqual(spf.step_order, 4, '2b: no core_step, sunscreen name → 4');
}

// 2c: image_url passthrough (value and null)
{
  const withImg = buildProductMatchFromRow(
    mkRow({ id: 10, image_url: 'https://img.example.com/p.jpg' }),
    ['Niacinamide'],
    'Lagos',
  );
  assertEqual(withImg.image_url, 'https://img.example.com/p.jpg', '2c: image_url passes through when present');

  const noImg = buildProductMatchFromRow(
    mkRow({ id: 11, image_url: null }),
    ['Niacinamide'],
    'Lagos',
  );
  assertEqual(noImg.image_url, null, '2c: image_url is null when row has none');

  const missingImg = buildProductMatchFromRow(
    mkRow({ id: 12, image_url: undefined }),
    ['Niacinamide'],
    'Lagos',
  );
  assertEqual(missingImg.image_url, null, '2c: image_url defaults to null when undefined');
}

// 2d: shipping_required logic (local vs shipping)
{
  const local = buildProductMatchFromRow(
    mkRow({ id: 13, location: 'Lagos' }),
    ['Niacinamide'],
    'Lagos',
  );
  assertEqual(local.shipping_required, false, '2d: same-location product ships locally (false)');

  const shipping = buildProductMatchFromRow(
    mkRow({ id: 14, location: 'Abuja' }),
    ['Niacinamide'],
    'Lagos',
  );
  assertEqual(shipping.shipping_required, true, '2d: cross-location product requires shipping (true)');

  const allLocations = buildProductMatchFromRow(
    mkRow({ id: 15, location: 'Abuja' }),
    ['Niacinamide'],
    'All',
  );
  assertEqual(allLocations.shipping_required, false, '2d: userLocation All never requires shipping');
}

// 2e: nigerian_* fields populated from the row
{
  const p = buildProductMatchFromRow(
    mkRow({ id: 16, price_naira: 3800, source_shop: 'SkinPop Abuja' }),
    ['Niacinamide'],
    'Abuja',
  );
  assertEqual(p.nigerian_price_naira, 3800, '2e: nigerian_price_naira from row');
  assertEqual(p.nigerian_source_shop, 'SkinPop Abuja', '2e: nigerian_source_shop from row');
  assertEqual(p.nigerian_product_url, 'https://example.com/niacinamide', '2e: nigerian_product_url from row');
  assertEqual(p.price, 3800, '2e: price equals nigerian price');
}

// ─────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log(`\nErrors:`);
  for (const err of errors) {
    console.log(`  • ${err}`);
  }
}
console.log(`${'='.repeat(50)}`);
process.exit(failed > 0 ? 1 : 0);
