// @ts-nocheck
// The hero video: after research, a short cinematic clip is generated from
// the company's flagship photo with Higgsfield (Kling 3.0, 4K by default),
// then turned into a frame sequence the home hero scrubs with the scroll.
//
//   runVideo(job)       prompt (one small model call) → submit → poll → download
//                       → frames via ffmpeg (Trigger.dev has it; Vercel does not,
//                       there the hero scrubs the mp4 itself) → upload → manifest
//   waitForVideo(id)    finish polls builds/<id>/video/manifest.json
//
// Env: HF_API_KEY_ID + HF_API_KEY_SECRET (console.higgsfield.ai),
//      HIGGSFIELD_ENDPOINT (default kling-video/v3.0/4k/image-to-video),
//      HIGGSFIELD_DURATION (seconds, default 8), HIGGSFIELD_WAIT_MS (default 600000).
import { stockHero } from "./images";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { modelFor, structured, parseJson, describeError, addUsage } from "./claude";
import { SYSTEM_VIDEO } from "./prompts";
import { createHash } from "node:crypto";
import { fetchBinary } from "./analyze";
import { blobConfigured, buildPath, readJson, saveBinary, saveJson } from "./storage";

export const videoConfigured = () => Boolean(process.env.HF_API_KEY_ID && process.env.HF_API_KEY_SECRET);
const ENDPOINT = () => process.env.HIGGSFIELD_ENDPOINT || "kling-video/v3.0/4k/image-to-video";
const T2V_ENDPOINT = () => process.env.HIGGSFIELD_T2V_ENDPOINT || "kling-video/v3.0/4k/text-to-video";
const FILM_SECONDS = () => Math.min(15, Math.max(6, Number(process.env.HIGGSFIELD_FILM_SECONDS || 10)));
const DURATION = () => Math.min(15, Math.max(3, Number(process.env.HIGGSFIELD_DURATION || 10)));
const TEXTURE_DURATION = 5;
const WAIT_MS = () => Number(process.env.HIGGSFIELD_WAIT_MS || 600_000);
const FPS = 24;
const TIERS = [
  { name: "1280", width: 1280, quality: 72 },
  { name: "1920", width: 1920, quality: 76 },
  { name: "3840", width: 3840, quality: 68 },
];

