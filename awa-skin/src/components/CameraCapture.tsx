"use client";

import { useRouter } from "next/navigation";
import { useCamera, ANGLE_LABELS } from "@/hooks/useCamera";

export default function CameraCapture() {
  const router = useRouter();
  const { videoRef, canvasRef, state, startCamera, startCountdown, retake, nextAngle } = useCamera();

  const handleContinue = () => {
    const allCaptured = state.images.every(Boolean);
    if (allCaptured) {
      sessionStorage.setItem("skinSelfie", JSON.stringify(state.images));
      router.push("/questionnaire");
    }
  };

  if (state.isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="glass-card p-10 max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h2 className="font-serif text-2xl text-white mb-3">Camera Ready</h2>
          <p className="text-white/50 text-sm leading-relaxed mb-8">
            We'll scan your face from 3 angles for a complete analysis. Tap below when you're ready.
          </p>
          <button onClick={startCamera} className="btn-primary">
            Start Camera
          </button>
        </div>
      </div>
    );
  }

  if (state.permissionDenied || (state.error && !state.isLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="glass-card p-10 max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
          </div>
          <h2 className="font-serif text-2xl text-white mb-3">{state.permissionDenied ? "Camera Access Needed" : "Camera Error"}</h2>
          <p className="text-white/50 text-sm leading-relaxed mb-8">
            {state.permissionDenied
              ? "We need camera access to analyze your skin. Please enable it in your browser settings, then refresh."
              : state.error}
          </p>
          <button onClick={() => window.location.reload()} className="btn-primary">
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (state.scanPhase === "review") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6">
        <h2 className="font-serif text-2xl text-white mb-6">Review Your Scans</h2>
        <div className="flex gap-4 max-w-lg w-full justify-center flex-wrap">
          {state.images.map((img, i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <div className="w-28 h-28 rounded-2xl overflow-hidden border border-white/10">
                {img ? (
                  <img src={img} alt={ANGLE_LABELS[i]} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-surface-card flex items-center justify-center text-white/20 text-xs">
                    Missing
                  </div>
                )}
              </div>
              <span className="text-white/40 text-xs">{ANGLE_LABELS[i]}</span>
            </div>
          ))}
        </div>
        {state.brightnessWarning && (
          <p className="text-yellow-400/80 text-sm mt-4 text-center">
            Low light detected — results may be less accurate
          </p>
        )}
        {state.resolutionWarning && (
          <p className="text-yellow-400/80 text-sm mt-2 text-center">
            Low resolution detected — results may be less accurate
          </p>
        )}
        <div className="flex gap-4 mt-8">
          <button onClick={() => { retake(); }} className="btn-outline">Retake</button>
          <button onClick={handleContinue} className="btn-primary">Continue to Assessment</button>
        </div>
      </div>
    );
  }

  const angleLabel = ANGLE_LABELS[state.currentAngle];
  const isCountdown = state.scanPhase === "countdown";
  const isCaptured = state.scanPhase === "captured";
  const isStreaming = state.scanPhase === "streaming";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 relative">
      <canvas ref={canvasRef} className="hidden" />

      <div className="relative max-w-md w-full">
        {/* Angle indicator */}
        <div className="absolute top-4 left-4 z-10 flex gap-1.5">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full ${
                i === state.currentAngle ? "bg-accent" : i < state.currentAngle ? "bg-white/60" : "bg-white/20"
              }`}
            />
          ))}
        </div>

        <div className="relative rounded-3xl overflow-hidden aspect-[3/4] accent-glow border border-white/10">
          {state.isLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface-card z-20">
              <div className="w-10 h-10 border-2 border-accent/30 border-t-accent rounded-full animate-spin mb-4" />
              <p className="text-white/40 text-sm">Starting camera...</p>
            </div>
          )}

          <div className="relative w-full h-full">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`absolute inset-0 w-full h-full object-cover ${state.isLoading || isCaptured ? "hidden" : ""}`}
            />
            {state.images[state.currentAngle] && (
              <img
                src={state.images[state.currentAngle]!}
                alt="Captured"
                className={`absolute inset-0 w-full h-full object-cover ${isCaptured ? "" : "hidden"}`}
              />
            )}
          </div>

          {/* Countdown overlay */}
          {isCountdown && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
              <span className="text-white text-8xl font-bold font-mono animate-pulse">
                {state.countdownValue}
              </span>
            </div>
          )}
        </div>

        {/* Warnings */}
        {isCaptured && state.brightnessWarning && (
          <p className="text-yellow-400/70 text-xs text-center mt-3">
            Image is dark — results may be less accurate
          </p>
        )}
        {isCaptured && state.resolutionWarning && (
          <p className="text-yellow-400/70 text-xs text-center mt-1">
            Image quality is low — results may be less accurate
          </p>
        )}

        {/* Controls */}
        <div className="flex justify-center mt-8 gap-4">
          {isCaptured ? (
            <>
              <button onClick={retake} className="btn-outline">Retake</button>
              <button onClick={nextAngle} className="btn-primary">
                {state.currentAngle < 2 ? "Next Angle" : "Review All"}
              </button>
            </>
          ) : (
            <button
              onClick={startCountdown}
              disabled={isCountdown || state.isLoading}
              className="btn-primary px-12"
            >
              {isCountdown ? `Scanning in ${state.countdownValue}...` : `Scan ${angleLabel}`}
            </button>
          )}
        </div>

        <p className="text-center text-white/30 text-sm mt-6">
          {isStreaming && `Position your face in the frame — ${angleLabel}`}
          {isCaptured && "How does this look?"}
        </p>
      </div>
    </div>
  );
}
