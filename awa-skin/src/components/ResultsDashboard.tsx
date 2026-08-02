"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Sparkles, RefreshCw, AlertTriangle, ChevronLeft } from "lucide-react";

interface GeminiAnalysis {
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
}

interface ProductMatch {
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

interface RoutineResult {
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
  totalPrice?: number;
  summary: string;
  barrierCompromised: boolean;
  primaryConcerns: string[];
  userLocation?: string;
  budgetTier?: string;
}

interface YouCamScores {
  acne: number;
  pigmentation: number;
  pores: number;
  texture: number;
  redness: number;
  oiliness: number;
  radiance: number;
  wrinkles: number;
  darkCircles: number;
  fitzpatrickEstimate?: string | null;
}

function imageHash(images: string[]): string {
  if (!images.length) return "";
  return String(images.reduce((acc, img) => acc + img.length, 0)) + ":" + images[0].slice(0, 80);
}

const REUSE_KEY = "youcamReuse";

interface SkinAnalysisResult {
  youcamScores: YouCamScores | null;
  geminiAnalysis: GeminiAnalysis | null;
  routine: RoutineResult;
  error: string | null;
  usedFallback: boolean;
}

const EMPTY_ROUTINE: RoutineResult = {
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

interface LegacyResult {
  assessment: {
    acne_severity: number;
    pigmentation_severity: number;
    skin_type: string;
    summary: string;
  };
  recommendations: Array<{
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
  }>;
}

type ResultData = SkinAnalysisResult | LegacyResult;

function isNewResult(data: ResultData): data is SkinAnalysisResult {
  return "routine" in data || "youcamScores" in data;
}

function capitalize(str: string): string {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function truncateToFirstSentence(text: string): string {
  if (!text) return "";
  const dotIndex = text.indexOf(".");
  if (dotIndex !== -1) {
    return text.slice(0, dotIndex + 1);
  }
  if (text.length > 160) {
    return text.slice(0, 160) + "...";
  }
  return text;
}

function getPlainReason(matchedIngredients: string[], stepOrder: number): string {
  const ingredients = matchedIngredients.map(i => i.toLowerCase());

  if (stepOrder === 4) {
    return "Protects your skin and stops dark spots from getting worse";
  }

  const acneIngredients = ["salicylic acid", "benzoyl peroxide", "niacinamide"];
  const pigmentIngredients = ["azelaic acid", "alpha-arbutin", "arbutin", "tranexamic acid", "kojic acid", "vitamin c", "ascorbic acid"];
  const hydratingIngredients = ["hyaluronic acid", "sodium hyaluronate", "ceramide", "glycerin", "glycerol"];

  const hasAcne = ingredients.some(i => acneIngredients.some(a => i.includes(a)));
  const hasPigment = ingredients.some(i => pigmentIngredients.some(p => i.includes(p)));
  const hasHydration = ingredients.some(i => hydratingIngredients.some(h => i.includes(h)));

  if (hasAcne && hasPigment) return "Clears breakouts and fades dark spots";
  if (hasAcne) return "Helps clear breakouts and congestion";
  if (hasPigment) return "Fades dark spots safely on your skin tone";
  if (hasHydration) return "Keeps your skin hydrated without clogging pores";
  return "Formulated for your skin concerns";
}

function extractPlatformName(url: string): string {
  if (!url) return "Nigerian store";
  try {
    const hostname = new URL(
      url.startsWith("http") ? url : "https://" + url
    ).hostname;
    const domain = hostname.replace("www.", "").split(".")[0];
    return domain.charAt(0).toUpperCase() + domain.slice(1);
  } catch {
    return url;
  }
}

function ProductCardInline({ product }: { product: ProductMatch }) {
  const displayPrice = product.nigerian_price_naira ?? product.price;
  const displayShop = product.nigerian_source_shop ?? product.source_website;
  const displayUrl = product.nigerian_product_url ?? product.product_url;
  const locationTag = product.location ? `📍 ${product.location}` : `📍 ${extractPlatformName(displayShop)}`;
  const imageUrl = product.image_url;
  const [imgError, setImgError] = useState(false);

  return (
    <a
      href={displayUrl || "#"}
      target="_blank"
      rel="noopener noreferrer"
      className="block glass-card p-5 hover:border-accent/15 transition-all duration-300 group relative"
    >
      <div className="flex items-center gap-4 mb-3">
        <div className="w-20 h-20 rounded-xl overflow-hidden bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
          {imageUrl && !imgError ? (
            <img
              src={imageUrl}
              alt={product.name}
              loading="lazy"
              onError={() => setImgError(true)}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-2xl">{product.brand?.charAt(0) || "🛍️"}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-accent/60 font-semibold uppercase tracking-wider mb-0.5 truncate">
            {product.brand}
          </p>
          <p className="text-white font-medium text-lg leading-snug line-clamp-2">
            {product.name}
          </p>
        </div>
      </div>

      {product.shipping_required && (
        <div className="mb-2">
          <span className="px-2.5 py-1 bg-amber-500/10 border border-amber-500/20 rounded-md text-[11px] text-amber-400 font-medium">
            🚚 Shipping Required ({product.location || 'Lagos'})
          </span>
        </div>
      )}

      <p className="text-white/50 text-sm mb-3">
        {getPlainReason(product.matched_ingredients, product.step_order)}
      </p>
      <div className="flex items-center justify-between">
        <p className="text-white font-semibold">
          {displayPrice && displayPrice > 0
            ? `₦${displayPrice.toLocaleString("en-NG")}`
            : "Price varies"
          }
        </p>
        <div className="flex items-center gap-2">
          <span className="text-white/40 text-xs px-2 py-0.5 bg-white/5 rounded border border-white/10">
            {locationTag}
          </span>
          <span className="text-white/30 text-xs">
            {extractPlatformName(displayShop)}
          </span>
        </div>
      </div>
    </a>
  );
}

export default function ResultsDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const jobId = searchParams.get("jobId");

  const [result, setResult] = useState<ResultData | null>(null);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    if (!jobId) {
      const stored = sessionStorage.getItem("analysisResult");
      if (stored) {
        try { setResult(JSON.parse(stored)); } catch { /* ignore */ }
      }
      setLoading(false);
      return;
    }

    setPolling(true);
    let cancelled = false;

    const poll = async () => {
      while (!cancelled) {
        try {
          const res = await fetch(`/api/results/${jobId}`);
          if (!res.ok) {
            if (!cancelled) setLoading(false);
            return;
          }
          const data = await res.json();

          if (data.status === "completed") {
            sessionStorage.setItem("analysisResult", JSON.stringify(data.result));
            if (data.result?.youcamScores && data.result?.youcamScores !== null && data.result.youcamScores.acne !== undefined) {
              const payload = sessionStorage.getItem("retryPayload");
              if (payload) {
                try {
                  const { images } = JSON.parse(payload);
                  if (Array.isArray(images)) {
                    sessionStorage.setItem(REUSE_KEY, JSON.stringify({ hash: imageHash(images), youcamScores: data.result.youcamScores }));
                  }
                } catch { /* ignore */ }
              }
            }
            if (!cancelled) { setResult(data.result); setLoading(false); setPolling(false); }
            return;
          }

          if (data.status === "failed") {
            if (!cancelled) {
              setResult({
                youcamScores: null,
                geminiAnalysis: null,
                routine: EMPTY_ROUTINE,
                error: data.error || "Analysis failed",
                usedFallback: true,
              });
              setLoading(false);
              setPolling(false);
            }
            return;
          }
        } catch {
          if (!cancelled) setLoading(false);
          return;
        }

        await new Promise(r => setTimeout(r, 3000));
      }
    };

    poll();

    return () => { cancelled = true; };
  }, [jobId]);

  const handleRetry = useCallback(async () => {
    const payload = sessionStorage.getItem("retryPayload");
    if (!payload) {
      router.push("/questionnaire");
      return;
    }

    setLoading(true);
    setPolling(true);

    try {
      let body: string = payload;
      const reuseRaw = sessionStorage.getItem(REUSE_KEY);
      if (reuseRaw) {
        try {
          const reuse = JSON.parse(reuseRaw);
          const { images } = JSON.parse(payload);
          if (reuse.hash && reuse.youcamScores && Array.isArray(images) && reuse.hash === imageHash(images)) {
            const parsed = JSON.parse(payload);
            parsed.youcamScores = reuse.youcamScores;
            body = JSON.stringify(parsed);
          }
        } catch { /* ignore */ }
      }

      const res = await fetch("/api/analyze-skin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });

      if (!res.ok) throw new Error("Analysis failed");

      const { jobId: newJobId } = await res.json();
      router.push(`/results?jobId=${newJobId}`);
    } catch {
      setResult({
        youcamScores: null,
        geminiAnalysis: null,
        routine: EMPTY_ROUTINE,
        error: "Analysis failed. Please try again.",
        usedFallback: true,
      });
      setLoading(false);
      setPolling(false);
    }
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-accent/30 border-t-accent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white/40 text-sm">
            {polling ? "Running analysis..." : "Loading results..."}
          </p>
          {polling && (
            <p className="text-white/20 text-xs mt-2">This may take up to 60 seconds</p>
          )}
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="glass-card p-10 text-center max-w-md">
          <h2 className="font-serif text-2xl text-white mb-3">No Analysis Found</h2>
          <p className="text-white/50 text-sm mb-8">Take a skin analysis first to see your results.</p>
          <a href="/camera" className="btn-primary">Start Analysis</a>
        </div>
      </div>
    );
  }

  if (isNewResult(result)) {
    return <NewResultsView result={result} onRetry={handleRetry} />;
  }

  return <LegacyResultsView result={result} />;
}

const ROUTINE_SECTIONS: Array<{
  key: "cleanse" | "treat" | "moisturize" | "protect";
  title: string;
  tagline: string;
}> = [
  { key: "cleanse", title: "Cleanse", tagline: "Gentle daily cleanser" },
  { key: "treat", title: "Treat", tagline: "Targets your main concerns" },
  { key: "moisturize", title: "Moisturize", tagline: "Locks in hydration" },
  { key: "protect", title: "Protect", tagline: "SPF stops dark spots worsening" },
];

function NewResultsView({ result, onRetry }: { result: SkinAnalysisResult; onRetry: () => void }) {
  const { geminiAnalysis, routine, error } = result;

  if (error && !geminiAnalysis) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="glass-card p-10 text-center max-w-md">
          <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-6 h-6 text-amber-400" />
          </div>
          <h2 className="font-serif text-2xl text-white mb-3">Analysis Error</h2>
          <p className="text-white/50 text-sm mb-8">{error}</p>
          <button onClick={onRetry} className="btn-primary inline-flex items-center gap-2">
            <RefreshCw className="w-4 h-4" /> Try Again
          </button>
        </div>
      </div>
    );
  }

  const summary = routine?.summary || (geminiAnalysis ? truncateToFirstSentence(geminiAnalysis.narrativeSummary) : "");
  const badge1 = geminiAnalysis ? capitalize(geminiAnalysis.skinType) : "";
  const badge2 = geminiAnalysis?.primaryConcerns?.[0]
    ? capitalize(geminiAnalysis.primaryConcerns[0])
    : (routine?.primaryConcerns?.[0] ? capitalize(routine.primaryConcerns[0]) : "");

  const sections = ROUTINE_SECTIONS.map(section => ({
    ...section,
    products: routine?.[section.key] ?? [],
    alternates: routine?.alternatives?.[section.key] ?? [],
  }));
  const hasProducts = sections.some(s => s.products.length > 0);
  const budgetLabel = routine?.budgetTier === "budget" ? "₦18,000" : routine?.budgetTier === "balanced" ? "₦18,000 – ₦35,000" : routine?.budgetTier === "premium" ? "₦35,000+" : null;

  return (
    <div className="min-h-screen p-6 pb-20">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <span className="inline-flex items-center gap-1.5 text-xs tracking-[0.3em] uppercase text-accent-light font-medium">
            <Sparkles className="w-3.5 h-3.5" /> Your Results
          </span>
          <h1 className="font-serif text-3xl md:text-4xl text-white mt-3">
            AWA SKIN
          </h1>
        </div>

        {summary && (
          <div className="glass-card p-6 mb-6">
            <p className="text-white/80 text-sm leading-relaxed">{summary}</p>
          </div>
        )}

        {routine?.barrierCompromised && (
          <div className="glass-card p-5 mb-6 border border-amber-500/20">
            <p className="text-amber-400 text-sm font-medium mb-1">
              Sensitive / compromised barrier detected
            </p>
            <p className="text-white/60 text-sm leading-relaxed">
              We skipped strong exfoliants and actives, and focused on calming,
              barrier-repairing ingredients like Centella, Ceramides, and Panthenol.
            </p>
          </div>
        )}

        <div className="flex justify-center gap-3 mb-10">
          {badge1 && (
            <span className="px-4 py-2 bg-accent/10 border border-accent/20 rounded-full text-sm text-accent-light font-medium">
              {badge1}
            </span>
          )}
          {badge2 && (
            <span className="px-4 py-2 bg-white/5 border border-white/10 rounded-full text-sm text-white/70 font-medium">
              {badge2}
            </span>
          )}
        </div>

        <div className="mb-8">
          <h2 className="font-serif text-2xl text-white mb-1">Your Routine</h2>
          <p className="text-white/40 text-sm mb-6">Products available in Nigeria</p>

          {!hasProducts ? (
            <div className="glass-card p-8 text-center">
              <p className="text-white/50 text-sm leading-relaxed mb-4">
                We're still stocking Nigerian products for your skin type. In the meantime, ask your pharmacist for products containing:
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {(geminiAnalysis?.recommendedIngredients ?? routine?.primaryConcerns ?? []).slice(0, 4).map(ing => (
                  <span key={ing} className="px-3 py-1.5 bg-accent/10 border border-accent/20 rounded-full text-xs text-accent-light">
                    {ing}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-8">
              {sections.filter(s => s.products.length > 0).map(section => (
                <div key={section.key}>
                  <div className="flex items-baseline gap-3 mb-4">
                    <h3 className="font-serif text-xl text-accent-light">
                      {section.title}
                    </h3>
                    <p className="text-white/30 text-xs">{section.tagline}</p>
                  </div>
                  <div className="space-y-4">
                    {section.products.map(product => (
                      <ProductCardInline key={product.id} product={product} />
                    ))}
                  </div>
                  {section.alternates.length > 0 && (
                    <div className="mt-4">
                      <p className="text-white/25 text-xs uppercase tracking-wider mb-2">
                        Other options you could also try
                      </p>
                      <div className="space-y-2.5">
                        {section.alternates.map(product => (
                          <ProductCardInline key={product.id} product={product} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {routine?.totalPrice != null && routine.totalPrice > 0 && (
                <div className="glass-card p-5 border border-accent/15">
                  <div className="flex items-center justify-between">
                    <p className="text-white/60 text-sm">Estimated total for your 4-step routine</p>
                    <p className="text-white font-semibold">
                      ₦{routine.totalPrice.toLocaleString("en-NG")}
                      {budgetLabel && <span className="text-white/30 text-xs font-normal ml-1">· {budgetLabel}</span>}
                    </p>
                  </div>
                  <p className="text-white/30 text-xs mt-1">
                    Prices from Nigerian vendors may vary. Check each product for delivery fees.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <p className="text-center text-white/20 text-xs mb-10">
          AI-powered guide only. Not medical advice.
        </p>

        <div className="text-center">
          <button
            onClick={() => {
              sessionStorage.clear();
              window.location.href = "/";
            }}
            className="inline-flex items-center gap-1.5 text-sm text-white/30 hover:text-white/60 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> Start over
          </button>
        </div>
      </div>
    </div>
  );
}

function LegacyResultsView({ result }: { result: LegacyResult }) {
  const { assessment, recommendations } = result;
  const summary = truncateToFirstSentence(assessment.summary);
  const badge1 = capitalize(assessment.skin_type);

  return (
    <div className="min-h-screen p-6 pb-20">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <span className="inline-flex items-center gap-1.5 text-xs tracking-[0.3em] uppercase text-accent-light font-medium">
            <Sparkles className="w-3.5 h-3.5" /> Your Results
          </span>
          <h1 className="font-serif text-3xl md:text-4xl text-white mt-3">
            AWA SKIN
          </h1>
        </div>

        {summary && (
          <div className="glass-card p-6 mb-6">
            <p className="text-white/80 text-sm leading-relaxed">{summary}</p>
          </div>
        )}

        <div className="flex justify-center gap-3 mb-10">
          {badge1 && (
            <span className="px-4 py-2 bg-accent/10 border border-accent/20 rounded-full text-sm text-accent-light font-medium">
              {badge1}
            </span>
          )}
        </div>

        <div className="mb-8">
          <h2 className="font-serif text-2xl text-white mb-1">Products For You</h2>
          <p className="text-white/40 text-sm mb-6">Available in Nigeria</p>

          {recommendations.length === 0 ? (
            <div className="glass-card p-8 text-center">
              <p className="text-white/50 text-sm leading-relaxed">
                We're still stocking Nigerian products for your skin type. In the meantime, ask your pharmacist for products containing:
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {recommendations.map(product => (
                <ProductCardInline key={product.id} product={product} />
              ))}
            </div>
          )}
        </div>

        <p className="text-center text-white/20 text-xs mb-10">
          AI-powered guide only. Not medical advice.
        </p>

        <div className="text-center">
          <button
            onClick={() => {
              sessionStorage.clear();
              window.location.href = "/";
            }}
            className="inline-flex items-center gap-1.5 text-sm text-white/30 hover:text-white/60 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> Start over
          </button>
        </div>
      </div>
    </div>
  );
}
