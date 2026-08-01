import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AWA SKIN — Intelligent Skincare for Real Skin",
  description: "AI-powered skin analysis that matches you with proven products available in Nigeria. No fluff. No import headaches.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "AWA SKIN",
  },
};

export const viewport: Viewport = {
  themeColor: "#0e0c0f",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning data-scroll-behavior="smooth">
      <body className="font-sans">{children}</body>
    </html>
  );
}
