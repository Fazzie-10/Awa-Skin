"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import CameraCapture from "@/components/CameraCapture";

export default function CameraPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const consent = sessionStorage.getItem("awaConsentGiven");
    if (!consent) {
      router.replace("/scan");
    } else {
      setReady(true);
    }
  }, [router]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-surface-warm flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
      </div>
    );
  }

  return <CameraCapture />;
}