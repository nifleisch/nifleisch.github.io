// Projects page motion, themed on what Nils builds: every creature is "generated" as it scrolls in.
//  - the little creature denoises out of a patch of noise, step by step, like a diffusion sampler
//  - the section rules draw in; the text stays still
//  - reach the bottom of the page and the creatures do a little wave
// Everything here is presentation only: the page reads the same without it, and nothing runs with reduced motion.
(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  document.documentElement.classList.add('fx');

  const css = document.createElement('style');
  css.textContent = `
    .fx .item { position: relative; }
    .fx .item.pre .elmo { opacity: 0; }
    .fx .dn { position: absolute; pointer-events: none; image-rendering: pixelated; }
    .fx .elmo { transform-origin: 50% 100%; }
    .fx h2 { position: relative; border-top-color: transparent; }
    .fx h2::before { content: ""; position: absolute; left: 0; right: 0; top: -1px; height: 1px; background: var(--line);
      transform: scaleX(var(--rule, 1)); transform-origin: 0 50%; transition: transform 1s cubic-bezier(.2,.8,.2,1); }
    .fx h2.pre { --rule: 0; }
  `;
  document.head.appendChild(css);

  // ---------- the creature denoises out of noise ----------
  const loaded = img => img.complete && img.naturalWidth ? Promise.resolve() : new Promise(r => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); });
  async function denoise(item, img) {
    await loaded(img);
    const dpr = Math.min(2, devicePixelRatio || 1), cw = img.offsetWidth, ch = img.offsetHeight;
    const W = Math.round(cw * dpr / 2), H = Math.round(ch * dpr / 2);   // half resolution: chunky pixels read as "latent"
    const cv = document.createElement('canvas'); cv.className = 'dn'; cv.width = W; cv.height = H;
    Object.assign(cv.style, { left: img.offsetLeft + 'px', top: img.offsetTop + 'px', width: cw + 'px', height: ch + 'px' });
    item.appendChild(cv);
    const g = cv.getContext('2d', { willReadFrequently: true });
    // fit the image like object-fit: contain + object-position: bottom
    const s = Math.min(W / img.naturalWidth, H / img.naturalHeight), dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    let x0;
    try { g.drawImage(img, (W - dw) / 2, H - dh, dw, dh); x0 = g.getImageData(0, 0, W, H).data; }
    catch (e) { cv.remove(); item.classList.remove('pre'); return; }
    const out = g.createImageData(W, H), d = out.data, eps = new Float32Array(W * H * 3);
    for (let i = 0; i < eps.length; i++) eps[i] = Math.random() * 2 - 1;
    // a soft oval of noise roughly where the creature will be
    const cx = W / 2, cy = H * 0.52, rx = W * 0.48, ry = H * 0.46;
    const STEPS = 12, dur = 760, t0 = performance.now(); let lastStep = -1;
    const draw = k => {
      const t = 1 - k / STEPS, a = Math.cos(t * Math.PI / 2) ** 2;            // signal fraction (cosine schedule)
      const ns = Math.sqrt(1 - a), blk = t > .6 ? 3 : t > .3 ? 2 : 1;          // noise starts coarse, gets fine
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x), o = i * 4, j = ((((y / blk) | 0) * blk) * W + (((x / blk) | 0) * blk)) * 3;
        const e0 = eps[j], e1 = eps[j + 1], e2 = eps[j + 2];
        const q = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2, blob = clamp(1.25 - q, 0, 1);
        const al = x0[o + 3] / 255, sig = a * al, nz = ns * blob * 0.9;
        const tot = sig + nz * (1 - sig);
        if (tot < 0.004) { d[o + 3] = 0; continue; }
        const nr = 128 + 70 * e0 + 40 * e1, ng = 80 + 50 * e1, nb = 200 + 55 * e2;  // purple-ish gaussian soup
        const w = sig / tot;
        d[o] = x0[o] * w + nr * (1 - w); d[o + 1] = x0[o + 1] * w + ng * (1 - w); d[o + 2] = x0[o + 2] * w + nb * (1 - w); d[o + 3] = tot * 255;
      }
      g.putImageData(out, 0, 0);
      for (let i = 0; i < eps.length; i++) eps[i] = eps[i] * 0.55 + (Math.random() * 2 - 1) * 0.45;   // the noise keeps moving
    };
    draw(0);
    const tick = now => {
      const k = Math.min(STEPS, Math.floor((now - t0) / dur * STEPS));
      if (k !== lastStep) { lastStep = k; draw(k); }
      if (k < STEPS) requestAnimationFrame(tick);
      else { img.style.transition = 'opacity .25s'; item.classList.remove('pre'); setTimeout(() => cv.remove(), 260); }
    };
    requestAnimationFrame(tick);
  }

  // ---------- reveal on scroll ----------
  const items = $$('.item'), heads = $$('main h2');
  items.forEach(it => it.classList.add('pre'));
  $$('main h2').forEach(h => h.classList.add('pre'));
  const reveal = el => {
    if (el.matches('h2')) { el.classList.remove('pre'); return; }
    const img = el.querySelector('.elmo');
    if (img) denoise(el, img); else el.classList.remove('pre');
  };
  // stagger whatever comes into view together
  let queue = [], flushing = 0;
  const flush = () => { const el = queue.shift(); if (!el) { flushing = 0; return; } reveal(el); setTimeout(flush, 110); };
  const io = new IntersectionObserver(es => {
    es.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      .forEach(e => { io.unobserve(e.target); queue.push(e.target); });
    if (!flushing && queue.length) { flushing = 1; flush(); }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.15 });
  [...heads, ...items].forEach(el => io.observe(el));

  // ---------- the end: a little wave ----------
  const jump = el => el.animate([
    { transform: 'none' },
    { transform: 'scale(1.15, .84)', offset: .15 },
    { transform: 'translateY(-11px) scale(.9, 1.1)', offset: .45, easing: 'ease-in' },
    { transform: 'scale(1.1, .9)', offset: .75 },
    { transform: 'none' }], { duration: 560, easing: 'ease-out' });
  let waved = 0;
  addEventListener('scroll', () => {
    if (waved || innerHeight + scrollY < document.documentElement.scrollHeight - 4) return;
    waved = 1;
    $$('.elmo').filter(el => { const b = el.getBoundingClientRect(); return b.bottom > 0 && b.top < innerHeight; })
      .forEach((el, i) => setTimeout(() => jump(el), 380 + i * 90));
  }, { passive: true });
})();
