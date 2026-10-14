import { timingSafeEqual } from "node:crypto";

/**
 * Other Unifictional apps (the Unifictional 3D Studio) bill through the portal so
 * Square's key stays in one place. They prove who they are with PLATFORM_KEY,
 * the same value on both projects.
 */
export function platformAuthorized(request: Request): boolean {
  const want = process.env.PLATFORM_KEY ?? "";
  const got = request.headers.get("x-platform-key") ?? "";
  return want.length > 0 && want.length === got.length && timingSafeEqual(Buffer.from(want), Buffer.from(got));
}

/** The one-off unlock for the 3D studio: $1 to start, editable in REMODEL_UNLOCK_CENTS. */
export const UNLOCK_CENTS = Math.max(100, Number(process.env.REMODEL_UNLOCK_CENTS || 100));
