"use client";

import { useState, useCallback } from "react";

export interface QuestionnaireData {
  skinTightness: number | null;
  stinging: boolean | null;
  oiliness: "dry" | "normal" | "oily" | "combination" | null;
  sensitivity: boolean | null;
  currentRoutine: string[];
  concerns: string[];
  location: "Lagos" | "Abuja" | "Ibadan" | "Other" | null;
  budgetTier: "budget" | "balanced" | "premium" | null;
}

const initialData: QuestionnaireData = {
  skinTightness: null,
  stinging: null,
  oiliness: null,
  sensitivity: null,
  currentRoutine: [],
  concerns: [],
  location: null,
  budgetTier: null,
};

interface Question {
  id: keyof QuestionnaireData;
  title: string;
  subtitle: string;
  type: "scale" | "boolean" | "select" | "multiselect";
  options?: { label: string; value: string | number | boolean }[];
}

export const questions: Question[] = [
  {
    id: "location",
    title: "Your Location",
    subtitle: "Where are you located to prioritize local vendor stock & fast delivery?",
    type: "select",
    options: [
      { label: "📍 Lagos (BuyBetter, Teeka4, BeautyByDaz, Perona)", value: "Lagos" },
      { label: "📍 Abuja (SkinPopEssentiel)", value: "Abuja" },
      { label: "📍 Ibadan (Perona Beauty Ibadan)", value: "Ibadan" },
      { label: "🚚 Other Nigeria (Nationwide Shipping)", value: "Other" },
    ],
  },
  {
    id: "budgetTier",
    title: "Budget Preference",
    subtitle: "Choose your target budget tier per product step",
    type: "select",
    options: [
      { label: "💚 Budget-Friendly — Value picks under ₦18,000", value: "budget" },
      { label: "⚡ Balanced — Quality essentials ₦18,000 – ₦35,000", value: "balanced" },
      { label: "🌟 Premium / Luxury — High-potency actives > ₦35,000", value: "premium" },
    ],
  },
  {
    id: "skinTightness",
    title: "Skin Tightness",
    subtitle: "Does your skin feel tight or stretched after washing your face?",
    type: "scale",
    options: [
      { label: "Not at all", value: 1 },
      { label: "Slightly", value: 2 },
      { label: "Moderately", value: 3 },
      { label: "Quite tight", value: 4 },
      { label: "Very tight", value: 5 },
    ],
  },
  {
    id: "stinging",
    title: "Product Sensitivity",
    subtitle: "Do you experience stinging or burning when applying skincare products?",
    type: "boolean",
    options: [
      { label: "Yes, often", value: true },
      { label: "No, rarely", value: false },
    ],
  },
  {
    id: "oiliness",
    title: "Skin Type",
    subtitle: "How would you describe your skin's oil production throughout the day?",
    type: "select",
    options: [
      { label: "Dry — flaky, tight", value: "dry" },
      { label: "Normal — balanced", value: "normal" },
      { label: "Oily — shiny by midday", value: "oily" },
      { label: "Combination — oily T-zone, dry cheeks", value: "combination" },
    ],
  },
  {
    id: "concerns",
    title: "Primary Concerns",
    subtitle: "What are your main skin concerns? (Select all that apply)",
    type: "multiselect",
    options: [
      { label: "Acne & breakouts", value: "acne" },
      { label: "Dark spots & hyperpigmentation", value: "pigmentation" },
      { label: "Uneven texture", value: "texture" },
      { label: "Fine lines & aging", value: "aging" },
    ],
  },
  {
    id: "sensitivity",
    title: "Sensitive Skin",
    subtitle: "Have you been diagnosed with or suspect you have sensitive skin?",
    type: "boolean",
    options: [
      { label: "Yes", value: true },
      { label: "No", value: false },
    ],
  },
];

export function useQuestionnaire() {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<QuestionnaireData>(initialData);

  const update = useCallback(<K extends keyof QuestionnaireData>(
    key: K,
    value: QuestionnaireData[K]
  ) => {
    setData(prev => ({ ...prev, [key]: value }));
  }, []);

  const next = useCallback(() => {
    if (step < questions.length - 1) setStep(s => s + 1);
  }, [step]);

  const prev = useCallback(() => {
    if (step > 0) setStep(s => s - 1);
  }, [step]);

  const isComplete = data.location !== null && data.budgetTier !== null &&
    data.skinTightness !== null && data.stinging !== null &&
    data.oiliness !== null && data.sensitivity !== null &&
    data.concerns.length > 0;

  return { step, data, update, next, prev, isComplete, totalSteps: questions.length };
}