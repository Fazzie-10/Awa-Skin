import { categorizeScores, mergeContext } from '../src/lib/youcam';
import type { YouCamScores, QuestionnaireData, SeverityMap, AnalysisContext } from '../src/lib/youcam';

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

// ─────────────────────────────────────────────────────
// Test group 1: categorizeScores()
// ─────────────────────────────────────────────────────
console.log('\n=== categorizeScores() ===');

// Test 1a: Score 85 → severe
{
  const scores: YouCamScores = { acne: 85, pigmentation: 0, pores: 0, texture: 0, redness: 0, oiliness: 0, radiance: 0, wrinkles: 0, darkCircles: 0 };
  const result = categorizeScores(scores);
  assertEqual(result.acne.tier, 'severe', 'acne=85 should be severe');
}

// Test 1b: Score 55 → moderate
{
  const scores: YouCamScores = { acne: 55, pigmentation: 0, pores: 0, texture: 0, redness: 0, oiliness: 0, radiance: 0, wrinkles: 0, darkCircles: 0 };
  const result = categorizeScores(scores);
  assertEqual(result.acne.tier, 'moderate', 'acne=55 should be moderate');
}

// Test 1c: Score 20 → mild
{
  const scores: YouCamScores = { acne: 20, pigmentation: 0, pores: 0, texture: 0, redness: 0, oiliness: 0, radiance: 0, wrinkles: 0, darkCircles: 0 };
  const result = categorizeScores(scores);
  assertEqual(result.acne.tier, 'mild', 'acne=20 should be mild');
}

// Test 1d: Edge score 70 → moderate (boundary, not >70)
{
  const scores: YouCamScores = { acne: 70, pigmentation: 40, pores: 0, texture: 0, redness: 0, oiliness: 0, radiance: 0, wrinkles: 0, darkCircles: 0 };
  const result = categorizeScores(scores);
  assertEqual(result.acne.tier, 'moderate', 'acne=70 should be moderate (boundary)');
  assertEqual(result.pigmentation.tier, 'moderate', 'pigmentation=40 should be moderate (boundary)');
}

// Test 1e: Edge score 40 → moderate (boundary, >=40)
{
  const scores: YouCamScores = { acne: 40, pigmentation: 0, pores: 0, texture: 0, redness: 0, oiliness: 0, radiance: 0, wrinkles: 0, darkCircles: 0 };
  const result = categorizeScores(scores);
  assertEqual(result.acne.tier, 'moderate', 'acne=40 should be moderate (boundary)');
}

// Test 1f: All metrics categorized correctly
{
  const scores: YouCamScores = { acne: 85, pigmentation: 55, pores: 30, texture: 10, redness: 70, oiliness: 40, radiance: 0, wrinkles: 0, darkCircles: 0 };
  const result = categorizeScores(scores);
  assertEqual(result.acne.tier, 'severe', 'all: acne=85 severe');
  assertEqual(result.pigmentation.tier, 'moderate', 'all: pigmentation=55 moderate');
  assertEqual(result.pores.tier, 'mild', 'all: pores=30 mild');
  assertEqual(result.texture.tier, 'mild', 'all: texture=10 mild');
  assertEqual(result.redness.tier, 'moderate', 'all: redness=70 moderate');
  assertEqual(result.oiliness.tier, 'moderate', 'all: oiliness=40 moderate');
}

// ─────────────────────────────────────────────────────
// Test group 2: mergeContext()
// ─────────────────────────────────────────────────────
console.log('\n=== mergeContext() ===');

const baseScores: YouCamScores = { acne: 80, pigmentation: 30, pores: 30, texture: 20, redness: 20, oiliness: 40, radiance: 0, wrinkles: 0, darkCircles: 0 };
const baseQ: QuestionnaireData = { skinTightness: 0, stinging: false, oiliness: 'oily', sensitivity: false, currentRoutine: [], concerns: ['acne'] };

// Helper for building high-acne severity
function severityForAcne(score: number): SeverityMap {
  return categorizeScores({ ...baseScores, acne: score });
}