const auth = () => `Key ${process.env.HF_API_KEY_ID}:${process.env.HF_API_KEY_SECRET}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export interface VideoManifest {
  status: "ready" | "failed" | "skipped";
  mode?: "frames" | "video";
  base?: string;          // https://…/builds/<id>/video  (frames live at base/<tier>/0001.webp)
  count?: number;
  tiers?: string[];
  ext?: string;
  fps?: number;
  aspect?: number;
  poster?: string;
  mp4?: string;
  sourceImage?: string;
  endImage?: string;       // transformation clips: the "after" photo the clip ends on
  kind?: "transformation" | "cinematic" | "film";
  candidates?: number;     // how many clips were generated before the best was chosen
  texture?: { mp4: string; poster: string; sourceImage: string }; // a short looping close-up clip for a material section
  prompt?: string;
  endpoint?: string;
  seconds?: number;
  error?: string;
}

/** A before/after pair among their photos (same stem with before/after, or a project that lists both). */
export function findBeforeAfter(job): { before: string; after: string } | null {
  const photos = (job.dossier?.photos || []).filter(p => p && /^https?:\/\//i.test(p.url));
  const key = (p) => `${p.url} ${p.alt || ""}`.toLowerCase();
  const stem = (u) => u.toLowerCase().replace(/\.(jpe?g|png|webp|avif)(\?.*)?$/, "").replace(/[-_ ]?(before|after|pre|post|old|new)[-_ ]?/g, "").replace(/^.*\//, "");
  const befores = photos.filter(p => /\b(before|pre-?job|old roof|old floor|existing)\b/i.test(key(p)) && !/after/i.test(key(p)));
  const afters = photos.filter(p => /\b(after|finished|completed|complete|done|new roof|new floor|result)\b/i.test(key(p)) && !/before/i.test(key(p)));
  for (const b of befores) { const m = afters.find(a => stem(a.url) === stem(b.url)); if (m) return { before: b.url, after: m.url }; }
  for (const pr of job.dossier?.projects || []) { const b = pr?.before || pr?.beforePhoto, a = pr?.after || pr?.afterPhoto; if (b && a && /^https?:/.test(b) && /^https?:/.test(a)) return { before: b, after: a }; }
  if (befores.length && afters.length) return { before: befores[0].url, after: afters[0].url };
  return null;
}

/** A close-up of the material or texture of the trade (shingle, epoxy flake, cedar grain) for the looping material clip. */
export function chooseTextureImage(job, avoid: string[] = []) {
  const photos = (job.dossier?.photos || []).filter(p => p && /^https?:\/\//i.test(p.url) && !avoid.includes(p.url));
  const m = photos.find(p => /\b(close-?up|closeup|detail|texture|grain|flake|chip|metallic|epoxy|shingle|cedar|stone|tile|finish|sample|swatch|surface|macro)\b/i.test(`${p.alt || ""} ${p.url}`));
  return m?.url || "";
}

/** The photo the clip starts from: the flagship's best photo, else the strongest dossier photo. */
export function chooseSourceImage(job) {
  // the clip animates the flagship, but from a finished-work photo: a frame-and-debris shot under a deck is honest proof lower on the page, not the first screen
  const photos = job.dossier?.photos || [];
  const altOf = (u) => (photos.find(p => p.url === u)?.alt || "").toLowerCase();
  const messy = /\b(under|underneath|joist|fram(e|ing)|before|demo|progress|during|bare|tools?|debris|rot|damage|inspection|crawl|sub-?floor|plywood|tarp)\b/i;
  const clean = /\b(finish|complet|new|after|install|built|custom|composite|cedar|view|evening|dusk|rail|pergola|patio|outdoor|home)\b/i;
  const rank = (u) => (clean.test(altOf(u)) ? 2 : 0) - (messy.test(altOf(u)) ? 3 : 0);
  const hookPhotos = (job.hook?.flagship?.photos || []).filter(u => /^https?:\/\//i.test(u));
  if (hookPhotos.length) { const sorted = [...hookPhotos].sort((a, b) => rank(b) - rank(a)); if (rank(sorted[0]) >= 0) return sorted[0]; }
  const byUse = (u) => photos.filter(p => p.use === u && /^https?:\/\//i.test(p.url)).sort((a, b) => rank(b.url) - rank(a.url))[0];
  const own = (byUse("hero") || byUse("project") || (hookPhotos.length ? { url: hookPhotos[0] } : null) || photos[0] || {}).url || "";
  if (own) return own;
  // no real photo yet: the start of the site is still a video, made from the best stock photo of the trade
  return stockHero(job.dossier?.designDirection?.imageCategory || job.dossier?.industry || "");
}

export async function writePrompt(job, imageUrl, opts: { kind?: string; endImage?: string; angle?: string } = {}) {
  const d = job.dossier || {};
  const modeNote = opts.kind === "transformation"
    ? `\nMODE: TRANSFORMATION. BEFORE photo (first frame): ${imageUrl}\nAFTER photo (last frame): ${opts.endImage}`
    : opts.kind === "texture" ? `\nMODE: TEXTURE LOOP. The close-up photo: ${imageUrl}`
    : `\nMODE: FILM. Camera angle for this version: ${opts.angle || "wide"}. Their work, from bare to finished, ${FILM_SECONDS()} seconds in 3 shots.`;
  const user0 = modeNote;
  const user = `COMPANY: ${d.name || job.lead.businessName} · ${d.industry || ""} · ${d.city || ""}\nHOOK: ${job.hook?.hook?.claim || "-"}\nFLAGSHIP: ${job.hook?.flagship?.title || "-"}: ${job.hook?.flagship?.story || "-"}\nSTART FRAME (the clip animates this photo): ${imageUrl}\nWHAT THE PHOTO SHOWS: ${(d.photos || []).find(p => p.url === imageUrl)?.alt || "their work"}\nMOOD: ${job.hook?.hook?.why || d.designDirection?.mood || ""}\nDURATION: ${DURATION()} seconds`;
  const { text, usage } = await structured({ system: SYSTEM_VIDEO(), user: user + user0, schema: null, effort: "low", maxTokens: 4000, model: modelFor("plan") });
  job.usage = addUsage(job.usage, usage);
  const out = parseJson(text) || {};
  const prompt = String(out.prompt || "").slice(0, 2400) || `A fixed-camera time-lapse of the trade's work from the bare space to the finished result, photoreal, steady, no text, ${FILM_SECONDS()} seconds.`;
  const shots = Array.isArray(out.shots) ? out.shots.filter(sh => sh && sh.prompt).slice(0, 6).map(sh => ({ prompt: String(sh.prompt).slice(0, 500), duration: Math.min(15, Math.max(1, Math.round(Number(sh.duration) || 4))) })) : [];
  return { prompt, shots };
}

