"use server";

import { createClient } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import nigerianPricesRaw from "../data/nigerian_prices.json";

interface NigerianPrice {
  product_name: string;
  brand: string;
  price_naira: number;
  product_url: string;
  source_shop: string;
  core_step?: string;
}

const nigerianPrices = nigerianPricesRaw as NigerianPrice[];

const supabaseServer = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface PerfectCorpScores {
  acne: number;
  pigmentation: number;
  texture: number;
  pores: number;
  redness: number;
  oiliness: number;
  radiance: number;
  wrinkles: number;
  darkCircles: number;
  fitzpatrickEstimate: string | null;
  rawResponse: unknown;
}

export interface GeminiAnalysis {
  skinType: string;
  fitzpatrickRange: string;
  primaryConcerns: string[];
  acneSeverity: "none" | "mild" | "moderate" | "severe";
  pigmentationType: "none" | "mild-PIH" | "moderate-PIH" | "severe-PIH";
  recommendedIngredients: string[];
  ingredientsToAvoid: string[];
  morningRoutineSteps: string[];
  eveningRoutineSteps: string[];
  narrativeSummary: string;
  confidenceNote: string;
  rawResponse: unknown;
}

export interface QuestionnaireData {
  skinTightness: number | null;
  stinging: boolean | null;
  oiliness: "dry" | "normal" | "oily" | "combination" | null;
  sensitivity: boolean | null;
  currentRoutine: string[];
  concerns: string[];
  location?: "Lagos" | "Abuja" | "Other" | null;
  budgetTier?: "budget" | "balanced" | "premium" | null;
}

export interface ProductMatch {
  id: string;
  name: string;
  brand: string;
  price: number;
  product_url: string;
  source_website: string;
  matched_ingredients: string[];
  reason: string;
  step_order: number;
  nigerian_price_naira?: number;
  nigerian_source_shop?: string;
  nigerian_product_url?: string;
  location?: "Lagos" | "Abuja" | "Unknown";
  shipping_required?: boolean;
}

export interface SkinAnalysisResult {
  perfectCorpScores: PerfectCorpScores | null;
  geminiAnalysis: GeminiAnalysis | null;
  productRecommendations: ProductMatch[];
  error: string | null;
  usedFallback: boolean;
}

const PERFECT_CORP_BASE = "https://yce-api-01.makeupar.com";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent";

const SYSTEM_PROMPT_BASE = `You are a skin analysis assistant for AWA SKIN, a Nigerian skincare app. You analyze selfies and return structured skincare recommendations calibrated for Nigerian and West African skin tones.

CRITICAL CONTEXT:
- Your users are Nigerian and West African, spanning Fitzpatrick Types III through VI
- Estimate the user's Fitzpatrick type from the selfie and calibrate your recommendations accordingly:
- Type III — Half-cast or mixed heritage Nigerians, light-medium skin. PIH appears pinkish-red and fades faster. Can tolerate glycolic acid and moderate-strength actives.
- Type IV — Medium brown skin. Most common Nigerian skin tone. PIH appears brown with moderate persistence. Standard ingredient strengths apply.
- Type V — Dark brown skin. Very common across Nigeria. PIH appears deep brown or grey-brown, persists for months. Use gentler acids — lactic acid or mandelic acid over glycolic acid.
- Type VI — Very deep/dark skin. Common in Northern Nigeria and South-South. PIH appears very dark grey-brown, can persist for 6-12 months without treatment. Avoid all strong exfoliating acids. Prioritise niacinamide, azelaic acid, tranexamic acid, and alpha-arbutin only.
- Always state which Fitzpatrick type you estimated in the fitzpatrickRange field of your JSON response (e.g. "III", "IV", "V", "V-VI").

AVAILABLE SKIN ANALYSIS SCORES (from Perfect Corp API):
[INSERT SCORES HERE]

QUESTIONNAIRE DATA:
[INSERT QUESTIONNAIRE DATA HERE]

CRITICAL FORMATTING RULE: For recommendedIngredients and ingredientsToAvoid, use ONLY standard INCI names. NO parentheses, NO annotations, NO concentrations. Examples: "Salicylic Acid" not "Salicylic Acid (BHA)", "Niacinamide" not "Niacinamide (Vitamin B3)", "Ascorbic Acid" not "Vitamin C (L-Ascorbic Acid)", "Azelaic Acid" not "Azelaic Acid 10%".

MULTI-ANGLE ANALYSIS: Three images are provided — front view, right side, and left side. Compare both sides of the face for asymmetrical acne, pigmentation, or texture differences. Incorporate any side-specific findings into your recommendations.

Analyze the selfie image provided. Return ONLY valid JSON, no markdown, no explanation outside the JSON. Use this exact schema:
{
  "skinType": "string",
  "fitzpatrickRange": "string (e.g. IV-V)",
  "primaryConcerns": ["string"],
  "acneSeverity": "none|mild|moderate|severe",
  "pigmentationType": "none|mild-PIH|moderate-PIH|severe-PIH",
  "recommendedIngredients": ["string — INCI names only, no parentheses/annotations"],
  "ingredientsToAvoid": ["string"],
  "morningRoutineSteps": ["string"],
  "eveningRoutineSteps": ["string"],
  "narrativeSummary": "string (2-3 plain English sentences the user will read)",
  "confidenceNote": "string (honest note: this is AI, not a dermatologist)"
}`;

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

