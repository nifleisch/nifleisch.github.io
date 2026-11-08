// Background: faint diffusion-style noise that the cursor "denoises" around itself;
// it flares (with a few red/cyan specks) whenever the creature glitches into another style.
// ?bg=dots or ?bg=glow still show the two alternatives that were tried.
(() => {
  const MODES = ['dots', 'noise', 'glow'];
  let mode = new URLSearchParams(location.search).get('bg');
  if (!MODES.includes(mode)) mode = 'noise';
  const c = document.createElement('canvas'); c.id = 'bg';
  Object.assign(c.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', zIndex: '0', pointerEvents: 'none' });
  document.body.prepend(c);
  const g = c.getContext('2d'), GAP = 22;
  const low = document.createElement('canvas'), lg = low.getContext('2d');
  let W = 0, H = 0, dpr = 1, mx = -1e4, my = -1e4, sx = -1e4, sy = -1e4, glitchAt = -1e4;
  let glowCol = [123, 47, 242], glowFrom = glowCol, glowTo = glowCol, glowT = 1;
  const NOISE = mode === 'noise';
  if (NOISE) c.style.imageRendering = 'pixelated';
  const fit = () => { dpr = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight;
    low.width = Math.ceil(W / 4); low.height = Math.ceil(H / 4);
    if (NOISE) { c.width = low.width; c.height = low.height; img = null; } else { c.width = W * dpr; c.height = H * dpr; } };
  let img = null;
  fit(); addEventListener('resize', fit);
  addEventListener('pointermove', e => { mx = e.clientX; my = e.clientY; });
  addEventListener('touchmove', e => { mx = e.touches[0].clientX; my = e.touches[0].clientY; }, { passive: true });
  const hex = h => { const n = parseInt((h || '#7b2ff2').slice(1), 16); return [n >> 16, n >> 8 & 255, n & 255]; };
  addEventListener('styleglitch', e => { glitchAt = performance.now();
    const cur = glowCol; glowFrom = cur; glowTo = hex(e.detail && e.detail.color); glowT = 0; });
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rnd = s => { const x = Math.sin(s * 127.1) * 43758.5453; return x - Math.floor(x); };
  const fig = () => { const f = document.getElementById('figure'); return f ? f.getBoundingClientRect() : { left: W / 2, top: H / 2, width: 0, height: 0 }; };

  function dots(now, gs, fr) {
    const R = Math.min(220, Math.max(W, H) * 0.18);
    for (let y = GAP / 2, row = 0; y < H; y += GAP, row++) {
      let shift = 0, hot = 0;
      if (gs && !reduce && rnd(row * 13.7 + fr) < gs * 0.35) { shift = (rnd(row + fr * 3.1) - .5) * 120 * gs; hot = 1; }
      for (let x = GAP / 2; x < W; x += GAP) {
        const dx = x - sx, dy = y - sy, d = Math.hypot(dx, dy), k = reduce ? 0 : Math.max(0, 1 - d / R);
        const push = k * k * 10, px = x + shift + (d ? dx / d * push : 0), py = y + (d ? dy / d * push : 0);
        g.fillStyle = hot ? `rgba(${rnd(x) < .5 ? '255,0,90' : '0,190,255'},${.35 * gs + .1})`
          : `rgba(${Math.round(31 + 92 * k)},${Math.round(24 + 23 * k)},${Math.round(48 + 194 * k)},${.13 + .45 * k})`;
        g.beginPath(); g.arc(px, py, 1 + k * 1.6, 0, 6.2832); g.fill();
      }
    }
  }
  const AMP = +(document.body.dataset.bgAmp || 1);   // a calmer background on text-heavy pages
  // glitches stay local: small patches pop up here and there, never the whole screen at once
  const patches = []; let nextPatch = 1200, lastGlitch = -1e4;
  const spawn = (now, x, y, s) => { const w = (8 + Math.random() * 22) * s, h = (3 + Math.random() * 8) * s;
    patches.push({ x: x - w / 2, y: y - h / 2, w, h, t0: now, len: 180 + Math.random() * 280 }); };
  // precomputed random table + integer hashing: far cheaper than Math.sin per pixel (Safari especially)
  const TBL = new Float32Array(1 << 16); for (let i = 0; i < TBL.length; i++) TBL[i] = Math.random();
  const hr = (x, y, s) => TBL[((x * 73856093) ^ (y * 19349663) ^ (s * 83492791)) & 65535];
  let lastNoise = -1e4;
  function noise(now, gs, fr) {
    if (now - lastNoise < 33) return;                                     // ~30 fps is plenty for grain
    lastNoise = now;
    const w = low.width, h = low.height;
    if (!reduce && now > nextPatch) { spawn(now, Math.random() * w, Math.random() * h, 1); nextPatch = now + 1400 + Math.random() * 2600; }
    if (!reduce && glitchAt !== lastGlitch) { lastGlitch = glitchAt;            // style change: a couple of patches near the creature
      const f = fig(); for (let k = 0; k < 2; k++) spawn(now, (f.left + f.width * (0.1 + Math.random() * 0.8)) / 4, (f.top + f.height * (0.2 + Math.random() * 0.8)) / 4, 1.2); }
    for (let k = patches.length - 1; k >= 0; k--) { const p = patches[k], t = (now - p.t0) / p.len;
      if (t >= 1) patches.splice(k, 1); else p.s = 0.5 * Math.sin(Math.PI * t) * AMP; }
    if (!img || img.width !== w || img.height !== h) img = g.createImageData(w, h);
    const d = img.data;
    const seed = reduce ? 1 : Math.floor(now / 70), R = Math.min(260, Math.max(W, H) * 0.22) / 4, R2 = R * R, cx = sx / 4, cy = sy / 4;
    const drift = reduce ? 0 : now / 1400;
    for (let y = 0; y < h; y++) {
      const band = 0.55 + 0.45 * Math.sin(y * 0.09 + drift) * Math.sin(y * 0.023 - drift * 0.7);
      const base = AMP * (0.06 + 0.05 * band), dy2 = (y - cy) * (y - cy);
      // patches touching this row
      let rowP = null; for (const p of patches) if (y >= p.y && y < p.y + p.h) (rowP || (rowP = [])).push(p);
      for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
        let G = 0; if (rowP) for (const p of rowP) if (x >= p.x && x < p.x + p.w && p.s > G) G = p.s;
        const blk = G && hr(x >> 2, ((y / 3) | 0) + 7, seed) < G * 0.5;
        const n = blk ? hr((x >> 2) + 1, ((y / 3) | 0) * 57, seed + 3) : hr(x, y, seed);
        const q = (x - cx) * (x - cx) + dy2; let clr = 1;
        if (q < R2) { const c1 = 1 - Math.sqrt(q) / R; clr = 1 - c1 * c1; }      // the cursor denoises
        const a = (base + AMP * 0.25 * G) * clr * (0.35 + n) * (blk ? 1.4 : 1);
        let r = 90 + 60 * n, gg = 50 + 40 * n, b = 160 + 80 * n;
        if (G) { const tint = hr(x + 11, y + 5, seed); if (tint < .12 * G) { r = 255; gg = 20; b = 110; } else if (tint > 1 - .12 * G) { r = 0; gg = 210; b = 255; } }
        d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = a > 1 ? 255 : a * 255;
      }
      // inside each patch, tear a few rows sideways by shifting the pixel data
      if (rowP) for (const p of rowP) {
        if (hr(y, fr, 9) >= 0.5) continue;
        const off = Math.round((hr(y, fr, 13) - .5) * 20 * p.s); if (!off) continue;
        const x0 = Math.max(0, Math.floor(p.x)), x1 = Math.min(w, Math.ceil(p.x + p.w)), row = y * w * 4;
        let src = x0, dst = x0 + off, len = x1 - x0;
        if (dst < 0) { src -= dst; len += dst; dst = 0; } if (dst + len > w) len = w - dst;
        if (len > 0) d.copyWithin(row + dst * 4, row + src * 4, row + (src + len) * 4);
      }
    }
    g.putImageData(img, 0, 0);
  }
  function glow(now, gs) {
    glowT = Math.min(1, glowT + 0.03);
    glowCol = glowFrom.map((v, i) => v + (glowTo[i] - v) * glowT);
    const f = fig(), fx = f.left + f.width / 2, fy = f.top + f.height * 0.55;
    const ox = (sx > -1e3 ? (sx - fx) * 0.08 : 0), oy = (sy > -1e3 ? (sy - fy) * 0.08 : 0);
    const r = Math.max(f.width, 300) * (0.85 + 0.04 * Math.sin(now / 1400)) * (1 + gs * 0.25);
    const [R, G, B] = glowCol.map(Math.round);
    const gr = g.createRadialGradient(fx + ox, fy + oy, 0, fx + ox, fy + oy, r);
    gr.addColorStop(0, `rgba(${R},${G},${B},${.30 + gs * .2})`); gr.addColorStop(.45, `rgba(${R},${G},${B},.12)`); gr.addColorStop(1, `rgba(${R},${G},${B},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  }
  function frame(now) {
    sx += (mx - sx) * 0.12; sy += (my - sy) * 0.12;
    if (!NOISE) { g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H); }
    const gt = (now - glitchAt) / 480, gs = gt >= 0 && gt < 1 ? Math.sin(Math.PI * gt) : 0, fr = Math.floor(now / 42);
    if (mode === 'dots') dots(now, gs, fr); else if (mode === 'noise') noise(now, gs, fr); else glow(now, gs);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