/** A copy of the photo on our own storage: Higgsfield fetches the image from its servers, which client hosts may block. Falls back to the original URL. */
async function rehost(imageUrl) {
  if (!imageUrl || /blob\.vercel-storage\.com|unsplash\.com|pexels\.com/i.test(imageUrl)) return imageUrl;
  try {
    const got = await fetchBinary(imageUrl, { timeout: 20_000 });
    if (!got || !/^image\//i.test(got.type)) return imageUrl;
    const ext = /png/i.test(got.type) ? "png" : /webp/i.test(got.type) ? "webp" : "jpg";
    const hash = createHash("sha1").update(imageUrl).digest("hex").slice(0, 16);
    const url = await saveBinary(`studio/rehost/${hash}.${ext}`, got.buf, got.type);
    return url || imageUrl;
  } catch { return imageUrl; }
}
async function submit(imageUrl, prompt, { endImage = "", duration = DURATION(), shots = [], t2v = false } = {}) {
  if (!t2v) { imageUrl = await rehost(imageUrl); if (endImage) endImage = await rehost(endImage); }
  const body: any = { prompt, duration, sound: "off", cfg_scale: 0.5 };
  if (!t2v) body.image_url = imageUrl;
  if (!t2v && endImage) body.last_image_url = endImage; // Kling 3.0: the clip ends exactly on this frame (before → after)
  if (t2v) body.aspect_ratio = "16:9";
  if (shots.length >= 2) { body.multi_shots = true; body.multi_prompt = shots; } // one fixed take in staged shots: bare → work → finished
  const r = await fetch(`https://api.higgsfield.ai/${t2v ? T2V_ENDPOINT() : ENDPOINT()}`, {
    method: "POST",
    headers: { authorization: auth(), "content-type": "application/json", "idempotency-key": `${Date.now()}-${Math.random().toString(36).slice(2)}` },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Higgsfield ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  if (!j.status_url) throw new Error(`Higgsfield answered without a status_url: ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

async function pollUntilDone(statusUrl, budgetMs, onTick) {
  const t0 = Date.now();
  while (Date.now() - t0 < budgetMs) {
    const r = await fetch(statusUrl, { headers: { authorization: auth() } });
    const j = await r.json().catch(() => ({}));
    if (j.status === "completed") return j;
    if (j.status === "failed" || j.status === "cancelled" || j.status === "error") throw new Error(`Higgsfield generation ${j.status}: ${JSON.stringify(j).slice(0, 300)}`);
    onTick && onTick(j.status, Math.round((Date.now() - t0) / 1000));
    await sleep(10_000);
  }
  throw new Error(`Higgsfield did not finish within ${Math.round(budgetMs / 60000)} minutes`);
}

async function ffmpegPath() {
  const cands = [process.env.FFMPEG_PATH, "ffmpeg"].filter(Boolean);
  for (const c of cands) {
    const ok = await new Promise(res => { try { const p = spawn(c, ["-version"]); p.on("error", () => res(false)); p.on("exit", code => res(code === 0)); } catch { res(false); } });
    if (ok) return c;
  }
  return null;
}
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = ""; p.stderr.on("data", d => { err += d; if (err.length > 20000) err = err.slice(-20000); });
    p.on("error", reject);
    p.on("exit", code => code === 0 ? resolve(true) : reject(new Error(`${cmd} exited ${code}: ${err.slice(-600)}`)));
  });
}

async function mapLimit(items, limit, fn) {
  let i = 0; const out = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

/** Extract frame tiers with ffmpeg and upload them. Returns the manifest part. */
async function extractAndUpload(mp4, id, stamp, folder = "video") {
  const ff = await ffmpegPath();
  if (!ff) return null;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hero-"));
  const src = path.join(dir, "source.mp4");
  await fs.writeFile(src, mp4);
  const base = buildPath(id, folder);
  let count = 0, aspect = 16 / 9;
  // probe size through the 1920 pass output names; aspect from the first frame via sharp
  for (const t of TIERS) {
    const out = path.join(dir, t.name); await fs.mkdir(out, { recursive: true });
    await run(ff, ["-y", "-loglevel", "error", "-threads", "2", "-i", src, "-vf", `fps=${FPS},scale=${t.width}:-2:flags=lanczos`, "-c:v", "libwebp", "-quality", String(t.quality), "-compression_level", "4", "-frames:v", "240", path.join(out, "%04d.webp")]);
    const files = (await fs.readdir(out)).filter(f => f.endsWith(".webp")).sort();
    if (!count) count = files.length;
    stamp && stamp(`frames ${t.name}: ${files.length} files`);
    await mapLimit(files, 4, async (f) => { const buf = await fs.readFile(path.join(out, f)); await saveBinary(`${base}/${t.name}/${f}`, buf, "image/webp"); });
  }
  try { const sharp = (await import("sharp")).default; const m = await sharp(await fs.readFile(path.join(dir, "1920", "0001.webp"))).metadata(); if (m.width && m.height) aspect = m.width / m.height; } catch {}
  // poster: first frame of the biggest tier re-encoded at quality 82
  let poster = null;
  try { const sharp = (await import("sharp")).default; const buf = await sharp(await fs.readFile(path.join(dir, "3840", "0001.webp"))).resize({ width: 2560, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer(); poster = await saveBinary(`${base}/poster.webp`, buf, "image/webp"); } catch {}
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  return { count, aspect, poster, tiers: TIERS.map(t => t.name) };
}

/**
 * Generate the hero clip for a build and store everything under builds/<id>/video/.
 * Never throws: the manifest records failure and the hero falls back to the photo.
 */
/** Up to four frames of the finished clip (1280 tier) as base64 JPEGs, for the judge. */
export async function clipFrames(manifest, count = 4): Promise<{ label: string; data: string }[]> {
  if (!manifest || manifest.status !== "ready") return [];
  const out = [];
  try {
    if (manifest.mode === "frames" && manifest.base && manifest.count) {
      const tier = (manifest.tiers || ["1280"])[0];
      const idx = Array.from({ length: count }, (_, i) => Math.max(1, Math.round(1 + i * (manifest.count - 1) / (count - 1))));
      for (const n of idx) {
        const r = await fetch(`${manifest.base}/${tier}/${String(n).padStart(4, "0")}.${manifest.ext || "webp"}`, { signal: AbortSignal.timeout(10_000) });
        if (!r.ok) continue;
        const sharp = (await import("sharp")).default;
        const jpg = await sharp(Buffer.from(await r.arrayBuffer())).jpeg({ quality: 70 }).toBuffer();
        out.push({ label: `hero video, frame ${n} of ${manifest.count}`, data: jpg.toString("base64") });
      }
    } else if (manifest.poster) {
      const r = await fetch(manifest.poster, { signal: AbortSignal.timeout(10_000) });
      if (r.ok) { const sharp = (await import("sharp")).default; const jpg = await sharp(Buffer.from(await r.arrayBuffer())).resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer(); out.push({ label: "hero video poster", data: jpg.toString("base64") }); }
    }
  } catch {}
  return out;
}

/** The next-best source photo after `avoid` (for a second attempt at the clip). */
export function alternateSourceImage(job, avoid: string[] = []) {
  const photos = (job.dossier?.photos || []).filter(p => /^https?:\/\//i.test(p.url) && !avoid.includes(p.url));
  const prev = chooseSourceImage({ ...job, dossier: { ...(job.dossier || {}), photos }, hook: { ...(job.hook || {}), flagship: { ...(job.hook?.flagship || {}), photos: (job.hook?.flagship?.photos || []).filter(u => !avoid.includes(u)) } } });
  return prev && !avoid.includes(prev) ? prev : "";
}

/** One clip: prompt → submit → poll → download. Returns the mp4 buffer and what made it. */
async function generateClip(job, { imageUrl = "", endImage = "", kind = "film", duration = DURATION(), label = "clip", angle = "wide" }, stamp) {
  const { prompt, shots } = await writePrompt(job, imageUrl, { kind, endImage, angle });
  const t2v = kind === "film";
  // staged shots cut between themselves; the hero wants one fluid take, so shots are only used when asked for
  const useShots = process.env.HIGGSFIELD_SHOTS === "1" && (kind === "film" || kind === "transformation") && shots.length >= 2 ? shots : [];
  const total = useShots.length ? useShots.reduce((a, sh) => a + sh.duration, 0) : (kind === "film" ? FILM_SECONDS() : duration);
  stamp(`${label} (${kind}${useShots.length ? ", " + useShots.length + " shots, " + total + " s" : ""}): ${prompt.slice(0, 110)}…`);
  const sub = await submit(imageUrl, prompt, { endImage, duration: total, shots: useShots, t2v });
  stamp(`${label}: Higgsfield ${t2v ? T2V_ENDPOINT() : ENDPOINT()} queued (${sub.request_id}), ${total} s${endImage ? ", ends on the after photo" : ""}`);
  const done = await pollUntilDone(sub.status_url, WAIT_MS(), (st, s) => { if (s % 120 === 0) stamp(`${label}: Higgsfield ${st} after ${s} s`); });
  const url = done.video?.url;
  if (!url) throw new Error(`${label}: completed without a video url`);
  const r = await fetch(url); if (!r.ok) throw new Error(`${label}: video download ${r.status}`);
  const mp4 = Buffer.from(await r.arrayBuffer());
  return { mp4, prompt, imageUrl, endImage, kind };
}

/** Three sample frames of an mp4 (ffmpeg), as base64 JPEG, for choosing between clips. */
async function sampleFrames(mp4: Buffer, n = 3) {
  const ff = await ffmpegPath(); if (!ff) return [];
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pick-"));
  const src = path.join(dir, "c.mp4"); await fs.writeFile(src, mp4);
  await run(ff, ["-y", "-loglevel", "error", "-threads", "2", "-i", src, "-vf", `fps=${n}/${DURATION()},scale=960:-2`, "-frames:v", String(n), "-q:v", "4", path.join(dir, "%02d.jpg")]).catch(() => {});
  const files = (await fs.readdir(dir)).filter(f => f.endsWith(".jpg")).sort();
  const out = []; for (const f of files) out.push((await fs.readFile(path.join(dir, f))).toString("base64"));
  return out;
}

/** The judge picks the better clip from sample frames (vision). Returns the index. */
async function pickClip(job, clips, stamp) {
  if (clips.length < 2) return 0;
  try {
    const content = [{ type: "text", text: `${clips.length} generated hero clips for ${job.dossier?.name || job.lead?.businessName} (${job.dossier?.industry || ""}). Pick the one that best shows their trade's work happening from bare to finished and looks most expensive and real on the first screen of their website: steady camera, no warping or melting, no impossible objects, the work believable, a last frame you would put the ask over. Return ONLY JSON: {"pick": <index>, "why": "one sentence"}.` }];
    for (let i = 0; i < clips.length; i++) { const frames = await sampleFrames(clips[i].mp4, 3); content.push({ type: "text", text: `CLIP ${i} (${clips[i].kind}${clips[i].endImage ? ", before → after" : ""}), ${frames.length} frames in order (start, middle, end). The right clip shows the work from bare to finished, believable crews and tools, the surface actually changing, the last frame finished and clean:` }); for (const f of frames) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: f } }); }
    const { text, usage } = await structured({ system: "You choose between two short generated clips for a premium website hero. Be decisive; answer in JSON only.", user: content, schema: null, effort: "low", maxTokens: 400, model: modelFor("review") });
    job.usage = addUsage(job.usage, usage);
    const out = parseJson(text) || {};
    const i = Math.min(clips.length - 1, Math.max(0, Number(out.pick) || 0));
    stamp(`clip ${i} chosen: ${out.why || ""}`);
    return i;
  } catch (e) { stamp(`clip choice failed (${describeError(e)}); keeping the first`); return 0; }
}

