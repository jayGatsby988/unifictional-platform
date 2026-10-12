// @ts-nocheck
// Ten brains, ten keys. Each role's agent runs on its own API key
// (AGENT_KEY_<ROLE>), so each has its own limits and its own bill. A role
// without a key falls back to the studio's main key, so the team still runs
// while keys are being added.
export const ROLES = ["researcher", "architect", "writer", "pack", "motion", "art", "photo", "debugger", "seo", "reviewer"] as const;
export type Role = typeof ROLES[number];

export const ROLE_TITLE: Record<Role, string> = {
  researcher: "Researcher", architect: "Architect", writer: "Writer", pack: "Pack designer", motion: "Motion engineer",
  art: "Art director", photo: "Photo editor", debugger: "Debugger", seo: "SEO", reviewer: "Reviewer",
};

export function keyFor(role: Role): string {
  return process.env[`AGENT_KEY_${role.toUpperCase()}`] || (role === "debugger" ? process.env.DEBUG_ANTHROPIC_API_KEY : "") || process.env.ANTHROPIC_API_KEY || "";
}
export function ownKey(role: Role): boolean { return Boolean(process.env[`AGENT_KEY_${role.toUpperCase()}`] || (role === "debugger" && process.env.DEBUG_ANTHROPIC_API_KEY)); }
export const teamModel = (role: Role) => process.env[`UNIF_MODEL_${role.toUpperCase()}`] || process.env.UNIF_MODEL || "claude-fable-5-1";
