// Turns downloaded TTS takes (raw-<n>.wav) into trimmed, loudness-matched MP3s at
// public/voice/<slug>/<step>.mp3 and writes lib/voice-manifest.json with durations.
// Usage: node scripts/voice-build.mjs <dir-with-raw-wavs-and-lines.json>
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const dir = process.argv[2];
const lines = JSON.parse(readFileSync(path.join(dir, "lines.json"), "utf8"));
const ffmpeg = process.env.FFMPEG ?? "ffmpeg";
const manifestPath = "lib/voice-manifest.json";
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};

const duration = (file) => {
  let out = "";
  try { execFileSync(ffmpeg, ["-hide_banner", "-i", file], { stdio: ["ignore", "ignore", "pipe"] }); }
  catch (e) { out = String(e.stderr ?? ""); }
  const m = out.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
};

let built = 0;
lines.forEach((l, n) => {
  const raw = path.join(dir, `raw-${n}.wav`);
  if (!existsSync(raw)) return;
  const outDir = path.join("public/voice", l.slug);
  mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${l.i}.mp3`);
  const chains = [
    "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.12,areverse,loudnorm=I=-16:TP=-1.5:LRA=11",
    "loudnorm=I=-16:TP=-1.5:LRA=11", // some ffmpeg builds abort on silenceremove for certain clips
  ];
  let ok = false;
  for (const af of chains) {
    try { execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-i", raw, "-af", af, "-ac", "1", "-ar", "44100", "-b:a", "64k", out], { stdio: "ignore" }); ok = true; break; }
    catch { /* try the next, simpler chain */ }
  }
  if (!ok) { console.error(`FAILED ${l.slug}/${l.i}`); return; }
  manifest[l.slug] ??= {};
  manifest[l.slug][l.i] = Math.round(duration(out) * 1000);
  built += 1;
});
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`built ${built} clips`);
