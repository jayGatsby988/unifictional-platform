// @ts-nocheck
// hero-video-scrub · the generated hero clip, played by the scroll.
// A tall section with a sticky full-screen canvas: as the page scrolls the
// clip's frames advance (coarse-to-fine loading, a window of decoded bitmaps
// around the current frame, the 4K frame swapped in when the scroll rests).
// Copy sits over it in beats: eyebrow + headline first, then two short beats,
// then the sub and the button. Without frames (no ffmpeg at build time) it
// scrubs the mp4's currentTime with the same smoothing. Phones and reduced
// motion get the poster with the copy.
// Reads spec.video (the manifest written by lib/build/video.ts).
import type { Component } from "./_types";

const c: Component = {
  id: "hero-video-scrub",
  type: "hero-video-scrub",
  kind: "hero",
  weight: "medium",
  describe: "hero-video-scrub: the home hero, in the pattern of the studio's best sites. At rest: an eyebrow with the city, the company's name in two giant lines (first word solid, the rest outlined), one sentence and two buttons over the first frame of a generated clip of their work. As the visitor scrolls the clip plays (a before → after transformation when their photos allow it) while the hook claim and one more beat appear in two-line display type, and the last frame carries the ask and the button. A frame counter and a progress bar read the scroll. Phones get the poster with the copy.",
  fields: `{"type":"hero-video-scrub","component":"hero-video-scrub","eyebrow":"KENT, WA — SERVING GREATER SEATTLE","headline":"the hook claim, 6-12 words, as two lines split with ' / ' (shown as the first beat while the clip plays)","sub":"ONE sentence (12-22 words) at rest under the name: the promise, true to what the clip shows","cta":{"label":"Free estimate","href":"contact"},"cta2":{"label":"See the work","href":"work"},"beats":[{"title":"second beat, two lines split with ' / ' (a proof or a guarantee)","text":""}],"ask":{"eyebrow":"Ready when you are","title":"2-5 words, one line of display type: 'Your garage is next.'","cta":{"label":"Get your free estimate","href":"contact"}},"image":{"query":"","alt":""}}`,
  images: { min: 1, max: 1 },
  css: ({ t, pair, capsRule }) => `
.hvs{position:relative;height:420svh;background:#0b0b0c;color:#fff}
.hvs__pin{position:sticky;top:0;height:100svh;overflow:hidden}
.hvs__media{position:absolute;inset:0;background:#0b0b0c}
.hvs__media canvas,.hvs__media video,.hvs__media img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.hvs__media canvas{opacity:0;transition:opacity .6s}
.hvs.is-live .hvs__media canvas{opacity:1}
.hvs.is-live .hvs__media img{opacity:0;transition:opacity .6s .2s}
.hvs__shade{position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.78) 0%,rgba(0,0,0,.22) 42%,rgba(0,0,0,.30) 100%);pointer-events:none}
.hvs__copy{position:absolute;left:var(--gutter);right:var(--gutter);bottom:clamp(2.2rem,7vh,4.5rem);z-index:2;display:grid;gap:1rem;text-shadow:0 2px 18px rgba(0,0,0,.45)}
.hvs__eyebrow{font-family:var(--mono);font-size:.7rem;letter-spacing:.24em;text-transform:uppercase;color:rgba(255,255,255,.92)}
.hvs__name{font-family:var(--display);font-weight:${Math.max(pair.weight, 600)};letter-spacing:-.02em;text-transform:uppercase;font-size:clamp(3rem,9.6vw,10.5rem);line-height:.9;color:#fff;margin:0}
.hvs__name .ln{display:block;overflow:hidden}.hvs__name .ln>span{display:block}
.hvs__name .ln.is-outline>span{color:transparent;-webkit-text-stroke:2px rgba(255,255,255,.92);text-shadow:none}
.hvs__row{display:flex;align-items:flex-end;justify-content:space-between;gap:2rem;flex-wrap:wrap;margin-top:.6rem}
.hvs__sub{font-size:clamp(1.05rem,1.35vw,1.3rem);line-height:1.5;color:rgba(255,255,255,.88);max-width:34rem;margin:0}
.hvs__btns{display:flex;gap:.8rem;flex-wrap:wrap}
.hvs .btn-primary{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}
.hvs .btn-ghost{color:#fff;border-color:rgba(255,255,255,.35);background:rgba(0,0,0,.25);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.hvs__beat{position:absolute;left:var(--gutter);right:var(--gutter);top:50%;transform:translateY(-50%);z-index:2;text-align:center;opacity:0;text-shadow:0 2px 20px rgba(0,0,0,.5)}
.hvs__beat h3{font-family:var(--display);font-weight:${Math.max(pair.weight, 600)};letter-spacing:-.02em;text-transform:uppercase;font-size:clamp(2.4rem,7.4vw,8rem);line-height:.92;color:#fff;margin:0 auto;max-width:18ch}
.hvs__beat h3 .ln{display:block;overflow:hidden}.hvs__beat h3 .ln>span{display:block}
.hvs__beat h3 .ln:nth-child(2)>span{color:transparent;-webkit-text-stroke:2px rgba(255,255,255,.9)}
.hvs__beat p{margin:1.2rem auto 0;font-size:clamp(1rem,1.3vw,1.25rem);color:rgba(255,255,255,.8);max-width:36rem}
.hvs__outro{position:absolute;left:var(--gutter);right:var(--gutter);top:50%;transform:translateY(-50%);z-index:2;text-align:center;display:grid;justify-items:center;gap:1.4rem;opacity:0;text-shadow:0 2px 20px rgba(0,0,0,.5)}
.hvs__outro .hvs__eyebrow{color:rgba(255,255,255,.75)}
.hvs__outro-h{font-family:var(--display);font-weight:${Math.max(pair.weight, 600)};letter-spacing:-.02em;text-transform:uppercase;font-size:clamp(2.4rem,7vw,7.6rem);line-height:.92;color:#fff;margin:0;max-width:12ch;text-wrap:balance}
.hvs__counter{position:absolute;left:var(--gutter);bottom:1.6rem;z-index:2;font-family:var(--mono);font-size:.64rem;letter-spacing:.22em;text-transform:uppercase;color:rgba(255,255,255,.72);opacity:0;transition:opacity .4s}
.hvs.is-live .hvs__counter{opacity:1}
.hvs__cue{position:absolute;right:var(--gutter);bottom:1.6rem;z-index:2;font-family:var(--mono);font-size:.62rem;letter-spacing:.22em;text-transform:uppercase;color:rgba(255,255,255,.6)}
.hvs__bar{position:absolute;left:0;right:0;bottom:0;z-index:2;height:3px;background:rgba(255,255,255,.14)}
.hvs__bar i{position:absolute;left:0;top:0;height:100%;width:100%;background:var(--accent);transform-origin:left;transform:scaleX(0)}
@media(max-width:767px),(prefers-reduced-motion:reduce){
  .hvs{height:auto;min-height:100svh}
  .hvs__pin{position:relative;height:auto;min-height:100svh;display:grid;align-content:end;padding:6.5rem var(--gutter) 2.5rem}
  .hvs__media canvas,.hvs__media video{display:none}
  .hvs__media img{opacity:1!important}
  .hvs__copy{position:relative;inset:auto;max-width:none;padding:0}
  .hvs__name{font-size:clamp(2.6rem,15vw,5rem)}
  .hvs__name .ln>span{transform:none!important}
  .hvs__row{flex-direction:column;align-items:flex-start}
  .hvs__beat,.hvs__outro,.hvs__cue,.hvs__bar,.hvs__counter{display:none}
}`,
  html: (s, { spec, esc, imgUrl, link, arrow }) => {
    const v = spec.video || null;
    const lines = (str, outlineSecond = false) => String(str || "").split(/\s*\/\s*|\n/).filter(Boolean).slice(0, 3).map((l, i) => `<span class="ln${outlineSecond && i === 1 ? " is-outline" : ""}"><span>${esc(l)}</span></span>`).join("");
    // the name in two lines: the first word solid, the rest outlined; a one-word name gets its trade as the second line
    const raw = String(spec.brand?.name || "").replace(/\b(LLC|L\.L\.C\.|Inc\.?|Corp\.?|Ltd\.?)\b\.?/gi, "").replace(/\s+/g, " ").trim();
    const words = raw.split(" ").filter(Boolean);
    const first = words[0] || raw, rest = words.slice(1).join(" ") || (spec.brand?.industry || "").split(/[,&]/)[0].trim();
    const name = `<span class="ln"><span>${esc(first)}</span></span>${rest ? `<span class="ln is-outline"><span>${esc(rest)}</span></span>` : ""}`;
    const beats = [{ title: s.headline || "", text: "" }, ...(s.beats || []).slice(0, 2)].filter(b => b && b.title);
    const ask = s.ask || {};
    const askTitle = ask.title || (s.cta?.label ? `${s.cta.label}.` : "");
    const askCta = ask.cta || s.cta;
    const poster = v?.poster || imgUrl(s.image, 2560);
    const media = v?.mode === "frames"
      ? `<canvas aria-hidden="true"></canvas><img src="${esc(poster)}" alt="${esc(s.image?.alt || "")}" fetchpriority="high">`
      : v?.mode === "video"
        ? `<video muted playsinline preload="auto" poster="${esc(poster)}" src="${esc(v.mp4)}"></video><img src="${esc(poster)}" alt="${esc(s.image?.alt || "")}" fetchpriority="high">`
        : `<img src="${esc(poster)}" alt="${esc(s.image?.alt || "")}" fetchpriority="high">`;
    const data = v ? ` data-mode="${esc(v.mode)}" data-base="${esc(v.base || "")}" data-count="${v.count || 0}" data-tiers="${esc((v.tiers || []).join(","))}" data-ext="${esc(v.ext || "webp")}" data-aspect="${v.aspect || 1.7778}" data-mp4="${esc(v.mp4 || "")}"` : ` data-mode="still"`;
    const counterLabel = s.counterLabel || (v?.kind === "transformation" || v?.kind === "film" ? "Transformation" : "The work");
    return `
<section class="hvs" id="top" data-fx="hero-video-scrub"${data}>
  <div class="hvs__pin">
    <div class="hvs__media">${media}<div class="hvs__shade"></div></div>
    <div class="hvs__copy" data-hvs-intro>
      ${s.eyebrow ? `<div class="hvs__eyebrow">${esc(s.eyebrow)}</div>` : ""}
      <h1 class="hvs__name">${name}</h1>
      <div class="hvs__row">
        ${s.sub ? `<p class="hvs__sub">${esc(s.sub)}</p>` : "<span></span>"}
        <div class="hvs__btns">${s.cta ? `<a class="btn btn-primary" href="${esc(link(s.cta.href))}">${esc(s.cta.label)}${arrow}</a>` : ""}${s.cta2?.label ? `<a class="btn btn-ghost" href="${esc(link(s.cta2.href || "work"))}">${esc(s.cta2.label)}</a>` : ""}</div>
      </div>
    </div>
    ${beats.map((b) => `<div class="hvs__beat" data-hvs-beat><h3>${lines(b.title, true)}</h3>${b.text ? `<p>${esc(b.text)}</p>` : ""}</div>`).join("")}
    <div class="hvs__outro" data-hvs-outro>
      ${ask.eyebrow ? `<div class="hvs__eyebrow">${esc(ask.eyebrow)}</div>` : ""}
      ${askTitle ? `<h2 class="hvs__outro-h">${esc(askTitle)}</h2>` : ""}
      ${askCta ? `<div><a class="btn btn-primary" href="${esc(link(askCta.href || "contact"))}">${esc(askCta.label)}${arrow}</a></div>` : ""}
    </div>
    <div class="hvs__counter" data-hvs-counter><span data-hvs-label>${esc(counterLabel)}</span> — <span data-hvs-n>000</span> / ${String(v?.count || 0).padStart(3, "0")}</div>
    <div class="hvs__bar" aria-hidden="true"><i data-hvs-bar></i></div>
    <div class="hvs__cue" aria-hidden="true">Scroll</div>
  </div>
</section>`;
  },
  js: () => `
(function(){
  var sec = document.querySelector('[data-fx="hero-video-scrub"]'); if (!sec) return;
  var FXS = window.__fx, mode = sec.getAttribute('data-mode');
  var intro = sec.querySelector('[data-hvs-intro]'), beats = sec.querySelectorAll('[data-hvs-beat]'), outro = sec.querySelector('[data-hvs-outro]'), bar = sec.querySelector('[data-hvs-bar]');
  if (!FXS.FX || mode === 'still') { if (outro) outro.style.opacity = 1; return; }
  var clamp = function(v, a, b){ return Math.max(a, Math.min(b, v)); };

  /* ---- frame player (coarse-to-fine, decoded window, sharpen at rest) ---- */
  var api = { set: function(){}, ready: Promise.resolve() };
  if (mode === 'frames' && window.createImageBitmap) {
    var canvas = sec.querySelector('canvas'), ctx = canvas.getContext('2d');
    var base = sec.getAttribute('data-base'), count = parseInt(sec.getAttribute('data-count'), 10) || 0, ext = sec.getAttribute('data-ext') || 'webp';
    var tiers = (sec.getAttribute('data-tiers') || '1920').split(','), ASPECT = parseFloat(sec.getAttribute('data-aspect')) || 16/9;
    var dpr = window.devicePixelRatio || 1, conn = navigator.connection || {};
    var pick = function(w){ var best = tiers[0]; tiers.forEach(function(t){ if (parseInt(t,10) <= w * 1.05 || parseInt(best,10) < w) best = t; }); return best; };
    /* scrub at most the 1920 tier (decoding 4K per frame stutters); the 4K tier is only swapped in when the scroll rests */
    var scrubTiers = tiers.filter(function(t){ return parseInt(t, 10) <= 1920; }); if (!scrubTiers.length) scrubTiers = [tiers[0]];
    var tier = conn.saveData ? scrubTiers[0] : (function(w){ var best = scrubTiers[0]; scrubTiers.forEach(function(t){ if (parseInt(t, 10) <= w * 1.05) best = t; }); return best; })(Math.min(window.innerWidth * Math.min(dpr, 2), 2600));
    var sharpTier = tiers[tiers.length - 1], sharpOK = parseInt(sharpTier,10) > parseInt(tier,10) && window.innerWidth * dpr >= 2300 && !conn.saveData;
    var frames = new Array(count), bitmaps = new Map(), pending = new Set();
    var target = 0, shown = -1, sharpShown = -1, sharpTimer = 0, live = false, box = null, cw = 0, ch = 0, WIN = 14, ANCHOR = 6, ready = false;
    var counterLabel = sec.querySelector('[data-hvs-label]'), labelText = counterLabel ? counterLabel.textContent : '';
    var url = function(i, t){ return base + '/' + t + '/' + ('000' + (i + 1)).slice(-4) + '.' + ext; };
    function want(i){ return Math.abs(i - target) <= WIN || i % ANCHOR === 0; }
    function nearest(){ if (bitmaps.has(target)) return target; var best = -1, bd = 1e9; bitmaps.forEach(function(_, k){ var d = Math.abs(k - target); if (d < bd) { bd = d; best = k; } }); return best; }
    function decode(i){ if (i < 0 || i >= count || !frames[i] || bitmaps.has(i) || pending.has(i)) return; pending.add(i); createImageBitmap(frames[i]).then(function(bm){ pending.delete(i); if (!want(i)) { bm.close && bm.close(); return; } bitmaps.set(i, bm); if (nearest() === i) draw(); }).catch(function(){ pending.delete(i); }); }
    function prune(){ bitmaps.forEach(function(bm, k){ if (!want(k)) { bm.close && bm.close(); bitmaps.delete(k); } }); }
    function resize(){ var r = canvas.getBoundingClientRect(); if (!r.width) return; var d = Math.min(dpr, sharpOK ? 3 : 2); cw = canvas.width = Math.round(r.width * d); ch = canvas.height = Math.round(r.height * d); var dw, dh; if (cw / ch > ASPECT) { dw = cw; dh = cw / ASPECT; } else { dh = ch; dw = ch * ASPECT; } box = { dx: (cw - dw) / 2, dy: (ch - dh) / 2, dw: dw, dh: dh }; shown = -1; sharpShown = -1; draw(); }
    function paint(bm){ if (!box) return; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(bm, box.dx, box.dy, box.dw, box.dh); }
    function draw(){ if (!ready) return; var k = nearest(); if (k < 0 || !box) return; if (k === shown || (k === target && sharpShown === target)) return; paint(bitmaps.get(k)); shown = k; if (!live) { live = true; sec.classList.add('is-live'); } }
    function sharpen(){ var i = target; fetch(url(i, sharpTier)).then(function(r){ if (!r.ok) throw 0; return r.blob(); }).then(function(b){ return createImageBitmap(b); }).then(function(bm){ if (i === target) { paint(bm); sharpShown = i; } bm.close && bm.close(); }).catch(function(){}); }
    api.set = function(i){ i = clamp(Math.round(i), 0, count - 1); if (i === target && live) return; target = i; sharpShown = -1; for (var d = 0; d <= WIN; d++) { decode(i + d); if (d) decode(i - d); } prune(); draw(); if (sharpOK) { clearTimeout(sharpTimer); sharpTimer = setTimeout(sharpen, 260); } };
    var order = [], seen = {}; [16, 8, 4, 2, 1].forEach(function(step){ for (var i = 0; i < count; i += step) if (!seen[i]) { seen[i] = 1; order.push(i); } });
    /* the film is not scrubbed until 60% of its frames are in: the counter reads LOADING — 42% until then, so it never jumps between anchor frames */
    var cursor = 0, active = 0, loaded = 0, firstPass = Math.ceil(count * 0.6), resolveReady; api.ready = new Promise(function(r){ resolveReady = r; });
    api.ready.then(function(){ ready = true; if (counterLabel) counterLabel.textContent = labelText; for (var d = 0; d <= WIN; d++) { decode(target + d); if (d) decode(target - d); } draw(); });
    function loadingTick(){ if (!ready && counterLabel) counterLabel.textContent = 'Loading the film ' + Math.round(loaded / count * 100) + '%'; }
    function pump(){ while (active < 8 && cursor < order.length) { (function(i){ active++; fetch(url(i, tier)).then(function(r){ if (!r.ok) throw 0; return r.blob(); }).then(function(b){ frames[i] = b; loaded++; if (want(i)) decode(i); if (loaded % 6 === 0) loadingTick(); if (loaded >= firstPass) resolveReady(); }).catch(function(){}).then(function(){ active--; pump(); }); })(order[cursor++]); } if (cursor >= order.length && active === 0) resolveReady(); }
    resize(); window.addEventListener('resize', resize); pump(); if (sharpOK) sharpTimer = setTimeout(sharpen, 1200);
  } else if (mode === 'video') {
    /* ---- mp4 scrub: currentTime follows the scroll with smoothing ---- */
    var vid = sec.querySelector('video'); if (vid) {
      /* one seek in flight at a time: the next one starts from where the decoder actually is, so a fast scroll never queues up stale seeks */
      var dur = 0, wantT = 0, ticking = false, busy = false;
      vid.addEventListener('loadedmetadata', function(){ dur = vid.duration || 0; sec.classList.add('is-live'); });
      vid.addEventListener('seeked', function(){ busy = false; });
      vid.load();
      function tick(){ var cur = vid.currentTime || 0, d = wantT - cur; if (Math.abs(d) < 0.02) { ticking = false; return; } if (!busy) { busy = true; try { vid.currentTime = cur + d * 0.5; } catch (e) { busy = false; } } requestAnimationFrame(tick); }
      api.set = function(p){ if (!dur) return; wantT = clamp(p, 0, 1) * (dur - 0.05); if (!ticking) { ticking = true; requestAnimationFrame(tick); } };
      api.isProgress = true;
    }
  }

  /* ---- scroll → frame, copy beats, counter ---- */
  var count2 = parseInt(sec.getAttribute('data-count'), 10) || 0;
  var counterN = sec.querySelector('[data-hvs-n]');
  var state = { p: 0 };
  gsap.to(state, { p: 1, ease: 'none', scrollTrigger: { trigger: sec, start: 'top top', end: 'bottom bottom', scrub: 0.9 }, onUpdate: function(){
    var p = clamp(state.p / 0.94, 0, 1);
    if (api.isProgress) api.set(p); else if (count2) api.set(p * (count2 - 1));
    if (bar) bar.style.transform = 'scaleX(' + state.p + ')';
    if (counterN && count2) counterN.textContent = ('000' + (Math.round(p * (count2 - 1)) + 1)).slice(-3);
  } });
  var tl = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: sec, start: 'top top', end: 'bottom bottom', scrub: 0.5 } });
  if (intro) tl.to(intro, { opacity: 0, y: -50, duration: 0.09 }, 0.05);
  tl.to(sec.querySelector('.hvs__cue'), { opacity: 0, duration: 0.04 }, 0.03);
  var n = beats.length, span = n ? (0.62 / n) : 0;
  beats.forEach(function(b, i){ var at = 0.17 + i * span, ln = b.querySelectorAll('.ln > span'), p = b.querySelector('p');
    tl.fromTo(b, { opacity: 0 }, { opacity: 1, duration: 0.01 }, at - 0.005).fromTo(ln, { yPercent: 115 }, { yPercent: 0, duration: 0.08, stagger: 0.03, ease: 'power3.out' }, at);
    if (p) tl.fromTo(p, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.05 }, at + 0.06);
    tl.to(b, { opacity: 0, y: -40, duration: 0.05 }, at + span - 0.06); });
  if (outro) tl.fromTo(outro, { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.08, ease: 'power2.out' }, 0.82).to({}, { duration: 0.1 });
  /* name lines rise on load */
  if (intro) gsap.from(intro.querySelectorAll('.hvs__name .ln > span'), { yPercent: 110, duration: 1.2, stagger: 0.1, ease: 'power4.out', delay: 0.2 });
})();`,
};
export default c;