/**
 * The hero clip, all out: up to two candidate clips are generated in parallel
 * (a before → after transformation when their photos allow it, and a cinematic
 * move on the best finished photo), the better one is chosen by looking at
 * frames, and a short looping close-up of the material is made for a texture
 * section when such a photo exists. Everything is stored under builds/<id>/video/.
 */
export async function runVideo(job, stamp = (s) => console.log(`[video ${job.id.slice(0, 8)}] ${s}`), { sourceImage = "", attempt = 1, manifestName = "manifest.json", folder = "video" } = {}) {
  const manifestPath = buildPath(job.id, `${folder}/${manifestName}`);
  const write = async (m: VideoManifest) => { try { await saveJson(manifestPath, m); } catch (e) { console.error("[video] manifest write failed", e); } return m; };
  if (!videoConfigured() || !blobConfigured()) return write({ status: "skipped", error: videoConfigured() ? "Blob storage is not configured" : "Higgsfield keys are not configured" });
  const t0 = Date.now();
  try {
    const primary = sourceImage || chooseSourceImage(job) || "";
    if (attempt > 1) stamp(`hero video attempt ${attempt} from ${primary.split("/").pop()}`);
    await write({ status: "pending" as any, sourceImage: primary });
    // candidates: the transformation (when a before/after pair exists) and the cinematic move; a second cinematic from the next-best photo when there is no pair
    // the film of their work (bare → working → finished), two camera angles; plus the real before → after when their photos allow it
    const pair = sourceImage ? null : findBeforeAfter(job);
    const plans = [];
    if (pair) plans.push({ imageUrl: pair.before, endImage: pair.after, kind: "transformation", label: "transformation clip" });
    plans.push({ kind: "film", angle: "wide", label: "film A (wide)" });
    plans.push({ kind: "film", angle: "low", label: "film B (low angle)" });
    const texImg = chooseTextureImage(job, plans.map(p => p.imageUrl).filter(Boolean));
    const texP = texImg ? generateClip(job, { imageUrl: texImg, kind: "texture", duration: TEXTURE_DURATION, label: "texture loop" }, stamp).catch(e => { stamp(`texture loop failed: ${describeError(e)}`); return null; }) : Promise.resolve(null);
    const results = await Promise.allSettled(plans.map(p => generateClip(job, p, stamp)));
    let clips = results.map((r, i) => r.status === "fulfilled" ? r.value : (stamp(`${plans[i].label} failed: ${describeError(r.reason)}`), null)).filter(Boolean);
    if (!clips.length) {
      // every film failed: the last resort is a slow move on their best photo, so the site still opens on motion
      stamp("no film came back; falling back to a camera move on their best photo");
      clips = [await generateClip(job, { imageUrl: primary, kind: "cinematic", label: "fallback clip" }, stamp)];
    }
    const pick = await pickClip(job, clips, stamp);
    const best = clips[pick];
    const mp4Url = await saveBinary(buildPath(job.id, `${folder}/source.mp4`), best.mp4, "video/mp4");
    for (let i = 0; i < clips.length; i++) if (i !== pick) await saveBinary(buildPath(job.id, `${folder}/candidate-${i}.mp4`), clips[i].mp4, "video/mp4").catch(() => {});
    stamp(`hero clip chosen (${best.kind}${best.endImage ? ", before → after" : ""}): ${(best.mp4.length / 1048576).toFixed(1)} MB, ${clips.length} candidate${clips.length > 1 ? "s" : ""}, ${Math.round((Date.now() - t0) / 1000)} s`);
    let texture;
    const tex = await texP;
    if (tex) { const tUrl = await saveBinary(buildPath(job.id, `${folder}/texture.mp4`), tex.mp4, "video/mp4"); texture = { mp4: tUrl || "", poster: tex.imageUrl, sourceImage: tex.imageUrl }; stamp(`texture loop ready: ${(tex.mp4.length / 1048576).toFixed(1)} MB`); }
    const imageUrl = best.imageUrl, prompt = best.prompt;
    const mp4 = best.mp4;
    const frames = await extractAndUpload(mp4, job.id, stamp, folder);
    const base = (mp4Url || "").replace(/\/source\.mp4$/, "");
    const common = { sourceImage: imageUrl || primary, endImage: best.endImage || undefined, kind: best.kind, candidates: clips.length, texture, prompt, endpoint: best.kind === "film" ? T2V_ENDPOINT() : ENDPOINT(), seconds: Math.round((Date.now() - t0) / 1000) };
    if (frames && frames.count > 10) {
      return write({ status: "ready", mode: "frames", base, count: frames.count, tiers: frames.tiers, ext: "webp", fps: FPS, aspect: frames.aspect, poster: frames.poster || best.endImage || primary, mp4: mp4Url, ...common });
    }
    stamp("no ffmpeg here: the hero will scrub the mp4 directly");
    return write({ status: "ready", mode: "video", mp4: mp4Url, poster: best.endImage || primary, aspect: 16 / 9, ...common });
  } catch (e) {
    stamp(`video failed: ${describeError(e)}`);
    // one more try: a transient Higgsfield or download failure should not cost the build its first screen
    if (attempt < 2 && !/no usable photo/.test(String(e?.message || ""))) { await sleep(20_000); return runVideo(job, stamp, { sourceImage, attempt: attempt + 1, manifestName, folder }); }
    return write({ status: "failed", error: describeError(e), seconds: Math.round((Date.now() - t0) / 1000) });
  }
}

/** The manifest as it is right now (null when none). */
export async function readVideoManifest(id) { return readJson<VideoManifest>(buildPath(id, "video/manifest.json")); }

/** Wait for the video manifest (pending → ready/failed/skipped). Resolves null when nothing arrives in time. */
export async function waitForVideo(id, maxMs = 420_000): Promise<VideoManifest | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const m = await readJson<VideoManifest>(buildPath(id, "video/manifest.json"));
    if (m && m.status !== ("pending" as any)) return m;
    await sleep(15_000);
  }
  return null;
}
