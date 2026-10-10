import type { PriceOption, ProjectType } from "@/lib/data/types";

/**
 * Starter price lists so a new contractor never faces a blank editor.
 * The numbers are rough starting points only; the UI says so and the
 * contractor edits them before anything is published to their website.
 */
export type PricingTemplate = {
  key: string;
  label: string;
  match: RegExp;
  projectTypes: ProjectType[];
  options: PriceOption[];
};

const t = (id: string, name: string, unit: ProjectType["unit"], baseRate: number, minPrice: number): ProjectType =>
  ({ id, name, unit, baseRate, minPrice, enabled: true });
const o = (id: string, name: string, priceType: PriceOption["priceType"], amount: number, appliesTo: string[] = []): PriceOption =>
  ({ id, name, priceType, amount, appliesTo, enabled: true });

export const PRICING_TEMPLATES: PricingTemplate[] = [
  {
    key: "remodel", label: "Remodeling", match: /remodel|kitchen|bath|renovat|interior|builder|general contract/i,
    projectTypes: [t("kitchen", "Kitchen remodel", "sqft", 250, 25000), t("bath", "Bathroom remodel", "sqft", 400, 15000), t("basement", "Basement finish", "sqft", 60, 20000)],
    options: [o("cabinets", "Custom cabinets", "percent", 15, ["kitchen"]), o("heated", "Heated floors", "per_unit", 25, ["bath"]), o("design", "Design & permits", "flat", 3500)],
  },
  {
    key: "deck", label: "Decks & fences", match: /deck|fence|patio cover|pergola|carpent/i,
    projectTypes: [t("deck", "Composite deck", "sqft", 65, 12000), t("fence", "Cedar fence", "lf", 55, 3500)],
    options: [o("stairs", "Stairs", "flat", 2500, ["deck"]), o("lighting", "Built-in lighting", "flat", 1800, ["deck"]), o("gate", "Walk gate", "flat", 900, ["fence"])],
  },
  {
    key: "landscape", label: "Landscaping & hardscape", match: /landscap|hardscap|paver|lawn|garden|yard|retaining/i,
    projectTypes: [t("patio", "Paver patio", "sqft", 35, 6000), t("wall", "Retaining wall", "lf", 120, 5000), t("lawn", "New lawn", "sqft", 3, 2500)],
    options: [o("lights", "Landscape lighting", "flat", 2800), o("drain", "Drainage", "per_unit", 8), o("removal", "Remove what's there now", "flat", 1500)],
  },
  {
    key: "roof", label: "Roofing", match: /roof|gutter|siding/i,
    projectTypes: [t("shingle", "Asphalt shingle roof", "sqft", 9, 12000), t("metal", "Metal roof", "sqft", 16, 20000)],
    options: [o("tearoff", "Tear off old roof", "per_unit", 2), o("gutters", "New gutters", "flat", 2500), o("skylight", "Skylight", "flat", 1800)],
  },
  {
    key: "excavation", label: "Excavation & site work", match: /excavat|grading|site work|septic|land clear|driveway|gate/i,
    projectTypes: [t("clear", "Land clearing", "sqft", 2, 3000), t("drive", "Gravel driveway", "sqft", 6, 4000), t("trench", "Trenching", "lf", 25, 1500)],
    options: [o("haul", "Haul-off", "flat", 1200), o("erosion", "Erosion control", "flat", 900)],
  },
];

export function suggestTemplate(industry: string): PricingTemplate {
  return PRICING_TEMPLATES.find((p) => p.match.test(industry)) ?? PRICING_TEMPLATES[0];
}

export const DEFAULT_DISCLAIMER = "This is a ballpark range, not a bid. Your final price is confirmed after a free on-site visit.";

/** Typical job size per starter type, so the preview shows a believable number. */
export const TYPICAL_SIZE: Record<string, number> = {
  kitchen: 200, bath: 60, basement: 800, deck: 300, fence: 150, patio: 300, wall: 60, lawn: 2000,
  shingle: 2000, metal: 2000, clear: 10000, drive: 1500, trench: 100,
};
