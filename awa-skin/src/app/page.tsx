"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, ClipboardList, Sparkles, Star } from "lucide-react";
import AwaLogo from "@/components/AwaLogo";

const stepIcons = {
  camera: <Camera size={28} />,
  clipboard: <ClipboardList size={28} />,
  sparkle: <Sparkles size={28} />,
};

const brands = ["COSRX", "The Ordinary", "CeraVe", "Beauty of Joseon", "La Roche-Posay"];

const steps = [
  {
    icon: stepIcons.camera,
    number: "01",
    title: "Snap a Selfie",
    description: "Take two simple photos — front-facing and each side. Our AI analyzes your skin texture, concerns, and tone.",
  },
  {
    icon: stepIcons.clipboard,
    number: "02",
    title: "Tell Us About Your Skin",
    description: "Answer a few quick questions about your routine, sensitivities, and what you're hoping to improve.",
  },
  {
    icon: stepIcons.sparkle,
    number: "03",
    title: "Get Your Routine",
    description: "Receive a personalized regimen with real products you can buy in Nigeria — matched to your skin and budget.",
  },
];

export default function LandingPage() {
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("animate-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1 }
    );

    document.querySelectorAll(".animate-on-scroll").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <main className="relative min-h-screen bg-surface-warm text-white">
      {/* Top Bar */}
      <nav
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled ? "glass-nav" : "bg-transparent"
        }`}
      >
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <AwaLogo className="h-5 w-auto" />
          <div className="flex items-center gap-8 text-sm">
            <a href="#how-it-works" className="text-white/50 hover:text-white/90 transition-colors">
              How it Works
            </a>
            <a href="#contact" className="text-white/50 hover:text-white/90 transition-colors">
              Contact
            </a>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="min-h-screen flex items-center pt-14">
        <div className="max-w-6xl mx-auto px-6 w-full grid grid-cols-1 lg:grid-cols-5 gap-12 lg:gap-8 items-center">
          {/* Left — Brand Messaging */}
          <div className="lg:col-span-3 pt-12 lg:pt-0">
            <p className="text-accent text-xs tracking-[0.25em] uppercase font-medium mb-6 animate-fade-in-up">
              AI-Powered Skincare
            </p>
            <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl lg:text-7xl leading-[1.1] text-white mb-6 animate-fade-in-up" style={{ animationDelay: "0.1s" }}>
              Your skin knows
              <br />
              what it needs.
              <br />
              <span className="text-accent">We just help it speak.</span>
            </h1>
            <p className="text-white/50 text-lg md:text-xl leading-relaxed max-w-lg mb-10 animate-fade-in-up" style={{ animationDelay: "0.2s" }}>
              AI-powered skin analysis that matches you with proven products available in Nigeria. No fluff. No import headaches.
            </p>
            <div className="animate-fade-in-up" style={{ animationDelay: "0.3s" }}>
              <a
                href="/camera"
                onClick={(e) => { e.preventDefault(); router.push("/camera"); }}
                className="inline-block btn-primary text-base md:text-lg px-10 py-3.5 md:px-12 md:py-4 animate-pulse-glow no-underline"
              >
                Analyze Your Skin
              </a>
              <p className="text-white/30 text-xs tracking-wider mt-4">
                Free &bull; 2 minutes &bull; No signup required
              </p>
            </div>
          </div>

          {/* Right — Animated Blob */}
          <div className="lg:col-span-2 flex items-center justify-center lg:justify-end">
            <div className="relative w-64 h-64 sm:w-72 sm:h-72 md:w-80 md:h-80 lg:w-96 lg:h-96">
              <div className="absolute inset-0 bg-gradient-to-br from-[#c084fc]/30 via-[#e2d1ff]/20 to-transparent rounded-[60%_40%_30%_70%/60%_30%_70%_40%] animate-float blur-3xl" />
              <div
                className="absolute inset-0 bg-gradient-to-tr from-[#e2d1ff]/20 via-[#c084fc]/10 to-transparent rounded-[40%_60%_70%_30%/40%_50%_60%_50%] animate-float blur-2xl"
                style={{ animationDelay: "-4s", animationDuration: "8s" }}
              />
              <div
                className="absolute inset-0 bg-gradient-to-r from-[#c084fc]/15 to-transparent rounded-[30%_70%_50%_50%/50%_40%_60%_50%] animate-float blur-xl"
                style={{ animationDelay: "-2s", animationDuration: "10s" }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-16 h-16 rounded-full bg-accent/10 backdrop-blur-sm border border-white/5 flex items-center justify-center">
                  <Star size={24} className="text-accent/60" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="py-24 md:py-32">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16 animate-on-scroll">
            <span className="text-accent text-xs tracking-[0.25em] uppercase font-medium">Simple Process</span>
            <h2 className="font-serif text-3xl md:text-4xl text-white mt-3">How It Works</h2>
            <p className="text-white/40 text-base mt-3 max-w-md mx-auto">
              Three steps to your personalized skincare routine.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {steps.map((step, i) => (
              <div
                key={step.number}
                className="glass-card p-8 animate-on-scroll group hover:border-accent/20 transition-all duration-500"
                style={{ transitionDelay: `${i * 0.15}s` }}
              >
                <div className="flex items-start justify-between mb-6">
                  <span className="text-accent/30 text-sm font-mono">{step.number}</span>
                  <span className="text-accent/60 group-hover:text-accent transition-colors duration-300">
                    {step.icon}
                  </span>
                </div>
                <h3 className="font-serif text-xl text-white mb-3">{step.title}</h3>
                <p className="text-white/50 text-sm leading-relaxed">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Brand Trust Section */}
      <section className="py-20 border-t border-white/5">
        <div className="max-w-5xl mx-auto px-6 text-center animate-on-scroll">
          <p className="text-white/40 text-xs tracking-[0.25em] uppercase mb-8">
            Products you&apos;ll recognize
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
            {brands.map((brand) => (
              <span
                key={brand}
                className="text-white/20 text-sm tracking-widest uppercase font-light hover:text-white/40 transition-colors duration-300"
              >
                {brand}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer id="contact" className="py-16 border-t border-white/5">
        <div className="max-w-6xl mx-auto px-6 flex flex-col items-center text-center">
          <AwaLogo className="h-5 w-auto mb-6" />
          <p className="text-white/30 text-xs tracking-wider">
            &copy; 2026 AWA SKIN &mdash; intelligent skincare for real skin
          </p>
          <p className="text-white/15 text-[10px] tracking-widest mt-4 uppercase">
            Made in Lagos, powered by AI
          </p>
        </div>
      </footer>
    </main>
  );
}
