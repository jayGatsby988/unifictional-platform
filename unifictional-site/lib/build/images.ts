// @ts-nocheck
// Image resolution for a multi-page spec. An image field is {query, alt}:
// `query` is either a URL (one of the company's real photos, chosen by the
// model from the dossier's photo list) or a short subject; subjects fall back
// to a curated Unsplash library per industry. Photos are handed out so the
// same stock image is not repeated across the site.
const U = (id) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&q=80&w=1600`;
export const IMAGES = {
  construction: ["1564013799919-ab600027ffc6", "1542621334-a254cf47733d", "1503387762-592deb58ef4e", "1521791136064-7986c2920216", "1600585154340-be6161a56a0c", "1600210492486-724fe5c67fb0", "1568605114967-8130f3a36994", "1593696140826-c58b021acf8b", "1486325212027-8081e485255e", "1504384308090-c894fdcc538d", "1513467535987-fd81bc7d62f8", "1517581177682-a085bb7ffb15", "1541888946425-d81bb19240f5", "1581094794329-c8112a89af12", "1590725121839-892b458a74fe"],
  interior: ["1497366216548-37526070297c", "1505691938895-1758d7feb511", "1493809842364-78817add7ffb", "1586023492125-27b2c045efd7", "1600607687939-ce8a6c25118c", "1600566753190-17f0baa2a6c3", "1502672260266-1c1ef2d93688", "1554995207-c18c203602cb", "1505693416388-ac5ce068fe85", "1556228720-195a672e8a03"],
  kitchen: ["1556911220-bff31c812dba", "1556912173-3bb406ef7e77", "1556909114-f6e7ad7d3136", "1600566753190-17f0baa2a6c3", "1600489000022-c2086d79f9d4", "1588854337115-1c67d9247e4d"],
  pools: ["1572331165267-854da2b10ccc", "1575429198097-0414ec08e8cd", "1505691938895-1758d7feb511", "1600607687939-ce8a6c25118c", "1576013551627-0cc20b96c2a7"],
  roofing: ["1632759145351-1d592919f522", "1605276374104-dee2a0ed3cd6", "1564013799919-ab600027ffc6", "1568605114967-8130f3a36994", "1600585154526-990dced4db0d"],
  landscaping: ["1558904541-efa843a96f01", "1592150621744-aca64f48394a", "1441974231531-c6227db76b6e", "1506905925346-21bda4d32df4", "1416879595882-3373a0480b5b", "1598902108854-10e335adac99"],
  restaurant: ["1517248135467-4c7edcad34c4", "1414235077428-338989a2e8c0", "1555396273-367ea4eb4db5", "1495474472287-4d71bcdd2085", "1509042239860-f550ce710b93"],
  fitness: ["1534438327276-14e5300c3a48", "1571019613454-1cb2f99b2d8b", "1522071820081-009f0129c71c"],
  tech: ["1497215728101-856f4ea42174", "1486312338219-ce68d2c6f44d", "1551434678-e076c223a692", "1460925895917-afdab827c52f", "1522071820081-009f0129c71c", "1556761175-5973dc0f32e7"],
  beauty: ["1560066984-138dadb4c035", "1522337660859-02fbefca4702", "1583847268964-b28dc8f51f92"],
  realestate: ["1570129477492-45c003edd2be", "1512917774080-9991f1c4c750", "1486406146926-c627a92ad1ab", "1600585154340-be6161a56a0c"],
  medical: ["1629909613654-28e377c37b09", "1588776814546-1ffcf47267a5", "1497366216548-37526070297c"],
  law: ["1589829545856-d10d557cf95f", "1521587760476-6c12a4b040da", "1497366216548-37526070297c"],
  product: ["1523275335684-37898b6baf30", "1505740420928-5e560c06d30e", "1583847268964-b28dc8f51f92"],
  photography: ["1452587925148-ce544e77e70d", "1516035069371-29a1b244cc32", "1565182999561-18d7dc61c393"],
  generic: ["1565182999561-18d7dc61c393", "1571055107559-3e67626fa8be", "1583847268964-b28dc8f51f92", "1497366216548-37526070297c"],
};

const isUrl = (q) => /^https?:\/\//i.test(q || "");

/**
 * Resolve every image field in `pages` (or a single page object). `pool`
 * is the dossier's real photo list [{url, alt}]; when the model wrote a
 * subject instead of a URL, a real photo whose alt matches the subject is
 * preferred, then stock. Returns a count of own photos used.
 */
export function resolveImages(target, imgCat, pool = []) {
  const ids = IMAGES[imgCat] || IMAGES.generic;
  let k = Math.floor(Math.random() * ids.length);
  // the company's real photos come first, always: best alt-text match, else the next unused real photo
  // (rotation across pages so every page shows different work); stock only when there are no real photos at all
  const real = pool.filter(p => p && p.url && p.use !== "logo" && p.use !== "skip");
  let rot = 0;
  let pageUsed = new Set();
  const siteUsed = new Map(); // url → number of pages it appears on (a real photo appears on one page only, when there are enough)
  const own = (q) => {
    if (!real.length) return null;
    const words = String(q).toLowerCase().split(/\W+/).filter(w => w.length > 3);
    let best = null, bs = 0;
    const fresh = (p) => !pageUsed.has(p.url) && !(siteUsed.get(p.url) > 0 && real.length > 12);
    for (const p of real) { if (!fresh(p)) continue; const alt = (p.alt || "").toLowerCase(); const s = words.reduce((a, w) => a + (alt.includes(w) ? 1 : 0), 0); if (s > bs) { bs = s; best = p; } }
    if (best) return best;
    for (let i = 0; i < real.length; i++) { const p = real[(rot + i) % real.length]; if (fresh(p)) { rot = (rot + i + 1) % real.length; return p; } }
    for (let i = 0; i < real.length; i++) { const p = real[(rot + i) % real.length]; if (!pageUsed.has(p.url)) { rot = (rot + i + 1) % real.length; return p; } }
    return null; // every real photo already appears on this page: stock fills the rest rather than a repeat
  };
  const take = (p, q, alt) => { pageUsed.add(p.url); siteUsed.set(p.url, (siteUsed.get(p.url) || 0) + 1); return { query: q, alt: alt || p.alt || q, url: p.url }; };
  const next = (q, alt) => {
    if (isUrl(q)) {
      // the writer named a photo: keep it unless it already carries another page and a fresh real photo with a fitting subject exists
      const onOther = (siteUsed.get(q) || 0) > 0 && !pageUsed.has(q);
      if (onOther && real.length > 12) { const o = own(alt || q); if (o && o.url !== q) return take(o, q, alt); }
      pageUsed.add(q); siteUsed.set(q, (siteUsed.get(q) || 0) + 1); return { query: q, alt: alt || "", url: q };
    }
    const o = own(q);
    if (o) return take(o, q, alt);
    return { query: q, alt: alt || q, url: U(ids[k++ % ids.length]) };
  };
  const pages = Array.isArray(target) ? target : [target];
  for (const page of pages) {
    pageUsed = new Set();
    for (const s of page.sections || []) {
      if (s.image && !s.image.url) s.image = next(s.image.query || s.image.alt || "work", s.image.alt);
      if (s.images) s.images = s.images.map(im => im.url ? im : next(im.query || im.alt, im.alt));
      if (Array.isArray(s.items)) s.items = s.items.map(it => (it.query || it.image) && !it.image?.url ? { ...it, image: next(it.query || it.title, it.alt || it.title) } : it);
      if (Array.isArray(s.slides)) s.slides = s.slides.map(it => it.image?.url ? it : { ...it, image: next(it.query || it.title, it.alt || it.title) });
    }
  }
  return target;
}

/** Give the menu's links preview images: a real photo per page when possible. */
export function navImages(spec, pool = [], imgCat) {
  const ids = IMAGES[imgCat] || IMAGES.generic;
  const pages = spec.pages || [];
  spec.nav.links = (spec.nav.links || []).map((l, i) => {
    if (l.image?.url) return l;
    const page = pages.find(p => p.slug === l.href);
    const firstImg = page?.sections?.map(s => s.image?.url || s.images?.[0]?.url || s.items?.find(it => it.image?.url)?.image?.url).find(Boolean);
    return { ...l, image: { url: firstImg || pool[i]?.url || U(ids[(i + 2) % ids.length]) } };
  });
  return spec;
}

// Count the company's own photos (anything not from the stock library).
export function countOwnPhotos(spec) {
  let n = 0;
  const bump = (u) => { if (u && !/unsplash/.test(u)) n++; };
  for (const p of spec.pages || []) for (const s of p.sections || []) {
    bump(s.image?.url); (s.images || []).forEach(i => bump(i.url)); (s.items || []).forEach(i => bump(i.image?.url)); (s.slides || []).forEach(i => bump(i.image?.url));
  }
  return n;
}

/** The first stock photo for a trade, full size: the hero-video source when the company has no photo of its own yet. */
export function stockHero(industry = "") {
  const key = Object.keys(IMAGES).find(k => k !== "generic" && new RegExp(k, "i").test(industry)) || "generic";
  const ids = IMAGES[key] || IMAGES.generic;
  return U(ids[0]).replace(/w=\d+/, "w=2400");
}
