import { test } from "node:test";
import assert from "node:assert/strict";
import { tempPassword } from "../lib/temp-password.ts";

test("temporary passwords are readable and varied", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const p = tempPassword();
    assert.match(p, /^[A-Z][a-z]+-[A-Z][a-z]+-\d{4}$/);
    assert.ok(p.length >= 12, "long enough for Supabase's minimum");
    seen.add(p);
  }
  assert.ok(seen.size > 190, "no meaningful repeats");
});
