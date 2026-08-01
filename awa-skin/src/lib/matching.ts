import { createClient } from "@supabase/supabase-js";
import type { AnalysisContext } from "./youcam";
import type { ProductMatch } from "./skinAnalysis";

interface NigerianPrice {
  product_name: string;
  brand: string;
  price_naira: number;
  product_url: string;
  source_shop: string;
  core_step?: string;
  location: "Lagos" | "Abuja";
}

export interface StructuredRoutine {
  cleanse: ProductMatch[];
  treat: ProductMatch[];
  moisturize: ProductMatch[];
  protect: ProductMatch[];
  summary: string;
  barrierCompromised: boolean;
  primaryConcerns: string[];
  userLocation?: string;
  budgetTier?: string;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://acaxoayevnzuyitprwkk.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const supabaseServer = createClient(SUPABASE_URL, SERVICE_KEY);

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

function nameMatchScore(productName: string, priceName: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const p = normalize(productName);
  const np = normalize(priceName);
  if (p.includes(np) || np.includes(p)) return 1.0;
  const stopWords = new Set(["the", "a", "an", "and", "or", "for", "with", "by", "skin", "care", "face"]);
  const pWords = p.split(" ").filter(w => w.length > 2 && !stopWords.has(w));
  const npWords = np.split(" ").filter(w => w.length > 2 && !stopWords.has(w));
  let intersection = 0;
  for (const w of pWords) {
    if (npWords.includes(w)) intersection++;
  }
  const minSize = Math.min(pWords.length, npWords.length);
  return minSize > 0 ? intersection / minSize : 0;
}

function getStepOrder(name: string): number {
  const n = name.toLowerCase();
  if (n.includes("cleanser") || n.includes("wash") || n.includes("foam") || n.includes("soap")) return 1;
  if (n.includes("serum") || n.includes("treatment") || n.includes("essence") || n.includes("ampoule") || n.includes("toner") || n.includes("acid")) return 2;
  if (n.includes("moisturizer") || n.includes("cream") || n.includes("lotion") || n.includes("butter") || n.includes("emulsion")) return 3;
  if (n.includes("sunscreen") || n.includes("spf") || n.includes("sunblock") || n.includes("protect") || n.includes("sun gel")) return 4;
  return 2;
}

function getShopLocation(shop: string): "Lagos" | "Abuja" {
  if (shop.toLowerCase().includes("skinpop")) return "Abuja";
  return "Lagos";
}

async function fetchNigerianPrices(): Promise<NigerianPrice[]> {
  const { data, error } = await supabaseServer
    .from("nigerian_prices")
    .select("product_name, brand, price_naira, product_url, source_shop, core_step");
  
  if (error || !data) {
    console.log("[Matching] Failed to fetch nigerian_prices:", error?.message);
    return [];
  }
  
  return data.map(item => ({
    ...item,
    location: getShopLocation(item.source_shop || "")
  })) as NigerianPrice[];
}

export async function matchByConcerns(context: AnalysisContext): Promise<StructuredRoutine> {
  const { recommendedIngredients, ingredientsToAvoid, barrierCompromised, primaryConcerns, narrativeSummary, questionnaire } = context;
  const userLocation: string = questionnaire?.location || "All";
  const budgetTier = questionnaire?.budgetTier || "all";

  if (!recommendedIngredients.length) {
    return { cleanse: [], treat: [], moisturize: [], protect: [], summary: narrativeSummary, barrierCompromised, primaryConcerns, userLocation, budgetTier };
  }

  const normalized = recommendedIngredients.map(normalizeIngredientName).filter(Boolean);
  const uniqueNormalized = [...new Set(normalized)];
  const avoidNorms = ingredientsToAvoid.map(normalizeIngredientName).filter(Boolean);

  const { data: allDbIngredients, error: ingErr } = await supabaseServer
    .from("ingredients")
    .select("id, name");

  if (ingErr || !allDbIngredients?.length) {
    console.log("[Matching] No ingredients table:", ingErr?.message);
    return { cleanse: [], treat: [], moisturize: [], protect: [], summary: narrativeSummary, barrierCompromised, primaryConcerns, userLocation, budgetTier };
  }

  const matchedIngNames = new Set<string>();
  for (const norm of uniqueNormalized) {
    for (const dbIng of allDbIngredients) {
      const dbNorm = normalizeIngredientName(dbIng.name);
      if (dbNorm === norm || dbNorm.includes(norm) || norm.includes(dbNorm)) {
        matchedIngNames.add(dbIng.name.toLowerCase());
      }
    }
  }

  if (!matchedIngNames.size) {
    return { cleanse: [], treat: [], moisturize: [], protect: [], summary: narrativeSummary, barrierCompromised, primaryConcerns, userLocation, budgetTier };
  }

  const { data: allProducts, error: prodErr } = await supabaseServer
    .from("products")
    .select("id, name, brand, category, product_url, source_website, price, raw_ingredients");

  if (prodErr || !allProducts?.length) {
    console.log("[Matching] No products:", prodErr?.message);
    return { cleanse: [], treat: [], moisturize: [], protect: [], summary: narrativeSummary, barrierCompromised, primaryConcerns, userLocation, budgetTier };
  }

  const matchedProducts: Array<{ product: typeof allProducts[0], matched: string[] }> = [];
  for (const product of allProducts) {
    const rawIngs = (product.raw_ingredients || []) as string[];

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
      matchedProducts.push({ product, matched });
    }
  }

