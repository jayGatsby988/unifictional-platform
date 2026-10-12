import type { Metadata } from "next";
import { Oswald, Hanken_Grotesk, Space_Mono } from "next/font/google";
import "./globals.css";

const oswald = Oswald({ variable: "--font-oswald", subsets: ["latin"], weight: ["500"], display: "swap" });
const hanken = Hanken_Grotesk({ variable: "--font-hanken", subsets: ["latin"], weight: ["400", "500"], display: "swap" });
const spaceMono = Space_Mono({ variable: "--font-space-mono", subsets: ["latin"], weight: ["400"], display: "swap" });

export const metadata: Metadata = {
  title: "Client Portal — Unifictional",
  description: "See how your website, search visibility, social and SEO Autopilot are doing.",
};

const themeScript = `try{var t=localStorage.getItem('portal-theme');document.documentElement.setAttribute('data-theme',t==='dark'?'dark':'light');}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning
      className={`${oswald.variable} ${hanken.variable} ${spaceMono.variable} h-full`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
