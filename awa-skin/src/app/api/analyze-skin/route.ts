import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { callPerfectCorp, callGemini } from "@/lib/skinAnalysis";
import { categorizeScores, mergeContext } from "@/lib/youcam";
import { matchByConcerns } from "@/lib/matching";
import type { QuestionnaireData } from "@/lib/skinAnalysis";

export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { images, questionnaire } = body;

    const imgArray: string[] = Array.isArray(images) ? images : (body.image ? [body.image] : []);

    if (!imgArray.length || !questionnaire) {
      return NextResponse.json(
        { error: "Missing required fields: images (array) and questionnaire" },
        { status: 400 },
      );
    }

    const { data: job, error: jobError } = await supabase
      .from("analysis_jobs")
      .insert({
        status: "processing",
        images_count: imgArray.length,
        questionnaire,
      })
      .select("id")
      .single();

    if (jobError || !job) {
      console.error("[Analyze-Skin] Failed to create job:", jobError);
      return NextResponse.json({ error: "Failed to create analysis job" }, { status: 500 });
    }

    console.log(`[Analyze-Skin] Job ${job.id} created, returning immediately`);
    const response = NextResponse.json({ jobId: job.id });

    processAnalysisJob(job.id, imgArray, questionnaire as QuestionnaireData);

    return response;
  } catch (error) {
    console.error("[Analyze-Skin] Error:", error);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}

async function processAnalysisJob(
  jobId: string,
  images: string[],
  questionnaire: QuestionnaireData,
) {
  try {
    console.log(`[Job ${jobId}] Starting YouCam analysis...`);
    const youcamScores = await callPerfectCorp(images[0] || "");

    console.log(`[Job ${jobId}] YouCam scores:`, youcamScores ? Object.entries(youcamScores).filter(([k]) => k !== 'rawResponse').map(([k, v]) => `${k}=${v}`).join(", ") : "null");

    console.log(`[Job ${jobId}] Starting Gemini analysis...`);
    const geminiResult = await callGemini(images, youcamScores, questionnaire);

    if (!geminiResult) {
      console.log(`[Job ${jobId}] Gemini failed, falling back to YouCam-only`);

      const severity = youcamScores ? categorizeScores(youcamScores) : null;

      const fallbackContext = {
        scores: youcamScores || { acne: 0, pigmentation: 0, pores: 0, texture: 0, redness: 0, oiliness: 0, radiance: 0, wrinkles: 0, darkCircles: 0 },
        severity: severity || {
          acne: { tier: "mild" as const, score: 0 },
          pigmentation: { tier: "mild" as const, score: 0 },
          pores: { tier: "mild" as const, score: 0 },
          texture: { tier: "mild" as const, score: 0 },
          redness: { tier: "mild" as const, score: 0 },
          oiliness: { tier: "mild" as const, score: 0 },
        },
        questionnaire,
        barrierCompromised: false,
        recommendedIngredients: ["Niacinamide", "Salicylic Acid"],
        ingredientsToAvoid: [],
        narrativeSummary: "Analysis completed using objective skin scoring. For a more detailed narrative, please try again with better lighting.",
        primaryConcerns: youcamScores
          ? Object.entries({ acne: youcamScores.acne, pigmentation: youcamScores.pigmentation, pores: youcamScores.pores, texture: youcamScores.texture, redness: youcamScores.redness, oiliness: youcamScores.oiliness })
              .filter(([_, v]) => v > 30)
              .map(([k]) => k)
          : [],
      };

      const routine = await matchByConcerns(fallbackContext);

      await supabase
        .from("analysis_jobs")
        .update({
          status: "completed",
          result: {
            youcamScores,
            geminiAnalysis: null,
            routine,
            error: null,
            usedFallback: true,
          },
          completed_at: new Date().toISOString(),
        })
        .eq("id", jobId);

      return;
    }

    console.log(`[Job ${jobId}] Gemini complete, merging contexts...`);

    const severity = categorizeScores(youcamScores || {
      acne: 0, pigmentation: 0, pores: 0, texture: 0, redness: 0, oiliness: 0, radiance: 0, wrinkles: 0, darkCircles: 0,
    });

    const context = mergeContext({
      scores: youcamScores || {
        acne: 0, pigmentation: 0, pores: 0, texture: 0, redness: 0, oiliness: 0, radiance: 0, wrinkles: 0, darkCircles: 0,
      },
      severity,
      questionnaire,
      geminiRecommended: geminiResult.recommendedIngredients,
      geminiAvoid: geminiResult.ingredientsToAvoid,
      geminiSummary: geminiResult.narrativeSummary,
      geminiConcerns: geminiResult.primaryConcerns,
    });

    console.log(`[Job ${jobId}] Barrier compromised: ${context.barrierCompromised}`);
    console.log(`[Job ${jobId}] Matching products for ${context.recommendedIngredients.length} ingredients...`);

    const routine = await matchByConcerns(context);

    console.log(`[Job ${jobId}] Routine: ${routine.cleanse.length}C + ${routine.treat.length}T + ${routine.protect.length}P`);

    await supabase
      .from("analysis_jobs")
      .update({
        status: "completed",
        result: {
          youcamScores,
          geminiAnalysis: geminiResult,
          routine,
          error: null,
          usedFallback: false,
        },
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    console.log(`[Job ${jobId}] Done`);
  } catch (err) {
    console.error(`[Job ${jobId}] Failed:`, err);
    await supabase
      .from("analysis_jobs")
      .update({
        status: "failed",
        error: err instanceof Error ? err.message : "Unknown error",
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);
  }
}
