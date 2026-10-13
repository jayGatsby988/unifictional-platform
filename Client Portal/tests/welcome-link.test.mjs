import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
const { welcomeLink, readWelcomeToken, newWelcomeNonce } = await import("../lib/accounts/welcome-link.ts");

test("welcome link points at /auth/welcome, keeps a safe next path", () => {
  const url = new URL(welcomeLink({ userId: "u1", nonce: newWelcomeNonce(), origin: "https://portal.example", next: "/autopilot" }));
  assert.equal(url.pathname, "/auth/welcome");
  assert.equal(url.searchParams.get("next"), "/autopilot");
  assert.match(url.searchParams.get("t") ?? "", /^[\w-]+\.[\w-]+$/);
  const offsite = new URL(welcomeLink({ userId: "u1", nonce: "n", origin: "https://portal.example", next: "https://evil.example" }));
  assert.equal(offsite.searchParams.get("next"), "/overview");
});

test("a forged or tampered token is refused before any lookup", async () => {
  const t = new URL(welcomeLink({ userId: "u1", nonce: "n", origin: "https://x" })).searchParams.get("t");
  const [payload, sig] = t.split(".");
  const forged = Buffer.from(JSON.stringify({ u: "someone-else", n: "n", e: Date.now() + 1e9 })).toString("base64url");
  assert.deepEqual(await readWelcomeToken(`${forged}.${sig}`), { ok: false });
  assert.deepEqual(await readWelcomeToken(`${payload}.${sig.slice(0, -2)}xx`), { ok: false });
  assert.deepEqual(await readWelcomeToken("nonsense"), { ok: false });
});