function buildPrompt(scores: PerfectCorpScores | null, q: QuestionnaireData): string {
  const scoresText = scores
    ? JSON.stringify(scores, null, 2)
    : "Not available - analyze from image only";
  const qText = JSON.stringify(q, null, 2);
  return SYSTEM_PROMPT_BASE
    .replace("[INSERT SCORES HERE]", scoresText)
    .replace("[INSERT QUESTIONNAIRE DATA HERE]", qText);
}

const PC_SCORE_MAP: Record<string, keyof PerfectCorpScores> = {
  acne: "acne",
  pore: "pores",
  texture: "texture",
  redness: "redness",
  oiliness: "oiliness",
  radiance: "radiance",
  wrinkle: "wrinkles",
  dark_circle_v2: "darkCircles",
  age_spot: "pigmentation",
};
const PC_ACTIONS = Object.keys(PC_SCORE_MAP);

async function fetchWithBackoff(url: string, init: RequestInit, retries = 3): Promise<Response> {
  let delay = 1000;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init);
    if (res.status !== 429 || attempt >= retries) return res;
    await new Promise(r => setTimeout(r, delay));
    delay *= 2;
  }
}

export async function callPerfectCorp(base64Image: string): Promise<PerfectCorpScores | null> {
  const appKey = process.env.PERFECTCORP_APP_KEY;
  if (!appKey) {
    console.log("[Perfect Corp] Missing API key, skipping");
    return null;
  }

  const base64Data = base64Image.includes(",") ? base64Image.split(",")[1] : base64Image;
  const binary = Buffer.from(base64Data, "base64");
  const controller = new AbortController();
  const totalTimeout = setTimeout(() => controller.abort(), 120000);

  const authHeaders = { "Authorization": `Bearer ${appKey}` };

  try {
    // Step 1: Register file metadata
    console.log("[Perfect Corp] Step 1: Registering file metadata");
    const fileRes = await fetchWithBackoff(`${PERFECT_CORP_BASE}/s2s/v2.0/file/skin-analysis`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        files: [{
          content_type: "image/jpeg",
          file_name: "selfie.jpg",
          file_size: binary.length,
        }],
      }),
    });

    if (fileRes.status === 401 || fileRes.status === 403) {
      console.log("[Perfect Corp] Auth failed (401/403), using fallback");
      return null;
    }
    if (fileRes.status === 429) {
      console.log("[Perfect Corp] Rate limited, using fallback");
      return null;
    }
    if (!fileRes.ok) {
      const errBody = await fileRes.text().catch(() => "");
      console.log(`[Perfect Corp] File request failed: HTTP ${fileRes.status} ${errBody.slice(0, 200)}`);
      return null;
    }

    const fileJson = await fileRes.json();
    const fileInfo = fileJson?.data?.files?.[0];
    const fileId: string | undefined = fileInfo?.file_id;
    const uploadReq = fileInfo?.requests?.[0];

    if (!fileId || !uploadReq?.url) {
      console.log("[Perfect Corp] Missing fileId/uploadUrl in response:", JSON.stringify(fileJson).slice(0, 300));
      return null;
    }

    // Step 2: Upload binary using exact method + headers from response
    console.log("[Perfect Corp] Step 2: Uploading to pre-signed URL");
    const uploadRes = await fetch(uploadReq.url, {
      method: uploadReq.method || "PUT",
      signal: controller.signal,
      headers: { ...(uploadReq.headers || {}), "Content-Type": "image/jpeg" },
      body: binary,
    });

    if (!uploadRes.ok) {
      console.log(`[Perfect Corp] Upload failed: HTTP ${uploadRes.status}`);
      return null;
    }

    // Step 3: Start analysis task
    console.log("[Perfect Corp] Step 3: Starting analysis task");
    const taskRes = await fetchWithBackoff(`${PERFECT_CORP_BASE}/s2s/v2.0/task/skin-analysis`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        src_file_id: fileId,
        dst_actions: PC_ACTIONS,
        format: "json",
      }),
    });

    if (!taskRes.ok) {
      const errBody = await taskRes.text().catch(() => "");
      console.log(`[Perfect Corp] Task creation failed: HTTP ${taskRes.status} ${errBody.slice(0, 200)}`);
      return null;
    }

    const taskJson = await taskRes.json();
    const taskId: string | undefined = taskJson?.data?.task_id;

    if (!taskId) {
      console.log("[Perfect Corp] Missing taskId:", JSON.stringify(taskJson).slice(0, 300));
      return null;
    }

    // Step 4: Poll for results (every 3s, up to 120s). Results are retained 24h.
    console.log("[Perfect Corp] Step 4: Polling for results");
    const pollStart = Date.now();
    const POLL_MS = 120_000;
    let output: Record<string, any>[] | null = null;
    let lastStatus: string | undefined;

    while (Date.now() - pollStart < POLL_MS) {
      await new Promise(r => setTimeout(r, 3000));
      if (controller.signal.aborted) break;

      const pollRes = await fetchWithBackoff(
        `${PERFECT_CORP_BASE}/s2s/v2.0/task/skin-analysis/${taskId}`,
        { method: "GET", signal: controller.signal, headers: authHeaders },
      );

      if (!pollRes.ok) {
        console.log(`[Perfect Corp] Poll failed: HTTP ${pollRes.status}`);
        break;
      }

      const pollJson = await pollRes.json();
      const status = pollJson?.data?.task_status;
      lastStatus = status;

      if (status === "success") {
        output = pollJson?.data?.results?.output ?? [];
        break;
      }
      if (status === "failed" || status === "error") {
        const errData = pollJson?.data ?? pollJson;
        console.log("[Perfect Corp] Task failed/error:", JSON.stringify({
          task_status: status,
          error: errData.error,
          error_message: errData.error_message,
          results: errData.results,
        }));
        return null;
      }
    }

    if (!output) {
      console.log(`[Perfect Corp] Polling timed out or no result (last status: ${lastStatus ?? "unknown"})`);
      return null;
    }

    // Build scores from output[] array
    const scores: Partial<PerfectCorpScores> = { rawResponse: output };
    for (const item of output) {
      const key = PC_SCORE_MAP[item.type];
      if (key) {
        (scores as any)[key] = item.ui_score ?? item.score ?? 0;
      }
      if (item.type === "fitzpatrick") {
        scores.fitzpatrickEstimate = String(item.score ?? item.value ?? "");
      }
    }

    console.log("[Perfect Corp] Analysis complete");
    return {
      acne: scores.acne ?? 0,
      pigmentation: scores.pigmentation ?? 0,
      texture: scores.texture ?? 0,
      pores: scores.pores ?? 0,
      redness: scores.redness ?? 0,
      oiliness: scores.oiliness ?? 0,
      radiance: scores.radiance ?? 0,
      wrinkles: scores.wrinkles ?? 0,
      darkCircles: scores.darkCircles ?? 0,
      fitzpatrickEstimate: scores.fitzpatrickEstimate ?? null,
      rawResponse: output,
    };
  } catch (err: any) {
    if (err.name === "AbortError") {
      console.log("[Perfect Corp] Timeout, using fallback");
    } else {
      console.log("[Perfect Corp] Error:", err.message, "using fallback");
    }
    return null;
  } finally {
    clearTimeout(totalTimeout);
  }
}

