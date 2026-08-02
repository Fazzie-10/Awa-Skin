import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnalysisContext } from "./youcam";
import type { ProductMatch } from "./skinAnalysis";

export interface NigerianPrice {
  id: number;
  product_name: string;
  brand: string;
  price_naira: number;
  product_url: string;
  source_shop: string;
  core_step?: string;
  raw_ingredients?: string[];
  image_url?: string | null;
  location: "Lagos" | "Abuja" | "Ibadan";
}

export interface StructuredRoutine {
  cleanse: ProductMatch[];
  treat: ProductMatch[];
  moisturize: ProductMatch[];
  protect: ProductMatch[];
  alternatives: {
    cleanse: ProductMatch[];
    treat: ProductMatch[];
    moisturize: ProductMatch[];
    protect: ProductMatch[];
  };
  totalPrice: number;
  budgetTier?: string;
  summary: string;
  barrierCompromised: boolean;
  primaryConcerns: string[];
  userLocation?: string;
}

interface BudgetRange {
  min: number;
  max: number | null;
}

function budgetRange(tier: string): BudgetRange {
  switch (tier) {
    case "budget": return { min: 0, max: 18000 };
    case "balanced": return { min: 18000, max: 35000 };
    case "premium": return { min: 35000, max: null };
    default: return { min: 0, max: null };
  }
}

function qualityScore(p: ProductMatch): number {
  return p.matched_ingredients.length * 10 - (p.shipping_required ? 3 : 0);
}

export function budgetError(total: number, range: BudgetRange): number {
  if (range.max === null) {
    return Math.max(0, range.min - total); // premium: want >= min, ok to exceed
  }
  if (total < range.min) return range.min - total;
  if (total > range.max) return total - range.max;
  return 0;
}

export function pickBudgetCombo(
  byStep: Record<number, ProductMatch[]>,
  range: BudgetRange,
): { primary: Record<number, ProductMatch>; totalPrice: number } {
  const STEPS = [1, 2, 3, 4];
  const stepPools = STEPS.map(step => byStep[step].slice(0, 6));

  const fullCartesian = (arrays: ProductMatch[][], prefix: ProductMatch[] = []): ProductMatch[][] => {
    if (prefix.length === arrays.length) return [prefix.slice()];
    const out: ProductMatch[][] = [];
    for (const item of arrays[prefix.length]) {
      out.push(...fullCartesian(arrays, [...prefix, item]));
    }
    return out;
  };

  const combos = fullCartesian(stepPools);
  let best: ProductMatch[] = stepPools.map(pool => pool[0]);
  let bestErr = Infinity;
  let bestScore = -1;

  for (const combo of combos) {
    if (combo.some(p => !p)) continue;
    const total = combo.reduce((s, p) => s + p.price, 0);
    const err = budgetError(total, range);
    const quality = combo.reduce((s, p) => s + qualityScore(p), 0);
    if (err < bestErr || (err === bestErr && quality > bestScore)) {
      bestErr = err;
      bestScore = quality;
      best = combo;
    }
  }

  const primary: Record<number, ProductMatch> = {};
  STEPS.forEach((step, i) => { primary[step] = best[i]; });

  return { primary, totalPrice: best.reduce((s, p) => s + p.price, 0) };
}

