// Projects page motion, themed on what Nils builds: every entry is "generated" as it scrolls in.
//  - the little creature denoises out of a patch of noise, step by step, like a diffusion sampler
//  - headers and titles decode from random glyphs; the text below un-blurs
//  - numbers (78M, 600K, 2.4×) count up when they appear
//  - the creatures lean toward the cursor, sway on springs when you scroll, and breathe
//  - click a creature: it jumps and sheds a few pixels; click it three times quickly and it re-rolls its style
//  - reach the bottom of the page and they all do a little wave
// Everything here is presentation only: the page reads the same without it, and nothing runs with reduced motion.
(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const R = (a, b) => a + Math.random() * (b - a), clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  document.documentElement.classList.add('fx');

  const css = document.createElement('style');
  css.textContent = `
    .fx .item { position: relative; }
    .fx .item.pre .elmo { opacity: 0; }
    .fx .item .t, .fx .item p, .fx .item .meta { transition: opacity .7s ease, filter .7s ease, transform .7s cubic-bezier(.2,.8,.2,1); }
    .fx .item.pre p, .fx .item.pre .meta { opacity: 0; filter: blur(4px); transform: translateY(6px); }
    .fx .item.pre .t { opacity: 0; }
    .fx .item p { transition-delay: .18s; } .fx .item .meta { transition-delay: .3s; }
    .fx .dn { position: absolute; pointer-events: none; image-rendering: pixelated; }
    .fx .elmo { transform-origin: 50% 100%; cursor: pointer; animation: fx-breathe 3.2s ease-in-out infinite; -webkit-user-drag: none; user-select: none; }
    @keyframes fx-breathe { 0%, 100% { scale: 1 1; } 50% { scale: 1.02 .975; } }
    .fx h2 { position: relative; border-top-color: transparent; }
    .fx h2::before { content: ""; position: absolute; left: 0; right: 0; top: -1px; height: 1px; background: var(--line);
      transform: scaleX(var(--rule, 1)); transform-origin: 0 50%; transition: transform 1s cubic-bezier(.2,.8,.2,1); }
    .fx h2.pre { --rule: 0; }
    .fx .cnt { font-variant-numeric: tabular-nums; display: inline-block; text-align: right; }
    .fx-px { position: fixed; left: 0; top: 0; width: 5px; height: 5px; pointer-events: none; z-index: 5; }
  `;
  document.head.appendChild(css);

  // ---------- text decoding (Space Mono-ish glyph soup) ----------
  const GLYPHS = '!<>-_\\/[]{}=+*^?#%&01';
  const plain = el => el.childElementCount === 0;
  function decode(el, dur = 650, spread = 0.6) {
    if (!plain(el) || el._dec) return;
    const final = el._final || (el._final = el.textContent), n = final.length, t0 = performance.now();
    const at = [...final].map((c, i) => (i / n) * spread + Math.random() * (1 - spread));   // left-to-right-ish
    el._dec = 1;
    const tick = now => {
      const p = (now - t0) / dur; let s = '';
      for (let i = 0; i < n; i++) { const c = final[i]; s += c === ' ' || p >= at[i] ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0]; }
      el.textContent = s;
      if (p < 1) requestAnimationFrame(tick); else { el.textContent = final; el._dec = 0; }
    };
    requestAnimationFrame(tick);
  }

  // ---------- numbers count up ----------
  const NUM = /(\d+(?:\.\d+)?)(\s?)([MK]\b|×)/g;
  function wrapNumbers(root) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [];
    while (w.nextNode()) if (/\d\s?([MK]\b|×)/.test(w.currentNode.data)) nodes.push(w.currentNode);
    for (const tn of nodes) {
      const frag = document.createDocumentFragment(); let last = 0; const s = tn.data; NUM.lastIndex = 0;
      for (let m; (m = NUM.exec(s));) {
        frag.append(s.slice(last, m.index));
        const sp = document.createElement('span'); sp.className = 'cnt'; sp.dataset.to = m[1]; sp.textContent = m[1];
        frag.append(sp, m[2] + m[3]); last = m.index + m[0].length;
      }
      frag.append(s.slice(last)); tn.replaceWith(frag);
    }
  }
  function count(sp) {
    const to = parseFloat(sp.dataset.to), dec = (sp.dataset.to.split('.')[1] || '').length;
    sp.style.minWidth = sp.getBoundingClientRect().width + 'px';
    const t0 = performance.now(), dur = 1100;
    const tick = now => { const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      sp.textContent = (to * e).toFixed(dec); if (p < 1) requestAnimationFrame(tick); else sp.textContent = sp.dataset.to; };
    requestAnimationFrame(tick);
  }

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
  const items = $$('.item'), heads = $$('main h1, main h2, main h3');
  items.forEach(it => { it.classList.add('pre'); wrapNumbers(it); });
  $$('main h2').forEach(h => h.classList.add('pre'));
  const reveal = el => {
    if (el.matches('h2')) { el.classList.remove('pre'); decode(el, 700); return; }
    if (el.matches('h1, h3')) { decode(el, 600); return; }
    const img = el.querySelector('.elmo'), t = el.querySelector('.t');
    if (t) { t.style.opacity = 1; decode(t, 700, 0.75); }
    if (img) denoise(el, img); else el.classList.remove('pre');
    setTimeout(() => { $$('.cnt', el).forEach(count); }, 350);
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

  // links scramble briefly on hover
  $$('.meta a, a.back').forEach(a => { if (plain(a)) a.addEventListener('pointerenter', () => decode(a, 260, 0.3)); });

  // ---------- creatures on springs: lean toward the cursor, lag behind the scroll ----------
  const elmos = $$('.elmo').map(el => ({ el, it: el.parentElement, r: 0, vr: 0, x: 0, vx: 0, y: 0, vy: 0 }));
  let mx = -1e4, my = -1e4, lastY = scrollY, vel = 0, running = 0;
  const kick = () => { if (!running) { running = 1; requestAnimationFrame(step); } };
  addEventListener('pointermove', e => { if (e.pointerType === 'mouse') { mx = e.clientX; my = e.clientY; kick(); } }, { passive: true });
  document.addEventListener('pointerleave', () => { mx = my = -1e4; kick(); });
  addEventListener('scroll', () => { vel += scrollY - lastY; lastY = scrollY; kick(); }, { passive: true });
  function step() {
    vel *= 0.8; let moving = Math.abs(vel) > 0.2;
    const sway = clamp(vel * 0.35, -10, 10);
    for (const c of elmos) {
      const b = c.it.getBoundingClientRect();     // measure the row, so the lean doesn't feed back into itself
      if (b.bottom < -50 || b.top > innerHeight + 50) continue;
      const dx = mx - (b.left + c.el.offsetLeft + c.el.offsetWidth / 2), dy = my - (b.top + c.el.offsetTop + c.el.offsetHeight / 2), d = Math.hypot(dx, dy);
      const near = mx < -1e3 ? 0 : clamp(1 - d / 420, 0, 1);
      const tr = near * clamp(dx / 140, -1, 1) * 10 - sway * 0.6;       // degrees
      const tx = near * clamp(dx / 60, -1, 1) * 3, ty = near * clamp(dy / 60, -1, 1) * 2 + sway;
      // damped springs
      c.vr = (c.vr + (tr - c.r) * 0.12) * 0.78; c.r += c.vr;
      c.vx = (c.vx + (tx - c.x) * 0.12) * 0.78; c.x += c.vx;
      c.vy = (c.vy + (ty - c.y) * 0.14) * 0.74; c.y += c.vy;
      c.el.style.rotate = c.r.toFixed(2) + 'deg';
      c.el.style.translate = `${c.x.toFixed(2)}px ${c.y.toFixed(2)}px`;
      if (Math.abs(tr - c.r) + Math.abs(c.vr) + Math.abs(ty - c.y) + Math.abs(c.vy) > 0.05) moving = true;
    }
    if (moving) requestAnimationFrame(step); else running = 0;
  }

  // ---------- click: jump + pixel burst; three quick clicks re-roll the style ----------
  const STYLES = ['anime', 'balloon', 'base', 'blueprint', 'bricks', 'candy', 'clay', 'comic', 'crayon', 'crochet', 'felt', 'glass', 'glitch', 'gold', 'graffiti', 'ice', 'knit', 'lowpoly', 'marble', 'mosaic', 'oil', 'origami', 'paper', 'pencil', 'pixel', 'plush', 'popart', 'porcelain', 'real', 'render3d', 'sketchnote', 'stitch', 'vector', 'watercolor', 'wood', 'woodblock', 'xray'];
  const COLORS = ['#7b2ff2', '#a46bff', '#ff005a', '#00beff', '#1f1830'];
  function burst(x, y, n = 10) {
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i'); p.className = 'fx-px'; p.style.background = COLORS[(Math.random() * COLORS.length) | 0];
      document.body.appendChild(p);
      const ang = R(-Math.PI * 0.95, -Math.PI * 0.05), sp = R(25, 70), dx = Math.cos(ang) * sp, dy = Math.sin(ang) * sp;
      p.animate([{ transform: `translate(${x}px, ${y}px)`, opacity: 1 },
                 { transform: `translate(${x + dx}px, ${y + dy}px) rotate(${R(-90, 90)}deg)`, opacity: 1, offset: .55 },
                 { transform: `translate(${x + dx * 1.25}px, ${y + dy * .6 + 30}px)`, opacity: 0 }],
        { duration: R(550, 850), easing: 'cubic-bezier(.2,.7,.4,1)' }).onfinish = () => p.remove();
    }
  }
  function jump(el, h = 1) {
    return el.animate([
      { transform: 'none' },
      { transform: 'scale(1.18, .8)', offset: .15 },
      { transform: `translateY(${-16 * h}px) scale(.88, 1.14)`, offset: .45, easing: 'ease-in' },
      { transform: 'scale(1.12, .88)', offset: .75 },
      { transform: 'none' }], { duration: 560, easing: 'ease-out' });
  }
  function reroll(el) {
    const own = el.dataset.own || (el.dataset.own = el.getAttribute('src'));
    const next = 'assets/thumbs/' + STYLES.filter(s => !own.endsWith('/' + s + '.webp'))[(Math.random() * 36) | 0] + '.webp';
    el.animate([{ filter: 'drop-shadow(-4px 0 0 rgba(255,0,90,.8)) drop-shadow(4px 0 0 rgba(0,190,255,.8))', clipPath: 'inset(20% 0 40% 0)', transform: 'translateX(-5px)' },
                { clipPath: 'inset(60% 0 5% 0)', transform: 'translateX(5px)' }, { clipPath: 'inset(0)', filter: 'none', transform: 'none' }], { duration: 380, easing: 'steps(2)' });
    setTimeout(() => { el.src = next; el.dataset.own = next; }, 130);   // the hover glitches now come back to the new style
  }
  for (const { el } of elmos) {
    let clicks = [];
    el.addEventListener('click', e => {
      const now = performance.now(); clicks = clicks.filter(t => now - t < 1200); clicks.push(now);
      const b = el.getBoundingClientRect();
      if (clicks.length >= 3) { clicks = []; reroll(el); burst(b.left + b.width / 2, b.top + b.height / 2, 18); return; }
      if (el._jump) return; el._jump = 1;
      jump(el).onfinish = () => { el._jump = 0; };
      setTimeout(() => burst(b.left + b.width / 2, b.bottom - 6, 8), 90);
    });
  }

  // ---------- the end: a wave ----------
  let waved = 0;
  addEventListener('scroll', () => {
    if (waved || innerHeight + scrollY < document.documentElement.scrollHeight - 4) return;
    waved = 1;
    elmos.filter(c => { const b = c.el.getBoundingClientRect(); return b.bottom > 0 && b.top < innerHeight; })
      .forEach((c, i) => setTimeout(() => { if (!c.el._jump) { c.el._jump = 1; jump(c.el, 0.7).onfinish = () => { c.el._jump = 0; }; }; }, 380 + i * 90));
  }, { passive: true });
})();