// Test 2a: High acne (80) + stinging=true → barrierCompromised=true → barrier soothing, harsh acids avoided
{
  const q = { ...baseQ, stinging: true };
  const severity = severityForAcne(80);
  const ctx = mergeContext({
    scores: { ...baseScores, acne: 80 },
    severity,
    questionnaire: q,
    geminiRecommended: ['Retinol', 'Niacinamide'],
    geminiAvoid: ['Alcohol'],
    geminiSummary: 'Test summary',
    geminiConcerns: ['acne'],
  });
  assert(ctx.barrierCompromised === true, '2a: barrierCompromised should be true (acne=severe + stinging)');
  assert(ctx.recommendedIngredients.includes('Centella Asiatica'), '2a: should include barrier soothing ingredient Centella Asiatica');
  assert(ctx.recommendedIngredients.includes('Ceramide'), '2a: should include barrier soothing ingredient Ceramide');
  assert(!ctx.recommendedIngredients.includes('Salicylic Acid'), '2a: should NOT include Salicylic Acid (barrier avoid)');
  assert(!ctx.recommendedIngredients.includes('Glycolic Acid'), '2a: should NOT include Glycolic Acid (barrier avoid)');
  assert(!ctx.recommendedIngredients.includes('Retinol'), '2a: should NOT include Retinol (barrier avoid, filtered from geminiRecommended)');
  assert(ctx.ingredientsToAvoid.includes('Alcohol'), '2a: should include geminiAvoid items');
  assert(ctx.ingredientsToAvoid.includes('Salicylic Acid'), '2a: should include BARRIER_AVOID item Salicylic Acid');
  // Niacinamide IS in BARRIER_SOOTHING so it should be included
  assert(ctx.recommendedIngredients.includes('Niacinamide'), '2a: Niacinamide should be included (it is in BARRIER_SOOTHING)');
}

// Test 2b: High acne (80) + stinging=false → barrierCompromised=false → standard ingredients
{
  const q = { ...baseQ, stinging: false, skinTightness: 0 };
  const severity = severityForAcne(80);
  const ctx = mergeContext({
    scores: { ...baseScores, acne: 80 },
    severity,
    questionnaire: q,
    geminiRecommended: ['Niacinamide', 'Salicylic Acid'],
    geminiAvoid: ['Alcohol'],
    geminiSummary: 'Test summary',
    geminiConcerns: ['acne'],
  });
  assert(ctx.barrierCompromised === false, '2b: barrierCompromised should be false (acne=severe + no stinging)');
  assert(ctx.recommendedIngredients.includes('Niacinamide'), '2b: should include geminiRecommended Niacinamide');
  assert(ctx.recommendedIngredients.includes('Salicylic Acid'), '2b: should include geminiRecommended Salicylic Acid');
  assert(ctx.recommendedIngredients.includes('Benzoyl Peroxide'), '2b: should include concern-based ingredient Benzoyl Peroxide (acne concern)');
  assert(ctx.ingredientsToAvoid.includes('Alcohol'), '2b: should include geminiAvoid items');
  assert(!ctx.ingredientsToAvoid.includes('Salicylic Acid'), '2b: should NOT include BARRIER_AVOID items in non-barrier mode');
}

// Test 2c: Low acne (20) + stinging=true → barrierCompromised=false (only moderate+ triggers it)
{
  const q = { ...baseQ, stinging: true, skinTightness: 5 };
  const severity = severityForAcne(20);
  const ctx = mergeContext({
    scores: { ...baseScores, acne: 20 },
    severity,
    questionnaire: q,
    geminiRecommended: ['Niacinamide'],
    geminiAvoid: [],
    geminiSummary: 'Test summary',
    geminiConcerns: [],
  });
  assert(ctx.barrierCompromised === false, '2c: barrierCompromised should be false (acne=mild, even with stinging)');
  // since geminiConcerns is empty and all severity tiers are mild, primaryConcerns should be from severity filter
  // but wait - if all severity is mild, the fallback lists none, so primaryConcerns = geminiConcerns = []
  // That's correct behavior - no concerns identified
}

// Test 2d: Merge preserves gemini recommended + adds concern-based ingredients
{
  const q = { ...baseQ, stinging: false };
  const severity = severityForAcne(80);
  const ctx = mergeContext({
    scores: { ...baseScores, acne: 80, pigmentation: 55 },
    severity,
    questionnaire: q,
    geminiRecommended: ['Niacinamide'],
    geminiAvoid: [],
    geminiSummary: 'Your skin shows signs of congestion.',
    geminiConcerns: ['acne', 'pigmentation'],
  });
  assert(ctx.recommendedIngredients.includes('Niacinamide'), '2d: should preserve geminiRecommended Niacinamide');
  assert(ctx.recommendedIngredients.includes('Salicylic Acid'), '2d: should add concern-based Salicylic Acid (acne)');
  assert(ctx.recommendedIngredients.includes('Alpha-Arbutin'), '2d: should add concern-based Alpha-Arbutin (pigmentation)');
  assert(ctx.primaryConcerns.includes('acne'), '2d: should have acne in primaryConcerns');
  assert(ctx.primaryConcerns.includes('pigmentation'), '2d: should have pigmentation in primaryConcerns');
  assert(ctx.narrativeSummary.includes('Your skin shows signs of congestion.'), '2d: should include gemini summary in narrative');
}

