"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { useQuestionnaire, questions } from "@/hooks/useQuestionnaire";

export default function Questionnaire() {
  const router = useRouter();
  const { step, data, update, next, prev, isComplete, totalSteps } = useQuestionnaire();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const question = questions[step];
  const progress = ((step + 1) / totalSteps) * 100;

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);
    const raw = sessionStorage.getItem("skinSelfie");
    let images: string[] = [];
    try {
      images = JSON.parse(raw || "[]");
    } catch { images = raw ? [raw] : []; }

    sessionStorage.setItem("retryPayload", JSON.stringify({ images, questionnaire: data }));

    try {
      const res = await fetch("/api/analyze-skin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images, questionnaire: data }),
      });

      if (!res.ok) {
        throw new Error("Analysis failed. Please try again.");
      }

      const { jobId } = await res.json();
      router.push(`/results?jobId=${jobId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setIsSubmitting(false);
    }
  };

  const handleSelect = (value: string | number | boolean) => {
    if (question.type === "multiselect") {
      const current = (data[question.id] as string[]) || [];
      const val = value as string;
      const updated = current.includes(val)
        ? current.filter(v => v !== val)
        : [...current, val];
      update(question.id as any, updated);
    } else {
      update(question.id as any, value as any);
    }

    if (question.type !== "multiselect" && step < totalSteps - 1) {
      setTimeout(next, 300);
    }
  };

  const isSelected = (value: string | number | boolean) => {
    if (question.type === "multiselect") {
      return ((data[question.id] as string[]) || []).includes(value as string);
    }
    return data[question.id] === value;
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 relative">
      {isSubmitting && (
        <div className="fixed inset-0 z-50 bg-surface/80 backdrop-blur-sm flex flex-col items-center justify-center">
          <div className="w-12 h-12 border-2 border-accent/30 border-t-accent rounded-full animate-spin mb-6" />
          <p className="text-white/60 text-sm">Analyzing your skin...</p>
          <p className="text-white/30 text-xs mt-2">Loading AI model — this may take 10-30s on first use</p>
        </div>
      )}

      <div className="w-full max-w-md">
        <div className="h-1 bg-white/5 rounded-full mb-12 overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="glass-card p-8 md:p-10">
          <span className="text-accent/60 text-xs tracking-wider font-mono">
            {String(step + 1).padStart(2, "0")}/{String(totalSteps).padStart(2, "0")}
          </span>

          <h2 className="font-serif text-2xl md:text-3xl text-white mt-4 mb-2">
            {question.title}
          </h2>

          <p className="text-white/50 text-sm mb-8 leading-relaxed">
            {question.subtitle}
          </p>

          <div className="space-y-3">
            {question.options?.map(opt => (
              <button
                key={String(opt.value)}
                onClick={() => handleSelect(opt.value)}
                className={`w-full text-left px-5 py-4 rounded-xl border transition-all duration-200 ${
                  isSelected(opt.value)
                    ? "border-accent bg-accent/10 text-white"
                    : "border-white/5 bg-white/[0.02] text-white/60 hover:border-white/10 hover:text-white/80"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <div className="flex justify-between items-center mt-6">
          <button
            onClick={prev}
            className={`inline-flex items-center gap-1 text-sm text-white/30 hover:text-white/60 transition-colors ${
              step === 0 ? "invisible" : ""
            }`}
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>

          {step === totalSteps - 1 ? (
            <button
              onClick={handleSubmit}
              disabled={!isComplete || isSubmitting}
              className="btn-primary text-sm inline-flex items-center gap-2"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {isSubmitting ? "Analyzing..." : "Get Results"}
            </button>
          ) : (
            <button
              onClick={next}
              className="btn-primary text-sm inline-flex items-center gap-2"
            >
              Next <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
