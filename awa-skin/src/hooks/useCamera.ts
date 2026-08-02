"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export const ANGLE_LABELS = ["Front View", "Right Side", "Left Side"] as const;
export const ANGLE_COUNT = 3;

interface CameraState {
  stream: MediaStream | null;
  error: string | null;
  permissionDenied: boolean;
  isLoading: boolean;
  isPending: boolean;
  images: [string | null, string | null, string | null];
  currentAngle: number;
  scanPhase: "idle" | "streaming" | "countdown" | "captured" | "review";
  countdownValue: number;
  brightnessWarning: boolean;
  resolutionWarning: boolean;
}

function checkBrightness(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d");
  if (!ctx) return true;
  const w = canvas.width;
  const h = canvas.height;
  const step = Math.max(1, Math.floor(Math.min(w, h) / 10));
  let total = 0;
  let samples = 0;
  for (let x = 0; x < w; x += step) {
    for (let y = 0; y < h; y += step) {
      const p = ctx.getImageData(x, y, 1, 1).data;
      total += (p[0] + p[1] + p[2]) / 3;
      samples++;
    }
  }
  return total / samples >= 70;
}

function enhanceLowLight(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const total = data.length / 4;

  let totalBrightness = 0;
  for (let i = 0; i < data.length; i += 4) {
    totalBrightness += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  const avg = totalBrightness / total;

  if (avg >= 100) return;

  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    hist[gray]++;
  }

  let cumulative = 0;
  let minVal = 0;
  for (let i = 0; i < 256; i++) {
    cumulative += hist[i];
    if (cumulative >= total * 0.02) { minVal = i; break; }
  }

  cumulative = 0;
  let maxVal = 255;
  for (let i = 255; i >= 0; i--) {
    cumulative += hist[i];
    if (cumulative >= total * 0.02) { maxVal = i; break; }
  }

  const range = maxVal - minVal;

  // Exposure/gamma lift: pull dark frames up toward a healthy ~120 avg,
  // combined with contrast stretch so faces stay visible for the AI.
  const targetAvg = avg < 40 ? 150 : avg < 60 ? 135 : avg < 100 ? 120 : avg;
  const gain = targetAvg / Math.max(avg, 1);
  const gamma = avg < 40 ? 0.75 : avg < 70 ? 0.85 : 0.95;

  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const idx = i + c;
      let v = data[idx];
      if (range >= 10) {
        v = ((v - minVal) / range) * 255;
      }
      v = Math.pow(Math.max(v, 0) / 255, gamma) * 255;
      v = v * gain;
      data[idx] = Math.min(255, Math.max(0, v));
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

function upscaleCanvas(canvas: HTMLCanvasElement, minShortSide: number): void {
  const shortSide = Math.min(canvas.width, canvas.height);
  if (shortSide >= minShortSide) return;

  const scale = minShortSide / shortSide;
  const targetWidth = Math.round(canvas.width * scale);
  const targetHeight = Math.round(canvas.height * scale);

  const scaled = document.createElement("canvas");
  scaled.width = targetWidth;
  scaled.height = targetHeight;
  const sctx = scaled.getContext("2d");
  if (!sctx) return;
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(canvas, 0, 0, targetWidth, targetHeight);

  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const dctx = canvas.getContext("2d");
  if (!dctx) return;
  dctx.imageSmoothingEnabled = true;
  dctx.imageSmoothingQuality = "high";
  dctx.drawImage(scaled, 0, 0);
}

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [state, setState] = useState<CameraState>({
    stream: null,
    error: null,
    permissionDenied: false,
    isLoading: false,
    isPending: true,
    images: [null, null, null],
    currentAngle: 0,
    scanPhase: "idle",
    countdownValue: 3,
    brightnessWarning: false,
    resolutionWarning: false,
  });

  const cleanupCountdown = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    setState(prev => ({ ...prev, isPending: false, isLoading: true }));
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1080 } },
      });
      setState(prev => ({
        ...prev, stream, error: null, permissionDenied: false, isLoading: false, scanPhase: "streaming",
      }));
    } catch (err: any) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: err.message || "Failed to access camera",
        permissionDenied: err.name === "NotAllowedError" || err.name === "PermissionDeniedError",
      }));
    }
  }, []);

  useEffect(() => {
    if (state.stream && videoRef.current) {
      videoRef.current.srcObject = state.stream;
      videoRef.current.play().catch(console.error);
    }
  }, [state.stream]);

  const capture = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0);
    upscaleCanvas(canvas, 1080);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    enhanceLowLight(ctx, canvas.width, canvas.height);
    const base64 = canvas.toDataURL("image/jpeg", 0.8);

    const brightEnough = checkBrightness(canvas);
    const minDim = Math.min(canvas.width, canvas.height);
    const resOk = minDim >= 480;

    setState(prev => {
      const idx = prev.currentAngle;
      const imgs = [...prev.images] as [string | null, string | null, string | null];
      imgs[idx] = base64;
      return {
        ...prev,
        images: imgs,
        scanPhase: "captured",
        brightnessWarning: !brightEnough,
        resolutionWarning: !resOk,
      };
    });
  }, []);

  const startCountdown = useCallback(() => {
    setState(prev => ({ ...prev, scanPhase: "countdown", countdownValue: 3 }));
    let count = 3;
    countdownRef.current = setInterval(() => {
      count--;
      if (count <= 0) {
        cleanupCountdown();
        capture();
      } else {
        setState(prev => ({ ...prev, countdownValue: count }));
      }
    }, 1000);
  }, [capture, cleanupCountdown]);

  const nextAngle = useCallback(() => {
    setState(prev => {
      const next = prev.currentAngle + 1;
      if (next >= ANGLE_COUNT) {
        return { ...prev, scanPhase: "review" };
      }
      return { ...prev, currentAngle: next, scanPhase: "streaming", brightnessWarning: false, resolutionWarning: false };
    });
  }, []);

  const retake = useCallback(() => {
    setState(prev => {
      const idx = prev.currentAngle;
      const imgs = [...prev.images] as [string | null, string | null, string | null];
      imgs[idx] = null;
      return { ...prev, images: imgs, scanPhase: "streaming", brightnessWarning: false, resolutionWarning: false };
    });
    cleanupCountdown();
  }, [cleanupCountdown]);

  useEffect(() => {
    const s = state.stream;
    return () => {
      cleanupCountdown();
      if (s) {
        s.getTracks().forEach(track => track.stop());
      }
    };
  }, [state.stream, cleanupCountdown]);

  return {
    videoRef, canvasRef, state,
    startCamera, startCountdown, capture, retake, nextAngle,
  };
}
