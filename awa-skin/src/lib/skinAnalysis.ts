"use server";

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
  location?: "Lagos" | "Abuja" | "Ibadan" | "Other" | null;
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
  image_url?: string | null;
  location?: "Lagos" | "Abuja" | "Ibadan" | "Unknown";
  shipping_required?: boolean;
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
  let binary = Buffer.from(base64Data, "base64");

  // Enhance before upload: upscale small/low-res frames and lift dark lighting
  // so YouCam's AI can detect a face (error_lighting_dark was the blocker).
  try {
    const sharpMod = await import("sharp").then(m => m.default);
    const meta = await sharpMod(binary).metadata();
    const shortSide = Math.min(meta.width || 0, meta.height || 0);
    let pipeline = sharpMod(binary);
    if (shortSide > 0 && shortSide < 1080) {
      pipeline = pipeline.resize({
        width: meta.width! >= meta.height! ? undefined : 1080,
        height: meta.width! >= meta.height! ? 1080 : undefined,
        fit: "inside",
        withoutEnlargement: false,
      });
    }
    const stats = await sharpMod(binary).stats();
    const avgLuma = stats.channels?.[0]?.mean ?? 128;
    if (avgLuma < 90) {
      const gain = avgLuma < 40 ? 2.2 : avgLuma < 60 ? 1.75 : 1.4;
      pipeline = pipeline
        .modulate({ brightness: gain, saturation: 1.08 })
        .linear(1.2, 6);
    }
    pipeline = pipeline.sharpen().jpeg({ quality: 85 });
    binary = Buffer.from(await pipeline.toBuffer());
  } catch (enhanceErr) {
    console.log("[Perfect Corp] Image enhancement skipped:", (enhanceErr as Error).message);
  }

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


