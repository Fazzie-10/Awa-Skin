"use client";

import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";

export default function ScanConsentPage() {
  const router = useRouter();

  const handleConsent = () => {
    sessionStorage.setItem("awaConsentGiven", "true");
    router.push("/camera");
  };

  return (
    <div className="min-h-screen bg-surface-warm flex flex-col items-center justify-center p-6">
      <div className="max-w-sm w-full">
        {/* Logo */}
        <div className="text-center mb-10">
          <span className="font-serif text-2xl text-white tracking-[0.15em]">
            AWA
          </span>
          <span className="font-sans text-2xl text-white/40 font-light tracking-[0.3em] ml-1">
            SKIN
          </span>
        </div>

        {/* Heading */}
        <h1 className="font-serif text-3xl text-white text-center mb-10">
          Before we scan your skin
        </h1>

        {/* Info rows */}
        <div className="space-y-6 mb-10">
          <div className="flex items-start gap-4">
            <span className="text-xl shrink-0 mt-0.5">📸</span>
            <p className="text-white/70 text-sm leading-relaxed">
              Your selfie is analyzed by AI to assess your skin concerns
            </p>
          </div>
          <div className="flex items-start gap-4">
            <span className="text-xl shrink-0 mt-0.5">🔒</span>
            <p className="text-white/70 text-sm leading-relaxed">
              Your image is stored securely so you can track your skin progress over time
            </p>
          </div>
          <div className="flex items-start gap-4">
            <span className="text-xl shrink-0 mt-0.5">🚫</span>
            <p className="text-white/70 text-sm leading-relaxed">
              Your data is never sold or shared with third parties
            </p>
          </div>
          <div className="flex items-start gap-4">
            <span className="text-xl shrink-0 mt-0.5">⚕️</span>
            <p className="text-white/70 text-sm leading-relaxed">
              This is a skincare guide, not a medical diagnosis
            </p>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-white/5 mb-8" />

        {/* Primary button */}
        <button onClick={handleConsent} className="btn-primary w-full text-center">
          Scan my skin
        </button>

        {/* Secondary link */}
        <div className="text-center mt-6">
          <a href="#" className="inline-flex items-center gap-1 text-white/20 text-xs hover:text-white/40 transition-colors">
            Learn more about how we use your data <ArrowRight className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
