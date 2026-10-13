/**
 * Price book — installed unit costs (US national, 2026) by price group × tier.
 * Every figure is a low/high range for MATERIAL and LABOR separately so the
 * estimator can show both. Regional multipliers scale the whole line.
 *
 * Sources (cross-checked Sept 2026): Angi/HomeAdvisor cost guides, Fixr,
 * Remodeling Magazine Cost vs Value, Houzz Kitchen & Bath Trends, NKBA,
 * manufacturer price ranges (Cambria, Caesarstone, James Hardie, GAF, Trex).
 * Numbers are calibrated per-tier for a licensed contractor's installed price.
 */
import type { DecorSpec, Tier } from '@/lib/spec/types';
import type { PriceGroup } from '@/lib/materials/catalog';

export type Range = { low: number; high: number };
export interface UnitPrice { unit: 'sqft' | 'lf' | 'each' | 'sq' | 'ls'; material: Range; labor: Range }
export type TierTable = Record<Tier, UnitPrice>;

const up = (unit: UnitPrice['unit'], mLow: number, mHigh: number, lLow: number, lHigh: number): UnitPrice => ({ unit, material: { low: mLow, high: mHigh }, labor: { low: lLow, high: lHigh } });

export const PRICE_BOOK: Record<PriceGroup, TierTable> = {
  // Cabinets — $/linear foot of run (base + upper counted separately; islands as base LF)
  'cabinet-paint': {
    budget: up('lf', 90, 160, 45, 70),        // stock, painted MDF/thermofoil
    standard: up('lf', 180, 300, 60, 90),     // semi-custom painted shaker
    premium: up('lf', 320, 550, 75, 110),     // custom painted, inset/beaded
    luxury: up('lf', 600, 1100, 90, 140),     // bespoke, hand-finished
  },
  'cabinet-wood': {
    budget: up('lf', 110, 190, 45, 70),
    standard: up('lf', 220, 360, 60, 90),
    premium: up('lf', 380, 650, 75, 110),     // rift white oak, walnut veneer
    luxury: up('lf', 700, 1300, 90, 140),
  },
  // Countertops — $/sqft installed (slab + fabrication + install)
  countertop: {
    budget: up('sqft', 18, 40, 12, 22),       // laminate / butcher block
    standard: up('sqft', 45, 75, 25, 40),     // quartz, granite
    premium: up('sqft', 75, 120, 30, 50),     // premium quartz, marble, concrete
    luxury: up('sqft', 120, 220, 35, 60),     // quartzite, exotic marble
  },
  backsplash: {
    budget: up('sqft', 4, 9, 12, 20),
    standard: up('sqft', 9, 18, 15, 25),
    premium: up('sqft', 18, 40, 18, 32),
    luxury: up('sqft', 40, 110, 22, 40),
  },
  'wall-tile': {
    budget: up('sqft', 3, 7, 10, 16),
    standard: up('sqft', 7, 14, 12, 20),
    premium: up('sqft', 14, 30, 15, 26),
    luxury: up('sqft', 30, 80, 18, 34),
  },
  flooring: {
    budget: up('sqft', 2.5, 5, 2.5, 4.5),     // LVP
    standard: up('sqft', 5, 9, 4, 7),         // engineered / porcelain
    premium: up('sqft', 9, 15, 5, 9),         // solid hardwood / large-format
    luxury: up('sqft', 15, 30, 7, 14),        // herringbone / marble
  },
  'wall-paint': {
    budget: up('sqft', 0.4, 0.7, 1.2, 2.0),
    standard: up('sqft', 0.6, 1.0, 1.6, 2.8),
    premium: up('sqft', 0.9, 1.4, 2.0, 3.5),
    luxury: up('sqft', 1.2, 2.0, 2.5, 4.5),
  },
  ceiling: {
    budget: up('sqft', 0.4, 0.7, 1.2, 2.0),
    standard: up('sqft', 0.6, 1.0, 1.5, 2.5),
    premium: up('sqft', 1.0, 1.6, 2.0, 3.5),
    luxury: up('sqft', 1.5, 2.5, 2.5, 4.5),
  },
  // Exterior — $/sqft of wall area
  siding: {
    budget: up('sqft', 2.5, 5, 2.5, 4.5),     // vinyl
    standard: up('sqft', 5, 9, 4, 7),         // fiber cement lap
    premium: up('sqft', 9, 16, 5, 9),         // cedar, board & batten, composite, metal
    luxury: up('sqft', 9, 18, 6, 10),         // brick / stone veneer (installed 15–28)
  },
  'exterior-paint': {
    budget: up('sqft', 0.5, 0.9, 1.5, 2.5),
    standard: up('sqft', 0.8, 1.3, 2.0, 3.5),
    premium: up('sqft', 1.1, 1.8, 2.5, 4.0),
    luxury: up('sqft', 1.5, 2.5, 3.0, 5.0),
  },
  // Roofing — $/square (100 sqft)
  roof: {
    budget: up('sq', 120, 200, 200, 320),     // 3-tab asphalt
    standard: up('sq', 200, 320, 250, 400),   // architectural asphalt
    premium: up('sq', 600, 1100, 450, 800),   // standing seam metal, concrete tile
    luxury: up('sq', 1100, 2200, 700, 1300),  // slate, clay, cedar shake
  },
  'entry-door': {
    budget: up('each', 500, 1200, 300, 600),
    standard: up('each', 1200, 2800, 400, 800),
    premium: up('each', 2800, 6000, 500, 1000),
    luxury: up('each', 6000, 15000, 800, 1800),
  },
  'garage-door': {
    budget: up('each', 900, 1600, 400, 700),
    standard: up('each', 1600, 3200, 500, 900),
    premium: up('each', 3200, 6500, 600, 1100),
    luxury: up('each', 6500, 14000, 800, 1500),
  },
  window: {
    budget: up('each', 350, 650, 200, 350),
    standard: up('each', 650, 1200, 250, 450),
    premium: up('each', 1200, 2200, 300, 550),
    luxury: up('each', 2200, 4500, 400, 800),
  },
  hardscape: {
    budget: up('sqft', 3, 6, 4, 7),           // broom concrete / gravel
    standard: up('sqft', 6, 10, 6, 10),       // pavers
    premium: up('sqft', 10, 18, 8, 14),       // patterned pavers / stamped
    luxury: up('sqft', 18, 35, 10, 18),       // natural stone
  },
  lawn: {
    budget: up('sqft', 0.3, 0.6, 0.4, 0.8),   // seed
    standard: up('sqft', 0.8, 1.4, 0.6, 1.2), // sod
    premium: up('sqft', 1.4, 2.5, 0.8, 1.5),  // sod + irrigation
    luxury: up('sqft', 6, 12, 3, 6),          // artificial turf
  },
  fence: {
    budget: up('lf', 12, 22, 10, 18),
    standard: up('lf', 14, 26, 10, 18),       // cedar privacy (installed 24–44)
    premium: up('lf', 40, 70, 18, 30),        // horizontal cedar / aluminum
    luxury: up('lf', 70, 140, 25, 45),
  },
  deck: {
    budget: up('sqft', 12, 20, 15, 25),       // pressure-treated
    standard: up('sqft', 20, 32, 18, 30),     // cedar
    premium: up('sqft', 22, 38, 16, 26),      // composite (installed 38–64)
    luxury: up('sqft', 55, 95, 28, 45),       // ipe / steel-frame
  },
  railing: {
    budget: up('lf', 25, 45, 20, 35),
    standard: up('lf', 45, 80, 25, 45),
    premium: up('lf', 80, 160, 30, 55),       // cable / glass
    luxury: up('lf', 160, 320, 40, 70),
  },
  column: {
    budget: up('each', 250, 500, 150, 300),
    standard: up('each', 500, 1100, 250, 450),
    premium: up('each', 1100, 2400, 350, 650),
    luxury: up('each', 2400, 5000, 500, 900),
  },
  gutter: {
    budget: up('lf', 4, 7, 3, 6),
    standard: up('lf', 7, 12, 4, 8),
    premium: up('lf', 12, 20, 5, 9),
    luxury: up('lf', 25, 45, 6, 12),          // copper
  },
  // Finishes — $/each fixture
  'fixture-finish': {
    budget: up('each', 120, 250, 150, 250),
    standard: up('each', 250, 550, 180, 320),
    premium: up('each', 550, 1200, 220, 380),
    luxury: up('each', 1200, 3500, 280, 500),
  },
  'appliance-finish': {
    budget: up('ls', 2500, 4500, 400, 800),   // package (fridge, range, DW, micro)
    standard: up('ls', 4500, 9000, 500, 1000),
    premium: up('ls', 9000, 18000, 700, 1400),
    luxury: up('ls', 18000, 45000, 1200, 2500),
  },
  hardware: {
    budget: up('each', 3, 7, 3, 5),
    standard: up('each', 7, 16, 3, 5),
    premium: up('each', 16, 35, 4, 6),
    luxury: up('each', 35, 90, 4, 7),
  },
  lighting: {
    budget: up('each', 80, 180, 120, 200),
    standard: up('each', 180, 420, 140, 240),
    premium: up('each', 420, 1000, 160, 280),
    luxury: up('each', 1000, 3000, 200, 350),
  },
  tub: {
    budget: up('each', 400, 900, 600, 1200),
    standard: up('each', 900, 1800, 800, 1500),
    premium: up('each', 1800, 4000, 1000, 1800),
    luxury: up('each', 4000, 10000, 1200, 2200),
  },
  mirror: {
    budget: up('each', 80, 200, 80, 150),
    standard: up('each', 200, 450, 100, 180),
    premium: up('each', 450, 1000, 120, 220),
    luxury: up('each', 1000, 2500, 150, 300),
  },
};

