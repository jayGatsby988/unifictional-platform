import type { Metadata, Viewport } from "next";
import { Oswald, Hanken_Grotesk, Space_Mono } from "next/font/google";
import "./globals.css";

import { siteConfig, services } from "@/lib/site";
import { industries } from "@/lib/industries";
import { Nav } from "@/components/sections/nav";
import { FloatingCta } from "@/components/ui/floating-cta";
import { Footer } from "@/components/sections/footer";
import { REVEAL_ARM, REVEAL_SCRIPT } from "@/components/ui/reveal";

/**
 * Type system (monochrome / architectural):
 *  • Oswald — a bold condensed grotesque set in uppercase for every headline.
 *    Industrial, exclusive, gallery-like — the spine of the new identity.
 *  • Hanken Grotesk — a clean grotesk for body/UI: calm, legible, neutral.
 *  • Space Mono — a characterful mono used only for small labels, indices, and
 *    captions, like annotations on an architectural drawing.
 */
const oswald = Oswald({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  // 400 only — the one bold mono label (a dev-mode notice) synthesises fine,
  // and it saves a preloaded font file on every page.
  weight: ["400"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    // Leads with what people search — web design, SEO, and social for
    // contractors — rather than with the studio's self-description.
    default: "Contractor Marketing Agency — Websites, SEO & Social | Unifictional",
    template: "%s — Unifictional",
  },
  description: siteConfig.description,
  keywords: [...siteConfig.keywords],
  applicationName: siteConfig.name,
  authors: [{ name: siteConfig.name, url: siteConfig.url }],
  creator: siteConfig.name,
  publisher: siteConfig.name,
  category: "Marketing & Advertising",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteConfig.url,
    siteName: siteConfig.name,
    title: "Contractor Marketing Agency — Websites, SEO & Social | Unifictional",
    description: siteConfig.description,
  },
  twitter: {
    card: "summary_large_image",
    title: "Contractor Marketing Agency — Websites, SEO & Social",
    description: siteConfig.description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
};

export const viewport: Viewport = {
  themeColor: "#FFFFFF",
  colorScheme: "light dark",
  width: "device-width",
  initialScale: 1,
};

// Runs before paint: honour a saved choice, otherwise default to light.
const themeInit = `try{var t=localStorage.getItem('theme');document.documentElement.setAttribute('data-theme', t==='dark'?'dark':'light');}catch(e){document.documentElement.setAttribute('data-theme','light');}`;

/**
 * Site-wide entity graph.
 *
 * The studio sells SEO, so its own site should pass an SEO checker — but the
 * bigger reason this is detailed is entity resolution: assistants and search
 * engines answering "who does marketing for contractors" need a machine-
 * readable definition of what this company is, what it offers, and who it
 * serves. `knowsAbout` and the offer catalogue are the fields that do that.
 *
 * Kept strictly truthful: no invented ratings, addresses, employee counts, or
 * founding dates.
 */
const siteJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${siteConfig.url}/#website`,
      url: siteConfig.url,
      name: siteConfig.name,
      description: siteConfig.description,
      inLanguage: "en-US",
      publisher: { "@id": `${siteConfig.url}/#org` },
    },
    {
      "@type": ["ProfessionalService", "MarketingAgency"],
      "@id": `${siteConfig.url}/#org`,
      name: siteConfig.name,
      alternateName: "Unifictional Studio",
      url: siteConfig.url,
      description: siteConfig.description,
      slogan: siteConfig.discipline,
      image: `${siteConfig.url}/opengraph-image.jpg`,
      logo: `${siteConfig.url}/opengraph-image.jpg`,
      email: siteConfig.bookingEmail,
      areaServed: { "@type": "Country", name: "United States" },
      availableLanguage: "English",
      knowsAbout: [
        "contractor website design",
        "construction website design",
        "SEO for contractors",
        "SEO for construction companies",
        "local SEO for home services",
        "Google Business Profile optimization",
        "social media marketing for contractors",
        "short-form video for construction companies",
        "lead generation for contractors",
        "missed call text back",
        "AI receptionist for contractors",
        "marketing for remodelers and custom home builders",
      ],
      makesOffer: services.map((s) => ({
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: s.title,
          description: s.description,
          url: `${siteConfig.url}/services/${s.slug}`,
        },
      })),
      hasOfferCatalog: {
        "@type": "OfferCatalog",
        name: "Marketing services for contractors and builders",
        itemListElement: industries.map((i) => ({
          "@type": "Offer",
          itemOffered: {
            "@type": "Service",
            name: i.title,
            description: i.description,
            url: `${siteConfig.url}/industries/${i.slug}`,
          },
        })),
      },
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "sales",
        email: siteConfig.bookingEmail,
        url: `${siteConfig.url}/contact`,
        areaServed: "US",
        availableLanguage: "English",
      },
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${oswald.variable} ${hanken.variable} ${spaceMono.variable}`}
    >
      <body className="bg-bone font-sans text-ink antialiased">
        {/* Set the theme before paint (dark by default) to avoid a flash. */}
        <script dangerouslySetInnerHTML={{ __html: themeInit + REVEAL_ARM }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd).replace(/</g, "\\u003c") }}
        />
        <Nav />
        <main>{children}</main>
        <FloatingCta />
        <Footer />
        {/* Scroll-reveal observer — runs before (and independent of) React. */}
        <script dangerouslySetInnerHTML={{ __html: REVEAL_SCRIPT }} />
      </body>
    </html>
  );
}
