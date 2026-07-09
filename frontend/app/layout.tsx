import type { Metadata } from "next";
import { Geist, Geist_Mono, Fraunces, Inter, Newsreader } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { MetaPixel } from "@/components/meta-pixel";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Serif used by `.evr-headline` for marketing + onboarding hero copy.
// Loaded once at the root so every surface gets it without re-declaring.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// Used only by the marketing landing's chat-demo greeting ("Afternoon"),
// to match Claude's greeting type. Scoped via the --font-newsreader variable.
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["400"],
});

const BASE_URL = "https://evovlerun.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: "EvolveRun — Simple AI endurance coach for Strava athletes",
    template: "%s · EvolveRun",
  },
  description:
    "Connect Strava. Get answers. EvolveRun lets Claude or ChatGPT answer real questions about your training using your real data.",
  openGraph: {
    type: "website",
    url: BASE_URL,
    siteName: "EvolveRun",
    title: "EvolveRun — Simple AI endurance coach for Strava athletes",
    description:
      "Connect Strava. Get answers. EvolveRun lets Claude or ChatGPT answer real questions about your training using your real data.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "EvolveRun" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "EvolveRun — AI coach for Strava athletes",
    description:
      "Ask Claude anything about your runs. EvolveRun connects your Strava data to Claude & ChatGPT.",
    images: ["/og.png"],
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} ${inter.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <MetaPixel />
        <Analytics />
      </body>
    </html>
  );
}