/**
 * The six lump-sum trades the allowance table carries. Named so the estimator
 * can key a factor per trade in changes mode without stringly-typed lookups.
 */
export type AllowanceKey = 'demo' | 'electrical' | 'plumbing' | 'drywall' | 'design' | 'permits';

/** Fixed / lump-sum allowances by room type + scope */
export const ALLOWANCES = {
  kitchen: {
    cosmetic: { demo: [400, 900], electrical: [300, 800], plumbing: [200, 600], permits: [0, 250], drywall: [0, 400], design: [0, 0] },
    'pull-and-replace': { demo: [1200, 2500], electrical: [1500, 3500], plumbing: [1200, 3000], permits: [600, 2200], drywall: [600, 1800], design: [500, 2500] },
    'full-gut': { demo: [2500, 5000], electrical: [4000, 9000], plumbing: [3500, 8000], permits: [1200, 3200], drywall: [2500, 6000], design: [2500, 8000] },
  },
  bathroom: {
    cosmetic: { demo: [300, 700], electrical: [200, 600], plumbing: [300, 900], permits: [0, 200], drywall: [0, 300], design: [0, 0] },
    'pull-and-replace': { demo: [800, 1800], electrical: [900, 2200], plumbing: [1800, 4500], permits: [400, 1700], drywall: [500, 1500], design: [400, 1800] },
    'full-gut': { demo: [1500, 3200], electrical: [2000, 4500], plumbing: [4500, 11000], permits: [600, 1800], drywall: [1500, 4000], design: [1500, 5000] },
  },
  exterior: {
    cosmetic: { demo: [0, 800], electrical: [0, 600], plumbing: [0, 0], permits: [0, 300], drywall: [0, 0], design: [0, 0] },
    'pull-and-replace': { demo: [1500, 4500], electrical: [500, 1800], plumbing: [0, 500], permits: [500, 1800], drywall: [0, 0], design: [800, 3500] },
    'full-gut': { demo: [4000, 12000], electrical: [1500, 4500], plumbing: [500, 2500], permits: [1500, 5000], drywall: [0, 0], design: [3000, 12000] },
  },
  // A whole-house interior refinish: several times a single room's allowances
  // because the trades walk every storey, and design carries the drawing set.
  floorplan: {
    cosmetic: { demo: [1200, 3000], electrical: [800, 2400], plumbing: [0, 600], permits: [0, 600], drywall: [1200, 3600], design: [0, 1500] },
    'pull-and-replace': { demo: [4000, 10000], electrical: [4000, 11000], plumbing: [1500, 5000], permits: [1500, 4500], drywall: [3500, 9000], design: [2500, 9000] },
    'full-gut': { demo: [9000, 26000], electrical: [10000, 26000], plumbing: [6000, 18000], permits: [3000, 9000], drywall: [8000, 22000], design: [7000, 25000] },
  },
} as const;

