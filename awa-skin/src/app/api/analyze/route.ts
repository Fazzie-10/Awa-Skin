import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { analyzeSkin } from "@/lib/skinAnalysis";

export const runtime = 'nodejs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const STORAGE_HEADERS = {
  "Content-Type": "application/json",
  "apikey": SERVICE_KEY,
  "Authorization": `Bearer ${SERVICE_KEY}`,
};

async function uploadToStorage(
  assessmentId: string,
  images: string[],
): Promise<string[]> {
  const urls: string[] = [];
  const labels = ["front", "right", "left"];

  for (let i = 0; i < images.length && i < labels.length; i++) {
    const base64Data = images[i].includes(",") ? images[i].split(",")[1] : images[i];
    const binary = Buffer.from(base64Data, "base64");
    const path = `${assessmentId}/${labels[i]}.jpg`;

    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/skin-selfies/${path}`,
      {
        method: "POST",
        headers: {
          ...STORAGE_HEADERS,
          "Content-Type": "image/jpeg",
          "x-upsert": "true",
        },
        body: binary,
      },
    );

    if (uploadRes.ok) {
      urls.push(`${SUPABASE_URL}/storage/v1/object/public/skin-selfies/${path}`);
    } else {
      console.error(`[Storage] Upload failed for ${path}:`, await uploadRes.text().catch(() => ""));
    }
  }

  return urls;
}

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
      console.error("[API] Failed to create job:", jobError);
      return NextResponse.json({ error: "Failed to create analysis job" }, { status: 500 });
    }

    console.log(`[API] Job ${job.id} created, returning immediately`);

    const response = NextResponse.json({ jobId: job.id });

    processJob(job.id, imgArray, questionnaire);

    return response;
  } catch (error) {
    console.error("[API] Error:", error);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}

async function processJob(jobId: string, images: string[], questionnaire: any) {
  try {
    console.log(`[Job ${jobId}] Starting analyzeSkin...`);
    const result = await analyzeSkin(images, questionnaire);

    console.log(`[Job ${jobId}] Analysis complete`);

    await supabase
      .from("analysis_jobs")
      .update({
        status: "completed",
        result,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    await persistLegacy(jobId, images, result, questionnaire);

    persistResults(result, images, questionnaire).catch(e =>
      console.error(`[Job ${jobId}] Background persist failed:`, e)
    );
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

async function persistLegacy(jobId: string, images: string[], result: any, questionnaire: any) {
  try {
    const geminiResult = result.geminiAnalysis;
    const acneScore = result.perfectCorpScores?.acne ?? 0;
    const pigScore = result.perfectCorpScores?.pigmentation ?? 0;
    const skinType = geminiResult?.skinType ?? "unknown";

    const { data: assessment, error: assessmentError } = await supabase
      .from("skin_assessments")
      .insert({
        user_id: "anonymous",
        acne_severity: { score: acneScore / 100, gemini: geminiResult?.acneSeverity ?? null },
        pigmentation_severity: { score: pigScore / 100, gemini: geminiResult?.pigmentationType ?? null },
        questionnaire_responses: questionnaire,
        skin_type: skinType,
      })
      .select()
      .single();

    if (assessmentError) {
      console.error(`[Job ${jobId}] Legacy assessment error:`, assessmentError);
      return;
    }

    await uploadToStorage(assessment.id, images);

    const recommendations = result.productRecommendations;
    if (recommendations?.length > 0) {
      const validUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const validRecs = recommendations.filter((rec: any) => validUUID.test(rec.id));

      if (validRecs.length > 0) {
        const { error: recError } = await supabase
          .from("recommendations")
          .insert(
            validRecs.map((rec: any) => ({
              assessment_id: assessment.id,
              product_id: rec.id,
              reason: rec.reason,
              step_order: rec.step_order,
            })),
          );

        if (recError) {
          console.error(`[Job ${jobId}] Legacy recs error:`, recError);
        }
      }
    }
  } catch (err) {
    console.error(`[Job ${jobId}] Legacy persist error:`, err);
  }
}

async function persistResults(result: any, images: string[], questionnaire: any) {
  const geminiForBackground = result.geminiAnalysis;
  if (!geminiForBackground) return;

  try {
    const imagePaths: string[] = [];
    const labels = ["front", "right", "left"];
    for (let i = 0; i < images.length && i < labels.length; i++) {
      const base64Data = images[i].includes(",") ? images[i].split(",")[1] : images[i];
      const buffer = Buffer.from(base64Data, "base64");
      const filename = `${Date.now()}-${labels[i]}-${Math.random().toString(36).slice(2)}.jpg`;

      const { data, error } = await supabase.storage
        .from("skin-selfies")
        .upload(filename, buffer, {
          contentType: "image/jpeg",
          upsert: false,
        });

      if (error) {
        console.error(`[Storage] SDK upload failed for ${labels[i]}:`, error.message);
      } else {
        imagePaths.push(data.path);
      }
    }

    const { error: insertError } = await supabase
      .from("skin_analyses")
      .insert({
        user_id: null,
        image_path: imagePaths.length > 0 ? JSON.stringify(imagePaths) : null,
        questionnaire_data: questionnaire,
        gemini_result: geminiForBackground,
        skin_type: geminiForBackground.skinType ?? null,
        acne_severity: geminiForBackground.acneSeverity ?? null,
        pigmentation_type: geminiForBackground.pigmentationType ?? null,
        fitzpatrick_estimate: geminiForBackground.fitzpatrickRange ?? null,
      });

    if (insertError) {
      console.error("[Background] Analysis save failed:", insertError.message);
    } else {
      console.log("[Background] Analysis saved to database");
    }
  } catch (err) {
    console.error("[Background] Error:", err);
  }
}
