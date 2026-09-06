import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { TelemetryProvider } from "@/lib/telemetry/TelemetryProvider";
import { TopBar } from "@/components/TopBar";

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
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <TelemetryProvider>
          <TopBar />
          <div className="flex-1 flex flex-col min-h-0">{children}</div>
        </TelemetryProvider>
      </body>
    </html>
  );
}
