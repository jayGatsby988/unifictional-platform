// @ts-nocheck
// Their brand, not ours. What the crawl found on the client's site (logo,
// colours, fonts, light or dark surface) becomes the theme of the site we
// build for them: their logo in the nav, their colour as the accent, their
// surface mode, and the type pair closest to their own type. The planner and
// the team's Architect are told this, and this module enforces it in code
// after they have chosen, so a site never ships in a palette that is not the
// client's when the client has one.

const SERIF = /playfair|merriweather|lora|georgia|cormorant|garamond|baskerville|libre|crimson|dm serif|pt serif|noto serif|source serif|times|cardo|spectral|fraunces|bodoni|didot|prata|cinzel/i;
const CONDENSED = /oswald|bebas|anton|barlow condensed|roboto condensed|fjalla|teko|league gothic|antonio|pathway|saira condensed|big shoulders|archivo narrow|impact/i;
const GEOMETRIC = /montserrat|poppins|raleway|nunito|quicksand|futura|avenir|proxima|gotham|circular|jost|outfit|urbanist|plus jakarta|manrope|dm sans|sora/i;
const GROTESK = /inter|roboto|helvetica|arial|open sans|lato|work sans|source sans|ibm plex|public sans|karla|rubik|figtree|hanken|space grotesk|archivo|syne/i;

/** The pair in our registry closest to their heading type. Empty when their fonts say nothing. */
export function pairForFonts(fonts = []) {
  const names = (fonts || []).slice(0, 3).join(" | ");
  if (!names) return "";
  if (SERIF.test(names)) return "fraunces";
  if (CONDENSED.test(names)) return "anton";
  if (GEOMETRIC.test(names)) return "jost";
  if (GROTESK.test(names)) return "archivo";
  return "";
}

const hexLum = (hex) => { const h = hex.replace("#", ""); const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
const LINK_BLUE = /^#(0000ee|0000ff|1a0dab|0066cc|0073aa|0073e6|007bff|0d6efd|2196f3|1e88e5|3b82f6|2563eb|1d4ed8|0a66c2|1877f2)$/i;

/** Their accent: the first brand-coloured candidate that is not a stock link blue. */
export function accentFrom(colors = []) {
  for (const c of colors || []) { if (!/^#[0-9a-f]{6}$/i.test(c)) continue; if (LINK_BLUE.test(c)) continue; return c.toLowerCase(); }
  return "";
}

/** light | dark from the client's body background, when the crawl found one. */
export function modeFrom(analysis) {
  const bg = analysis?.bodyBg;
  if (bg && /^#[0-9a-f]{6}$/i.test(bg)) return hexLum(bg) > 0.5 ? "light" : "dark";
  return "";
}

/** The brand block for a plan or a spec: logo, colours, fonts, mode. Never overwrites what is already set unless `force`. */
export function brandFromAnalysis(a) {
  if (!a) return {};
  const out: any = {};
  if (a.logo && (a.logo.url || a.logo.kind === "svg")) { out.logo = { ...a.logo, icon: a.icon }; out.useLogo = true; }
  if (Array.isArray(a.colors) && a.colors.length) out.colors = a.colors.slice(0, 6);
  if (Array.isArray(a.fonts) && a.fonts.length) out.fonts = a.fonts.slice(0, 4);
  if (a.domain) out.domain = a.domain;
  return out;
}

/**
 * Hold a plan or spec to the client's brand: logo on, accent from their
 * colours when the chosen accent is not one of them, mode from their site,
 * type pair closest to theirs when the chosen pair is not already a match.
 * Returns the list of changes made (for the journal).
 */
export function applyBrand(target, analysis, { stampPrefix = "brand" } = {}) {
  const notes = [];
  if (!analysis) return notes;
  target.brand = target.brand || {}; target.theme = target.theme || {};
  const b = brandFromAnalysis(analysis);
  if (b.logo && !target.brand.logo?.url) { target.brand.logo = b.logo; notes.push(`${stampPrefix}: their logo goes in the nav and footer`); }
  if (b.logo) target.brand.useLogo = true;
  if (b.colors) target.brand.colors = b.colors;
  if (b.fonts) target.brand.fonts = b.fonts;
  const accent = accentFrom(b.colors);
  if (accent && String(target.theme.accent || "").toLowerCase() !== accent && !(b.colors || []).map(c => c.toLowerCase()).includes(String(target.theme.accent || "").toLowerCase())) {
    notes.push(`${stampPrefix}: accent ${target.theme.accent || "(none)"} → their ${accent}`); target.theme.accent = accent;
  }
  const mode = modeFrom(analysis);
  if (mode && target.theme.mode !== mode) { notes.push(`${stampPrefix}: surface ${target.theme.mode || "(unset)"} → ${mode}, like their site`); target.theme.mode = mode; }
  const pair = pairForFonts(b.fonts);
  if (pair && target.theme.pair !== pair && target.theme.pair !== "custom") { notes.push(`${stampPrefix}: type pair ${target.theme.pair || "(unset)"} → ${pair}, closest to their ${(b.fonts || [])[0]}`); target.theme.pair = pair; }
  return notes;
}