function emptyRoutine(): StructuredRoutine {
  return {
    cleanse: [],
    treat: [],
    moisturize: [],
    protect: [],
    alternatives: { cleanse: [], treat: [], moisturize: [], protect: [] },
    totalPrice: 0,
    summary: "",
    barrierCompromised: false,
    primaryConcerns: [],
  };
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://acaxoayevnzuyitprwkk.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

let supabaseServer: SupabaseClient | null = null;
function getSupabase() {
  if (!supabaseServer) supabaseServer = createClient(SUPABASE_URL, SERVICE_KEY);
  return supabaseServer;
}

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

function coreStepToOrder(coreStep: string | undefined | null): number {
  if (!coreStep) return 2;
  const step = coreStep.toLowerCase().trim();
  if (step === "cleanse" || step === "clean" || step === "wash") return 1;
  if (step === "treat") return 2;
  if (step === "moisturize" || step === "moisturise" || step === "cream") return 3;
  if (step === "protect" || step === "sunscreen" || step === "spf") return 4;
  return 2;
}

function getStepOrder(name: string): number {
  const n = name.toLowerCase();
  if (n.includes("cleanser") || n.includes("wash") || n.includes("foam") || n.includes("soap")) return 1;
  if (n.includes("serum") || n.includes("treatment") || n.includes("essence") || n.includes("ampoule") || n.includes("toner") || n.includes("acid")) return 2;
  if (n.includes("moisturizer") || n.includes("cream") || n.includes("lotion") || n.includes("butter") || n.includes("emulsion")) return 3;
  if (n.includes("sunscreen") || n.includes("spf") || n.includes("sunblock") || n.includes("protect") || n.includes("sun gel")) return 4;
  return 2;
}

function getShopLocation(shop: string): "Lagos" | "Abuja" | "Ibadan" {
  const s = shop.toLowerCase();
  if (s.includes("skinpop")) return "Abuja";
  if (s.includes("ibadan")) return "Ibadan";
  return "Lagos";
}

export interface NigerianRowMatch {
  row: NigerianPrice;
  matched: string[];
}

export function buildProductMatchFromRow(
  row: NigerianPrice,
  matched: string[],
  userLocation: string,
): ProductMatch {
  const step = row.core_step
    ? coreStepToOrder(row.core_step)
    : getStepOrder(row.product_name);

  const prodLoc = row.location || "Lagos";
  const isLocal = userLocation === "All" || userLocation === prodLoc;
  const shippingRequired = !isLocal && userLocation !== "All" && userLocation !== "Other";

  let reason = row.price_naira
    ? `Available from ${row.source_shop} (${prodLoc}) — ₦${row.price_naira.toLocaleString()}`
    : `Contains ${matched.slice(0, 3).join(", ")}${matched.length > 3 ? " and more" : ""}`;

  if (shippingRequired) {
    reason += ` (🚚 Shipping from ${prodLoc})`;
  }

  return {
    id: `ng-${row.id}`,
    name: row.product_name,
    brand: row.brand || "",
    price: row.price_naira,
    product_url: row.product_url || "",
    source_website: row.source_shop,
    image_url: row.image_url ?? null,
    nigerian_price_naira: row.price_naira,
    nigerian_source_shop: row.source_shop,
    nigerian_product_url: row.product_url,
    matched_ingredients: matched,
    reason,
    step_order: step,
    location: prodLoc,
    shipping_required: shippingRequired,
  };
}

export function filterAndScoreNigerianRows(
  rows: NigerianPrice[],
  recommended: string[],
  avoid: string[] = [],
): NigerianRowMatch[] {
  const matchedIngNames = new Set(recommended.map(normalizeIngredientName).filter(Boolean));
  const avoidNorms = avoid.map(normalizeIngredientName).filter(Boolean);
  const out: NigerianRowMatch[] = [];

  for (const row of rows) {
    const rawIngs = (row.raw_ingredients || []) as string[];
    if (!rawIngs.length) continue;

    if (avoidNorms.length > 0) {
      const riNorms = rawIngs.map(normalizeIngredientName);
      const hasAvoid = avoidNorms.some(a => riNorms.includes(a));
      if (hasAvoid) continue;
    }

    const matched = rawIngs.filter(ri => {
      const riNorm = normalizeIngredientName(ri);
      return [...matchedIngNames].some(mn => riNorm.includes(mn) || mn.includes(riNorm));
    });
    if (matched.length > 0) {
      out.push({ row, matched });
    }
  }

  return out;
}

async function fetchNigerianPrices(): Promise<NigerianPrice[]> {
  const all: any[] = [];
  let from = 0;
  const PAGE = 1000;

  for (;;) {
    const { data, error } = await getSupabase()
      .from("nigerian_prices")
      .select("id, product_name, brand, price_naira, product_url, source_shop, core_step, raw_ingredients, image_url")
      .range(from, from + PAGE - 1);

    if (error || !data) {
      console.log("[Matching] Failed to fetch nigerian_prices:", error?.message);
      break;
    }

    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  return all
    .filter((item: any) => item.price_naira != null && item.price_naira > 0)
    .map(item => ({
      ...item,
      location: getShopLocation(item.source_shop || "")
    })) as NigerianPrice[];
}

export async function matchByConcerns(context: AnalysisContext): Promise<StructuredRoutine> {
  const { recommendedIngredients, ingredientsToAvoid, barrierCompromised, primaryConcerns, narrativeSummary, questionnaire } = context;
  const userLocation: string = questionnaire?.location || "All";
  const budgetTier = questionnaire?.budgetTier || "all";

  if (!recommendedIngredients.length) {
    return { ...emptyRoutine(), summary: narrativeSummary, barrierCompromised, primaryConcerns, userLocation, budgetTier };
  }

  const matchedIngNames = new Set(
    recommendedIngredients.map(normalizeIngredientName).filter(Boolean)
  );

  if (!matchedIngNames.size) {
    return { ...emptyRoutine(), summary: narrativeSummary, barrierCompromised, primaryConcerns, userLocation, budgetTier };
  }

  const prices = await fetchNigerianPrices();
  const scored = filterAndScoreNigerianRows(prices, [...matchedIngNames], ingredientsToAvoid);

  if (!scored.length) {
    console.log("[Matching] No nigerian_prices rows with raw_ingredients matched the recommended ingredients — the enrichment pipeline may not have run yet.");
    return { ...emptyRoutine(), summary: narrativeSummary, barrierCompromised, primaryConcerns, userLocation, budgetTier };
  }

  const allMatches: ProductMatch[] = scored.map(({ row, matched }) =>
    buildProductMatchFromRow(row, matched, userLocation)
  );

  // Dedup by brand+name (keep cheapest)
  const seen = new Map<string, ProductMatch>();
  for (const item of allMatches) {
    const key = `${item.brand || "?"}|${item.name.toLowerCase().trim()}`;
    const existing = seen.get(key);
    if (!existing || item.price < existing.price) {
      seen.set(key, item);
    }
  }

  const deduped = [...seen.values()]
    .sort((a, b) => {
      // 1. Step order (Cleanse -> Treat -> Moisturize -> Protect)
      if (a.step_order !== b.step_order) return a.step_order - b.step_order;
      
      // 2. Local availability priority (local items first)
      if (a.shipping_required !== b.shipping_required) {
        return a.shipping_required ? 1 : -1;
      }

      // 3. Budget tier preference
      if (budgetTier === "budget") {
        return a.price - b.price;
      } else if (budgetTier === "premium") {
        return b.price - a.price;
      }
      
      // 4. Ingredient match depth
      return b.matched_ingredients.length - a.matched_ingredients.length;
    });

  const range = budgetRange(budgetTier || "all");
  const STEPS = [1, 2, 3, 4];

  const byStep: Record<number, ProductMatch[]> = { 1: [], 2: [], 3: [], 4: [] };
  for (const p of deduped) {
    if (p.step_order >= 1 && p.step_order <= 4) byStep[p.step_order].push(p);
  }

  const { primary, totalPrice } = pickBudgetCombo(byStep, range);

  // Alternates: next-best 2-3 per step, excluding the chosen primary.
  const alternatives: Record<number, ProductMatch[]> = {};
  STEPS.forEach(step => {
    alternatives[step] = byStep[step]
      .filter(p => p.id !== primary[step]?.id)
      .sort((a, b) => qualityScore(b) - qualityScore(a))
      .slice(0, 3);
  });

  return {
    cleanse: primary[1] ? [primary[1]] : [],
    treat: primary[2] ? [primary[2]] : [],
    moisturize: primary[3] ? [primary[3]] : [],
    protect: primary[4] ? [primary[4]] : [],
    alternatives: {
      cleanse: alternatives[1],
      treat: alternatives[2],
      moisturize: alternatives[3],
      protect: alternatives[4],
    },
    totalPrice,
    summary: narrativeSummary,
    barrierCompromised,
    primaryConcerns,
    userLocation,
    budgetTier,
  };
}
