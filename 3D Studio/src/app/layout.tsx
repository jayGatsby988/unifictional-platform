import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, Oswald, Space_Mono } from "next/font/google";
import "./globals.css";

// The Unifictional type system (same as unifictional.com): Oswald set in
// uppercase for every headline, Hanken Grotesk for body and UI, Space Mono
// for captions and eyebrows.
const oswald = Oswald({ variable: "--font-oswald", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const hanken = Hanken_Grotesk({ variable: "--font-hanken", subsets: ["latin"] });
const spaceMono = Space_Mono({ variable: "--font-space-mono", subsets: ["latin"], weight: ["400", "700"] });

const siteUrl =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null) ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
  "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "Unifictional 3D Studio — photo to 3D remodel studio", template: "%s · Unifictional 3D Studio" },
  description: "Upload photos of a kitchen, bathroom or lot. In under a minute get a photoreal, explorable 3D twin you can re-design with live pricing.",
  applicationName: "Unifictional 3D Studio",
  openGraph: { title: "Unifictional 3D Studio — photo to 3D remodel studio", description: "Photo → 3D twin → live-priced redesign in 60 seconds.", type: "website" },
};

export const viewport: Viewport = { themeColor: "#090909", width: "device-width", initialScale: 1, maximumScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${oswald.variable} ${hanken.variable} ${spaceMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-bg text-ink">{children}</body>
    </html>
  );
}