/**
 * Window treatments, per window, supplied and hung. Part of a remodel bid the
 * moment the photo shows one (a client who has roman shades expects roman
 * shades in the new kitchen); the other décor the analyzer detects — rugs,
 * plants, art — is furnishing, not contractor scope, and is never priced.
 */
export const WINDOW_TREATMENT: Record<DecorSpec['windowTreatment'], { material: Range; labor: Range }> = {
  none: { material: { low: 0, high: 0 }, labor: { low: 0, high: 0 } },
  blinds: { material: { low: 60, high: 180 }, labor: { low: 40, high: 80 } },
  roller: { material: { low: 90, high: 260 }, labor: { low: 40, high: 90 } },
  'cafe-curtain': { material: { low: 60, high: 200 }, labor: { low: 40, high: 90 } },
  'roman-shade': { material: { low: 180, high: 520 }, labor: { low: 60, high: 120 } },
  curtains: { material: { low: 150, high: 600 }, labor: { low: 80, high: 160 } },
};

export interface Region { id: string; name: string; multiplier: number; laborMultiplier: number; /** sales tax applied to the full contract where the state taxes construction (WA) */ salesTaxPct: number }
export const REGIONS: Region[] = [
  { id: 'national', name: 'US National Average', multiplier: 1.0, laborMultiplier: 1.0, salesTaxPct: 0.0 },
  { id: 'seattle', name: 'Seattle / Puget Sound, WA', multiplier: 1.1, laborMultiplier: 1.32, salesTaxPct: 0.1035 },
  { id: 'portland', name: 'Portland, OR', multiplier: 1.15, laborMultiplier: 1.2, salesTaxPct: 0.0 },
  { id: 'spokane', name: 'Spokane / Eastern WA', multiplier: 1.02, laborMultiplier: 1.05, salesTaxPct: 0.09 },
  { id: 'sf-bay', name: 'San Francisco Bay Area', multiplier: 1.55, laborMultiplier: 1.7, salesTaxPct: 0.0 },
  { id: 'los-angeles', name: 'Los Angeles', multiplier: 1.35, laborMultiplier: 1.4, salesTaxPct: 0.0 },
  { id: 'san-diego', name: 'San Diego', multiplier: 1.3, laborMultiplier: 1.35, salesTaxPct: 0.0 },
  { id: 'denver', name: 'Denver', multiplier: 1.1, laborMultiplier: 1.12, salesTaxPct: 0.0 },
  { id: 'phoenix', name: 'Phoenix', multiplier: 0.98, laborMultiplier: 0.97, salesTaxPct: 0.0 },
  { id: 'austin', name: 'Austin', multiplier: 1.02, laborMultiplier: 1.0, salesTaxPct: 0.0 },
  { id: 'dallas', name: 'Dallas–Fort Worth', multiplier: 0.97, laborMultiplier: 0.95, salesTaxPct: 0.0 },
  { id: 'houston', name: 'Houston', multiplier: 0.95, laborMultiplier: 0.93, salesTaxPct: 0.0 },
  { id: 'chicago', name: 'Chicago', multiplier: 1.15, laborMultiplier: 1.25, salesTaxPct: 0.0 },
  { id: 'minneapolis', name: 'Minneapolis', multiplier: 1.08, laborMultiplier: 1.12, salesTaxPct: 0.0 },
  { id: 'atlanta', name: 'Atlanta', multiplier: 0.96, laborMultiplier: 0.94, salesTaxPct: 0.0 },
  { id: 'miami', name: 'Miami', multiplier: 1.08, laborMultiplier: 1.05, salesTaxPct: 0.0 },
  { id: 'nyc', name: 'New York City', multiplier: 1.6, laborMultiplier: 1.8, salesTaxPct: 0.0 },
  { id: 'boston', name: 'Boston', multiplier: 1.4, laborMultiplier: 1.5, salesTaxPct: 0.0 },
  { id: 'dc', name: 'Washington, DC', multiplier: 1.25, laborMultiplier: 1.3, salesTaxPct: 0.0 },
  { id: 'nashville', name: 'Nashville', multiplier: 1.0, laborMultiplier: 0.98, salesTaxPct: 0.0 },
  { id: 'salt-lake', name: 'Salt Lake City', multiplier: 1.03, laborMultiplier: 1.02, salesTaxPct: 0.0 },
  { id: 'rural', name: 'Rural / Small Metro', multiplier: 0.88, laborMultiplier: 0.85, salesTaxPct: 0.0 },
];

/** Ordering waste factors by price group (net → ordered quantity) */
export const WASTE_PCT: Partial<Record<PriceGroup, number>> = {
  backsplash: 0.12, 'wall-tile': 0.12, flooring: 0.08, siding: 0.12, roof: 0.12, hardscape: 0.05, deck: 0.08, lawn: 0.05, countertop: 0.0,
};

export const REGION_BY_ID: Record<string, Region> = Object.fromEntries(REGIONS.map((r) => [r.id, r]));