export async function callGemini(
  images: string[],
  scores: PerfectCorpScores | null,
  q: QuestionnaireData,
): Promise<GeminiAnalysis | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log("[Gemini] Missing API key, skipping");
    return null;
  }

  if (!images.length) {
    console.log("[Gemini] No images provided, skipping");
    return null;
  }

  const prompt = buildPrompt(scores, q);

  const imageParts = images.map(img => {
    const data = img.includes(",") ? img.split(",")[1] : img;
    return { inlineData: { mimeType: "image/jpeg", data } };
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [...imageParts, { text: prompt }],
          },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.log(`[Gemini] HTTP ${res.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) {
      console.log("[Gemini] No JSON found in response");
      return null;
    }

    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));

    return {
      skinType: parsed.skinType || "unknown",
      fitzpatrickRange: parsed.fitzpatrickRange || "III-VI",
      primaryConcerns: parsed.primaryConcerns || [],
      acneSeverity: parsed.acneSeverity || "none",
      pigmentationType: parsed.pigmentationType || "none",
      recommendedIngredients: parsed.recommendedIngredients || [],
      ingredientsToAvoid: parsed.ingredientsToAvoid || [],
      morningRoutineSteps: parsed.morningRoutineSteps || [],
      eveningRoutineSteps: parsed.eveningRoutineSteps || [],
      narrativeSummary: parsed.narrativeSummary || "",
      confidenceNote: parsed.confidenceNote || "This analysis is AI-generated and not a substitute for a professional dermatologist consultation.",
      rawResponse: data,
    };
  } catch (err: any) {
    if (err.name === "AbortError") {
      console.log("[Gemini] Timeout");
    } else {
      console.log("[Gemini] Error:", err.message);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function getStepOrder(category: string): number {
  const stepMap: Record<string, number> = {
    cleanser: 1, washing: 1, wash: 1, toner: 1, exfoliant: 1,
    serum: 2, treatment: 2, spot: 2,
    moisturizer: 3, moisturiser: 3, cream: 3, lotion: 3,
    sunscreen: 4, spf: 4, sunblock: 4,
  };
  const cat = category.toLowerCase();
  for (const [key, step] of Object.entries(stepMap)) {
    if (cat.includes(key)) return step;
  }
  return 2;
}

function coreStepToOrder(coreStep: string | undefined | null): number {
  if (!coreStep) return 2;
  const stepMap: Record<string, number> = {
    cleanse: 1, clean: 1,
    treat: 2,
    moisturize: 3, moisturise: 3,
    protect: 4,
  };
  return stepMap[coreStep.toLowerCase().trim()] || 2;
}

function normalizeForPriceMatch(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameMatchScore(productName: string, priceName: string): number {
  const p = normalizeForPriceMatch(productName);
  const np = normalizeForPriceMatch(priceName);
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

function keywordMatchCount(priceName: string, ingredients: string[]): number {
  const norm = normalizeForPriceMatch(priceName);
  let count = 0;
  for (const ing of ingredients) {
    const ingNorm = normalizeForPriceMatch(ing);
    if (norm.includes(ingNorm)) count++;
  }
  return count;
}

async function fetchNigerianPrices(): Promise<NigerianPrice[]> {
  const { data, error } = await supabaseServer
    .from("nigerian_prices")
    .select("product_name, brand, price_naira, product_url, source_shop, core_step");
  if (error || !data) {
    console.log("[ProductMatch] Failed to fetch nigerian_prices:", error?.message);
    return nigerianPrices;
  }
  return data as NigerianPrice[];
}

async function matchProductsByIngredients(
  ingredientNames: string[],
  ingredientsToAvoid: string[] = [],
): Promise<ProductMatch[]> {
  if (!ingredientNames.length) return [];

  const normalized = ingredientNames.map(normalizeIngredientName).filter(Boolean);
  const uniqueNormalized = [...new Set(normalized)];
  const avoidNorms = ingredientsToAvoid.map(normalizeIngredientName).filter(Boolean);

  const { data: allDbIngredients, error: ingErr } = await supabaseServer
    .from("ingredients")
    .select("id, name");

  if (ingErr || !allDbIngredients?.length) {
    console.log("[ProductMatch] No ingredients table:", ingErr?.message);
    return [];
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
    console.log("[ProductMatch] No ingredients matched after normalization");
    return [];
  }

  const { data: allProducts, error: prodErr } = await supabaseServer
    .from("products")
    .select("id, name, brand, category, product_url, source_website, price, raw_ingredients");

  if (prodErr || !allProducts?.length) {
    console.log("[ProductMatch] No products found:", prodErr?.message);
    return [];
  }

  const productMatches: Array<{ product: typeof allProducts[0], matched: string[] }> = [];
  for (const product of allProducts) {
    const rawIngs = (product.raw_ingredients || []) as string[];

    // Skip products containing ingredients to avoid
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
      productMatches.push({ product, matched });
    }
  }

  if (!productMatches.length) {
    const prices = await fetchNigerianPrices();
    return matchOrphanPrices(prices, ingredientNames);
  }

  const prices = await fetchNigerianPrices();
  const usedPriceIndices = new Set<number>();
  const priceByProductId = new Map<string, NigerianPrice>();

  for (const { product } of productMatches) {
    let bestScore = 0;
    let bestPrice: NigerianPrice | undefined;
    for (let i = 0; i < prices.length; i++) {
      const score = nameMatchScore(product.name, prices[i].product_name);
      if (score > bestScore) {
        bestScore = score;
        bestPrice = prices[i];
      }
    }
    if (bestPrice && bestScore > 0.3) {
      priceByProductId.set(product.id, bestPrice);
      usedPriceIndices.add(prices.indexOf(bestPrice));
    }
  }

  const enhanced = productMatches.map(({ product, matched }) => {
    const ngPrice = priceByProductId.get(product.id);
    const step = ngPrice?.core_step
      ? coreStepToOrder(ngPrice.core_step)
      : getStepOrder(product.category || "");

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
      reason: ngPrice
        ? `Available from ${ngPrice.source_shop} — ₦${ngPrice.price_naira.toLocaleString()}`
        : `Contains ${matched.slice(0, 3).join(", ")}${matched.length > 3 ? " and more" : ""}`,
      step_order: step,
    } as ProductMatch;
  });

  let orphanMatches: ProductMatch[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (usedPriceIndices.has(i)) continue;
    const price = prices[i];
    const kwCount = keywordMatchCount(price.product_name, ingredientNames);
    if (kwCount > 0) {
      const matchedIngs = ingredientNames.filter(ing =>
        normalizeForPriceMatch(price.product_name).includes(normalizeForPriceMatch(ing))
      );
      orphanMatches.push({
        id: `ng-${i}`,
        name: price.product_name,
        brand: price.brand,
        price: price.price_naira,
        product_url: price.product_url,
        source_website: price.source_shop,
        nigerian_price_naira: price.price_naira,
        nigerian_source_shop: price.source_shop,
        nigerian_product_url: price.product_url,
        matched_ingredients: matchedIngs,
        reason: `Available from ${price.source_shop} — ₦${price.price_naira.toLocaleString()}`,
        step_order: price.core_step ? coreStepToOrder(price.core_step) : getStepOrder(price.product_name),
      } as ProductMatch);
    }
  }

  // Combine, dedup by brand+name (keep cheapest), sort, return top 16
  const combined = [...enhanced, ...orphanMatches];
  const seen = new Map<string, ProductMatch>();
  for (const item of combined) {
    const key = `${item.brand || "?"}|${item.name.toLowerCase().trim()}`;
    const existing = seen.get(key);
    if (!existing || item.price < existing.price) {
      seen.set(key, item);
    }
  }

  return [...seen.values()]
    .sort((a, b) => {
      if (a.step_order !== b.step_order) return a.step_order - b.step_order;
      if (a.price !== b.price) return a.price - b.price;
      return b.matched_ingredients.length - a.matched_ingredients.length;
    })
    .slice(0, 16);
}

function matchOrphanPrices(prices: NigerianPrice[], ingredientNames: string[]): ProductMatch[] {
  return prices
    .map((price, i) => {
      const kwCount = keywordMatchCount(price.product_name, ingredientNames);
      if (kwCount === 0) return null;
      const matchedIngs = ingredientNames.filter(ing =>
        normalizeForPriceMatch(price.product_name).includes(normalizeForPriceMatch(ing))
      );
      return {
        id: `ng-${i}`,
        name: price.product_name,
        brand: price.brand,
        price: price.price_naira,
        product_url: price.product_url,
        source_website: price.source_shop,
        nigerian_price_naira: price.price_naira,
        nigerian_source_shop: price.source_shop,
        nigerian_product_url: price.product_url,
        matched_ingredients: matchedIngs,
        reason: `Available from ${price.source_shop} — ₦${price.price_naira.toLocaleString()}`,
        step_order: price.core_step ? coreStepToOrder(price.core_step) : getStepOrder(price.product_name),
      } as ProductMatch;
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a!.step_order !== b!.step_order) return a!.step_order - b!.step_order;
      if (a!.price !== b!.price) return a!.price - b!.price;
      return b!.matched_ingredients.length - a!.matched_ingredients.length;
    })
    .slice(0, 16) as ProductMatch[];
}

  export async function analyzeSkin(
    images: string[],
    q: QuestionnaireData,
  ): Promise<SkinAnalysisResult> {
    // Perfect Corp disabled — credits exhausted, re-enable when new credits purchased
    // const frontImage = images[0] || "";
    // const scores = await callPerfectCorp(frontImage);
    const scores = null;
    const usedFallback = true;

    const geminiResult = await callGemini(images, scores, q);

    let products: ProductMatch[] = [];
    if (geminiResult?.recommendedIngredients?.length) {
      products = await matchProductsByIngredients(
        geminiResult.recommendedIngredients,
        geminiResult.ingredientsToAvoid || [],
      );
    }

    const error = !geminiResult
      ? "Skin analysis failed. Please try again."
      : null;

    return {
      perfectCorpScores: null,
      geminiAnalysis: geminiResult,
      productRecommendations: products,
      error,
      usedFallback: true,
    };
  }
