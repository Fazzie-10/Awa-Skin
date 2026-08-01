export interface YouCamScores {
  acne: number;
  pigmentation: number;
  pores: number;
  texture: number;
  redness: number;
  oiliness: number;
  radiance: number;
  wrinkles: number;
  darkCircles: number;
}

export interface SeverityEntry {
  tier: "severe" | "moderate" | "mild";
  score: number;
}

export interface SeverityMap {
  acne: SeverityEntry;
  pigmentation: SeverityEntry;
  pores: SeverityEntry;
  texture: SeverityEntry;
  redness: SeverityEntry;
  oiliness: SeverityEntry;
}

export interface AnalysisContext {
  scores: YouCamScores;
  severity: SeverityMap;
  questionnaire: QuestionnaireData;
  barrierCompromised: boolean;
  recommendedIngredients: string[];
  ingredientsToAvoid: string[];
  narrativeSummary: string;
  primaryConcerns: string[];
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

const CONCERN_TO_INGREDIENTS: Record<string, string[]> = {
  acne: ["Salicylic Acid", "Niacinamide", "Benzoyl Peroxide", "Retinol", "Zinc"],
  pigmentation: ["Alpha-Arbutin", "Niacinamide", "Ascorbic Acid", "Azelaic Acid", "Tranexamic Acid", "Kojic Acid"],
  pores: ["Salicylic Acid", "Niacinamide", "Retinol"],
  texture: ["Glycolic Acid", "Lactic Acid", "Retinol", "Niacinamide"],
  aging: ["Retinol", "Peptides", "Ascorbic Acid", "Ceramide"],
  barrier: ["Centella Asiatica", "Ceramide", "Panthenol", "Oat Extract", "Shea Butter"],
  redness: ["Azelaic Acid", "Centella Asiatica", "Niacinamide"],
  oiliness: ["Salicylic Acid", "Niacinamide", "Zinc"],
};

const BARRIER_SOOTHING = ["Centella Asiatica", "Ceramide", "Panthenol", "Oat Extract", "Shea Butter", "Niacinamide"];
const BARRIER_AVOID = ["Salicylic Acid", "Glycolic Acid", "Lactic Acid", "Retinol", "Benzoyl Peroxide"];

function scoreToSeverity(score: number): SeverityEntry {
  if (score > 70) return { tier: "severe", score };
  if (score >= 40) return { tier: "moderate", score };
  return { tier: "mild", score };
}

export function categorizeScores(scores: YouCamScores): SeverityMap {
  return {
    acne: scoreToSeverity(scores.acne),
    pigmentation: scoreToSeverity(scores.pigmentation),
    pores: scoreToSeverity(scores.pores),
    texture: scoreToSeverity(scores.texture),
    redness: scoreToSeverity(scores.redness),
    oiliness: scoreToSeverity(scores.oiliness),
  };
}

export function mergeContext(params: {
  scores: YouCamScores;
  severity: SeverityMap;
  questionnaire: QuestionnaireData;
  geminiRecommended: string[];
  geminiAvoid: string[];
  geminiSummary: string;
  geminiConcerns: string[];
}): AnalysisContext {
  const { scores, severity, questionnaire, geminiRecommended, geminiAvoid, geminiSummary, geminiConcerns } = params;

  const barrierCompromised =
    (severity.acne.tier === "severe" || severity.acne.tier === "moderate") &&
    (questionnaire.stinging === true || (questionnaire.skinTightness ?? 0) >= 3);

  const concernBasedIngredients = new Set<string>();
  for (const [concern, ings] of Object.entries(CONCERN_TO_INGREDIENTS)) {
    if (geminiConcerns.includes(concern) || (scores as any)[concern] > 30) {
      ings.forEach(i => concernBasedIngredients.add(i));
    }
  }

  let recommendedIngredients: string[];
  let ingredientsToAvoid: string[];

  if (barrierCompromised) {
    recommendedIngredients = [...new Set([
      ...BARRIER_SOOTHING,
      ...geminiRecommended.filter(i => !BARRIER_AVOID.some(a => i.toLowerCase().includes(a.toLowerCase()))),
    ])];
    ingredientsToAvoid = [...new Set([...geminiAvoid, ...BARRIER_AVOID])];
  } else {
    recommendedIngredients = [...new Set([...concernBasedIngredients, ...geminiRecommended])];
    ingredientsToAvoid = [...geminiAvoid];
  }

  const primaryConcerns = geminiConcerns.length > 0
    ? geminiConcerns
    : Object.entries(severity)
        .filter(([_, s]) => s.tier !== "mild")
        .map(([key]) => key);

  const narrativeParts: string[] = [];
  if (barrierCompromised) {
    narrativeParts.push("Your skin barrier appears compromised based on the combination of visible concerns and reported sensitivity.");
  }
  if (geminiSummary) {
    narrativeParts.push(geminiSummary);
  }

  return {
    scores,
    severity,
    questionnaire,
    barrierCompromised,
    recommendedIngredients,
    ingredientsToAvoid,
    narrativeSummary: narrativeParts.join(" ") || geminiSummary,
    primaryConcerns,
  };
}
