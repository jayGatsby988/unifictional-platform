/* Unifictional Studio · site.js  (landing page: nav, menu-8 overlay, prompt handoff, small demos) */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* nav state */
  const nav = $("#nav");
  const onScroll = () => nav.classList.toggle("is-scrolled", scrollY > 24);
  addEventListener("scroll", onScroll, { passive: true }); onScroll();

  /* reveal */
  const io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); } }), { threshold: 0.12 });
  $$(".reveal").forEach((el, i) => { el.style.transitionDelay = (i % 4) * 70 + "ms"; io.observe(el); });

  /* menu-8 overlay (CSS transitions; thumbnail follows the hovered row) */
  const menu = $("#js-menu"), toggle = $("#js-toggle"), closeBtn = $("#js-close");
  let open = false;
  function closeMenu() { if (!open) return; open = false; menu.classList.remove("is-open"); menu.setAttribute("aria-hidden", "true"); menu.setAttribute("inert", ""); toggle.setAttribute("aria-expanded", "false"); document.documentElement.style.overflow = ""; hideThumb(); }
  function openMenu() { open = true; menu.classList.add("is-open"); menu.setAttribute("aria-hidden", "false"); menu.removeAttribute("inert"); toggle.setAttribute("aria-expanded", "true"); document.documentElement.style.overflow = "hidden"; }
  const thumb = $("#js-thumb"), imgs = thumb ? $$("img", thumb) : [], counter = $("#js-counter"), rows = menu ? $$(".row", menu) : [];
  function hideThumb() { if (thumb) thumb.style.opacity = "0"; if (counter) counter.textContent = "Menu"; }
  rows.forEach(row => {
    row.addEventListener("mouseenter", () => {
      if (!thumb || matchMedia("(max-width: 768px)").matches) return;
      const r = menu.getBoundingClientRect();
      const x = r.width * row.dataset.thumbX / 1000 - thumb.offsetWidth / 2, y = r.height / 2 + row.dataset.offset / 2.5 - thumb.offsetHeight / 2;
      thumb.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      thumb.style.opacity = "1";
      imgs.forEach(im => im.classList.toggle("is-on", im.dataset.i === row.dataset.i));
      if (counter) counter.textContent = `0${+row.dataset.i + 1} / 0${rows.length}`;
    });
    row.addEventListener("mouseleave", hideThumb);
  });
  toggle && toggle.addEventListener("click", () => open ? closeMenu() : openMenu());
  closeBtn && closeBtn.addEventListener("click", closeMenu);
  document.addEventListener("keydown", e => e.key === "Escape" && closeMenu());
  $$('.menu a[href^="#"]').forEach(a => a.addEventListener("click", closeMenu));

  /* prompt -> studio */
  let mode = "url";
  $$(".prompt__modes button").forEach(b => b.addEventListener("click", () => {
    mode = b.dataset.mode; $$(".prompt__modes button").forEach(x => x.classList.toggle("is-on", x === b));
    $("#launchInput").placeholder = mode === "url" ? "Paste a URL like https://yourbusiness.com, or describe the business…" : "A roofing company called Summit Roofing in Everett, WA. Family owned, fast storm repair…";
  }));
  const go = (q) => {
    q = (q || "").trim(); if (!q) { location.href = "/studio"; return; }
    const isUrl = /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(q) && !/\s/.test(q);
    location.href = "/studio?" + (isUrl ? "url=" + encodeURIComponent(/^https?:/i.test(q) ? q : "https://" + q) : "prompt=" + encodeURIComponent(q));
  };
  $("#launchForm").addEventListener("submit", e => { e.preventDefault(); go($("#launchInput").value); });
  $("#launchInput").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(e.target.value); } });
  $("#ctaForm").addEventListener("submit", e => { e.preventDefault(); go(e.target.q.value); });
  $("#ctaForm textarea").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(e.target.value); } });

  /* research card: lines light up in order, looping */
  (function dossier() {
    const lines = $$(".dossier__lines li"); if (!lines.length) return;
    if (RM) { lines.forEach(l => l.classList.add("is-on")); return; }
    let i = 0;
    const tick = () => {
      if (i === 0) lines.forEach(l => l.classList.remove("is-on"));
      lines[i].classList.add("is-on");
      i += 1;
      if (i >= lines.length) { i = 0; setTimeout(tick, 2600); } else setTimeout(tick, 700);
    };
    tick();
  })();

  /* SEO ring climbs once it is on screen */
  (function seo() {
    const ring = $("#seoDemo"); if (!ring) return;
    const b = $("b", ring), from = +b.dataset.from, to = +b.dataset.to;
    ring.style.setProperty("--p", from);
    const obs = new IntersectionObserver(es => { if (!es[0].isIntersecting) return; obs.disconnect();
      const t0 = performance.now(), dur = RM ? 1 : 1800;
      const step = (t) => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3), v = from + (to - from) * e; b.textContent = Math.round(v); ring.style.setProperty("--p", v); if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }, { threshold: 0.5 });
    obs.observe(ring);
  })();
})();
