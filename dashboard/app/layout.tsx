import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { TelemetryProvider } from "@/lib/telemetry/TelemetryProvider";
import { TopBar } from "@/components/TopBar";
import { PwaRegister } from "@/components/pwa/PwaRegister";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "EdgeFleet · AMR Fleet Coordination Monitor",
  description:
    "Read-only fleet dashboard for decentralised AMR coordination — SIH 2026 PS 26123 (BEL). Robots decide; the dashboard listens.",
  applicationName: "EdgeFleet",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black",
    title: "EdgeFleet",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0A1020",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <TelemetryProvider>
          <TopBar />
          <div className="flex-1 flex flex-col min-h-0">{children}</div>
        </TelemetryProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
