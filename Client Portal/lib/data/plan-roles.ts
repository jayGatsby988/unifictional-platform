/**
 * What a plan row does in the plan builder. Kept apart from lib/data/plans.ts
 * (which reads Supabase through next/headers) so client components can import it.
 * null = shown as before (quoted by the studio).
 */
export type PlanRole = "posts" | "website" | "social" | "gbp";

export const PLAN_ROLES: { key: PlanRole; label: string }[] = [
  { key: "posts", label: "The posts (base rate)" },
  { key: "website", label: "Website add-on" },
  { key: "social", label: "Social add-on" },
  { key: "gbp", label: "Google Business Profile add-on" },
];