  if (!matchedProducts.length) {
    return { cleanse: [], treat: [], moisturize: [], protect: [], summary: narrativeSummary, barrierCompromised, primaryConcerns, userLocation, budgetTier };
  }

  const prices = await fetchNigerianPrices();
  const priceByProductId = new Map<string, NigerianPrice>();

  for (const { product } of matchedProducts) {
    let bestScore = 0;
    let bestPrice: NigerianPrice | undefined;
    for (const price of prices) {
      const score = nameMatchScore(product.name, price.product_name);
      if (score > bestScore) {
        bestScore = score;
        bestPrice = price;
      }
    }
    if (bestPrice && bestScore > 0.3) {
      priceByProductId.set(product.id, bestPrice);
    }
  }

  const allMatches: ProductMatch[] = matchedProducts.map(({ product, matched }) => {
    const ngPrice = priceByProductId.get(product.id);
    const step = ngPrice?.core_step
      ? coreStepToOrder(ngPrice.core_step)
      : getStepOrder(product.name);

    const prodLoc = ngPrice?.location || "Lagos";
    const isLocal = userLocation === "All" || userLocation === prodLoc;
    const shippingRequired = !isLocal && userLocation !== "All" && userLocation !== "Other";

    let reason = ngPrice
      ? `Available from ${ngPrice.source_shop} (${prodLoc}) — ₦${ngPrice.price_naira.toLocaleString()}`
      : `Contains ${matched.slice(0, 3).join(", ")}${matched.length > 3 ? " and more" : ""}`;

    if (shippingRequired) {
      reason += ` (🚚 Shipping from ${prodLoc})`;
    }

    return {
      id: product.id,
      name: product.name,
      brand: product.brand || "",
      price: ngPrice?.price_naira || product.price || 0,
      product_url: ngPrice?.product_url || product.product_url || "",
      source_website: ngPrice?.source_shop || product.source_website || "",
      nigerian_price_naira: ngPrice?.price_naira,
      nigerian_source_shop: ngPrice?.source_shop,
      nigerian_product_url: ngPrice?.product_url,
      matched_ingredients: matched,
      reason,
      step_order: step,
      location: prodLoc,
      shipping_required: shippingRequired,
    };
  });

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

  const cleanse = deduped.filter(p => p.step_order === 1).slice(0, 4);
  const treat = deduped.filter(p => p.step_order === 2).slice(0, 6);
  const moisturize = deduped.filter(p => p.step_order === 3).slice(0, 4);
  const protect = deduped.filter(p => p.step_order === 4).slice(0, 4);

  return {
    cleanse,
    treat,
    moisturize,
    protect,
    summary: narrativeSummary,
    barrierCompromised,
    primaryConcerns,
    userLocation,
    budgetTier,
  };
}