// Test 2e: skinTightness >= 3 triggers barrierCompromised even without stinging
{
  const q = { ...baseQ, stinging: false, skinTightness: 4 };
  const severity = severityForAcne(75);
  const ctx = mergeContext({
    scores: { ...baseScores, acne: 75 },
    severity,
    questionnaire: q,
    geminiRecommended: [],
    geminiAvoid: [],
    geminiSummary: '',
    geminiConcerns: [],
  });
  assert(ctx.barrierCompromised === true, '2e: barrierCompromised should be true (acne=severe + skinTightness>=3)');
}

// ─────────────────────────────────────────────────────
// Test group 3: matchByConcerns() — isolated pure logic
// These are the standalone helper functions from matching.ts
// ─────────────────────────────────────────────────────
console.log('\n=== matchByConcerns() sub-functions ===');

// --- normalizeIngredientName ---
function normalizeIngredientName(raw: string): string {
  return raw
    .replace(/\s*\(.*?\)\s*/g, "")
    .replace(/\s*\[.*?\]\s*/g, "")
    .replace(/[?#!]/g, "")
    .replace(/\s*\d+%\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

assertEqual(normalizeIngredientName("Salicylic Acid (BHA)"), "salicylic acid", 'normalize: strip parenthetical');
assertEqual(normalizeIngredientName("Niacinamide 10%"), "niacinamide", 'normalize: strip percentage');
assertEqual(normalizeIngredientName("L-Ascorbic Acid [Vitamin C]"), "l-ascorbic acid", 'normalize: strip brackets');
assertEqual(normalizeIngredientName("  Salicylic   Acid  "), "salicylic acid", 'normalize: collapse whitespace');

// --- coreStepToOrder ---
function coreStepToOrder(coreStep: string | undefined | null): number {
  if (!coreStep) return 2;
  const stepMap: Record<string, number> = {
    cleanse: 1, clean: 1, wash: 1,
    treat: 2, moisturize: 3, moisturise: 3, cream: 3,
    protect: 4, sunscreen: 4, spf: 4,
  };
  return stepMap[coreStep.toLowerCase().trim()] || 2;
}

assertEqual(coreStepToOrder('cleanse'), 1, 'coreStepToOrder: cleanse -> 1');
assertEqual(coreStepToOrder('treat'), 2, 'coreStepToOrder: treat -> 2');
assertEqual(coreStepToOrder('moisturize'), 3, 'coreStepToOrder: moisturize -> 3');
assertEqual(coreStepToOrder('protect'), 4, 'coreStepToOrder: protect -> 4');
assertEqual(coreStepToOrder(undefined), 2, 'coreStepToOrder: undefined -> 2');
assertEqual(coreStepToOrder(null), 2, 'coreStepToOrder: null -> 2');
assertEqual(coreStepToOrder('unknown'), 2, 'coreStepToOrder: unknown -> 2');

// --- getStepOrder ---
function getStepOrder(name: string): number {
  const n = name.toLowerCase();
  if (n.includes('cleanser') || n.includes('wash') || n.includes('foam') || n.includes('toner')) return 1;
  if (n.includes('serum') || n.includes('treatment') || n.includes('essence') || n.includes('ampoule')) return 2;
  if (n.includes('moisturizer') || n.includes('cream') || n.includes('lotion')) return 3;
  if (n.includes('sunscreen') || n.includes('spf') || n.includes('sunblock') || n.includes('protect')) return 4;
  return 2;
}

assertEqual(getStepOrder('Gentle Foaming Cleanser'), 1, 'getStepOrder: cleanser -> 1');
assertEqual(getStepOrder('Niacinamide Serum'), 2, 'getStepOrder: serum -> 2');
assertEqual(getStepOrder('Moisturizing Cream'), 3, 'getStepOrder: cream -> 3');
assertEqual(getStepOrder('SPF 50 Sunscreen'), 4, 'getStepOrder: sunscreen -> 4');
assertEqual(getStepOrder('Random Product'), 2, 'getStepOrder: unknown -> 2');

// --- nameMatchScore ---
function normalizeForPriceMatch(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameMatchScore(productName: string, priceName: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const p = normalize(productName);
  const np = normalize(priceName);
  if (p.includes(np) || np.includes(p)) return 1.0;
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'for', 'with', 'by', 'skin', 'care', 'face']);
  const pWords = p.split(' ').filter(w => w.length > 2 && !stopWords.has(w));
  const npWords = np.split(' ').filter(w => w.length > 2 && !stopWords.has(w));
  let intersection = 0;
  for (const w of pWords) {
    if (npWords.includes(w)) intersection++;
  }
  const minSize = Math.min(pWords.length, npWords.length);
  return minSize > 0 ? intersection / minSize : 0;
}

assertEqual(nameMatchScore('Cerave Moisturizing Cream', 'Cerave Moisturizing Cream'), 1.0, 'nameMatchScore: exact match -> 1.0');
assertEqual(nameMatchScore('Cerave Moisturizing Cream 50ml', 'Cerave Moisturizing Cream'), 1.0, 'nameMatchScore: substring match -> 1.0');
assertEqual(nameMatchScore('Product A Face Wash', 'Product B Face Wash'), 1.0, 'nameMatchScore: partial match (stop/short words filtered, meaningful words identical)');
assertEqual(nameMatchScore('Hydrating Cleanser', 'Moisturizing Cream'), 0, 'nameMatchScore: no shared meaningful words -> 0');
assertEqual(nameMatchScore('Lip Balm', 'Moisturizing Cream'), 0, 'nameMatchScore: no match -> 0');

// --- Dedup + grouping logic (core of matchByConcerns output) ---
console.log('\n=== matchByConcerns: dedup + grouping ===');

interface ProductMatch {
  id: string;
  name: string;
  brand: string;
  price: number;
  matched_ingredients: string[];
  step_order: number;
}

// Simulate products before dedup
const mockProducts: ProductMatch[] = [
  { id: 'p1', name: 'Niacinamide Serum 10%', brand: 'Brand A', price: 5000, matched_ingredients: ['Niacinamide'], step_order: 2 },
  { id: 'p2', name: 'Niacinamide Serum 10%', brand: 'Brand A', price: 4500, matched_ingredients: ['Niacinamide'], step_order: 2 },
  { id: 'p3', name: 'Gentle Foaming Cleanser', brand: 'Brand B', price: 3000, matched_ingredients: ['Salicylic Acid'], step_order: 1 },
  { id: 'p4', name: 'Vitamin C Brightening Serum', brand: 'Brand C', price: 8000, matched_ingredients: ['Ascorbic Acid'], step_order: 2 },
  { id: 'p5', name: 'SPF 50 Sunscreen', brand: 'Brand D', price: 6000, matched_ingredients: ['Zinc'], step_order: 4 },
];

// Dedup by brand+name (keep cheapest)
const seen = new Map<string, ProductMatch>();
for (const item of mockProducts) {
  const key = `${item.brand || '?'}|${item.name.toLowerCase().trim()}`;
  const existing = seen.get(key);
  if (!existing || item.price < existing.price) {
    seen.set(key, item);
  }
}

const deduped = [...seen.values()].sort((a, b) => {
  if (a.step_order !== b.step_order) return a.step_order - b.step_order;
  if (a.price !== b.price) return a.price - b.price;
  return b.matched_ingredients.length - a.matched_ingredients.length;
});

assertEqual(deduped.length, 4, 'dedup: 5 products -> 4 unique after dedup (Brand A serum deduped)');
assert(deduped[0].step_order === 1, 'dedup: first item is step 1 (cleanse)');
assert(deduped[1].step_order === 2, 'dedup: second item is step 2 (treat)');
assert(deduped[2].step_order === 2, 'dedup: third item is step 2 (treat)');
assert(deduped[3].step_order === 4, 'dedup: fourth item is step 4 (protect)');

// Verify cheapest was kept for Brand A
const brandASerums = deduped.filter(p => p.brand === 'Brand A' && p.name.includes('Niacinamide'));
assertEqual(brandASerums.length, 1, 'dedup: only one Brand A Niacinamide Serum remains');
assertEqual(brandASerums[0].price, 4500, 'dedup: kept cheapest (4500, not 5000)');

// Group into cleanse/treat/protect
const cleanse = deduped.filter(p => p.step_order === 1).slice(0, 4);
const treat = deduped.filter(p => p.step_order === 2 || p.step_order === 3).slice(0, 8);
const protect = deduped.filter(p => p.step_order >= 4).slice(0, 4);

assertEqual(cleanse.length, 1, 'group: 1 cleanse product');
assertEqual(treat.length, 2, 'group: 2 treat products');
assertEqual(protect.length, 1, 'group: 1 protect product');

// Test ingredientsToAvoid filtering
console.log('\n=== matchByConcerns: ingredientsToAvoid filtering ===');

const mockIngredients = [{ id: 'i1', name: 'Salicylic Acid' }];
const avoidNorms = ['salicylic acid'];
const rawIngs1 = ['Water', 'Salicylic Acid', 'Glycerin'];
const riNorms1 = rawIngs1.map(normalizeIngredientName);
const hasAvoid1 = avoidNorms.some(a => riNorms1.includes(a));
assert(hasAvoid1 === true, 'avoid: product with Salicylic Acid should be filtered out');

const rawIngs2 = ['Water', 'Niacinamide', 'Glycerin'];
const riNorms2 = rawIngs2.map(normalizeIngredientName);
const hasAvoid2 = avoidNorms.some(a => riNorms2.includes(a));
assert(hasAvoid2 === false, 'avoid: product without Salicylic Acid should pass');

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
