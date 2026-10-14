// GET /api/health -> { mode: "claude" | "local", model }
import { json, hasKey, MODEL } from "./_lib/http.js";
export default async function handler(req, res) {
  return json(res, 200, { ok: true, mode: hasKey() ? "claude" : "local", model: hasKey() ? MODEL : null });
}
