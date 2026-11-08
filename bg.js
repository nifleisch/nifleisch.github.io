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
  const fit = () => { dpr = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight; c.width = W * dpr; c.height = H * dpr;
    low.width = Math.ceil(W / 4); low.height = Math.ceil(H / 4); };
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
  function noise(now, gs, fr) {
    const w = low.width, h = low.height;
    if (!reduce && now > nextPatch) { spawn(now, Math.random() * w, Math.random() * h, 1); nextPatch = now + 1400 + Math.random() * 2600; }
    if (!reduce && glitchAt !== lastGlitch) { lastGlitch = glitchAt;            // style change: a couple of patches near the creature
      const f = fig(); for (let k = 0; k < 2; k++) spawn(now, (f.left + f.width * (0.1 + Math.random() * 0.8)) / 4, (f.top + f.height * (0.2 + Math.random() * 0.8)) / 4, 1.2); }
    for (let k = patches.length - 1; k >= 0; k--) { const p = patches[k], t = (now - p.t0) / p.len;
      if (t >= 1) patches.splice(k, 1); else p.s = 0.5 * Math.sin(Math.PI * t) * AMP; }
    const img = lg.createImageData(w, h), d = img.data;
    const seed = reduce ? 1 : Math.floor(now / 70), R = Math.min(260, Math.max(W, H) * 0.22) / 4, cx = sx / 4, cy = sy / 4;
    const drift = reduce ? 0 : now / 1400;
    for (let y = 0; y < h; y++) {
      // slow rolling bands of denser noise, like a half-denoised image that keeps resampling
      const band = 0.55 + 0.45 * Math.sin(y * 0.09 + drift) * Math.sin(y * 0.023 - drift * 0.7);
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        let G = 0; for (const p of patches) if (x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h) G = Math.max(G, p.s);
        const blk = G && rnd(Math.floor(x / 4) * 7.7 + Math.floor(y / 3) * 3.3 + seed) < G * 0.5;      // blocky macro-pixels
        const n = blk ? rnd(Math.floor(x / 4) + Math.floor(y / 3) * 57 + seed) : rnd(x * 0.731 + y * 91.17 + seed * 7.13);
        const dist = Math.hypot(x - cx, y - cy), clear = Math.max(0, 1 - dist / R);                    // the cursor denoises
        const a = AMP * (0.06 + 0.05 * band + 0.25 * G) * (1 - clear * clear) * (0.35 + n) * (blk ? 1.4 : 1);
        const tint = G ? rnd(x * 3.1 + y * 1.7 + seed) : 0.5;
        const red = tint < .12 * G, cyan = tint > 1 - .12 * G;
        d[i] = red ? 255 : cyan ? 0 : 90 + 60 * n; d[i + 1] = cyan ? 210 : red ? 20 : 50 + 40 * n; d[i + 2] = cyan ? 255 : red ? 110 : 160 + 80 * n;
        d[i + 3] = Math.min(255, a * 255);
      }
    }
    lg.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(low, 0, 0, w * 4, h * 4);
    // inside each patch, tear a few strips sideways
    for (const p of patches) {
      const x0 = Math.max(0, Math.floor(p.x)), x1 = Math.min(w, Math.ceil(p.x + p.w)); if (x1 <= x0) continue;
      for (let y = Math.max(0, Math.floor(p.y)); y < Math.min(h, p.y + p.h);) {
        const sh = 1 + Math.floor(rnd(y * 1.3 + fr) * 3);
        if (rnd(y * 7.1 + fr) < 0.5) { const off = Math.round((rnd(y + fr * 2.7) - .5) * 10 * p.s * 2);
          g.clearRect(x0 * 4, y * 4, (x1 - x0) * 4, sh * 4); g.drawImage(low, x0, y, x1 - x0, sh, (x0 + off) * 4, y * 4, (x1 - x0) * 4, sh * 4); }
        y += sh;
      }
    }
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
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const gt = (now - glitchAt) / 480, gs = gt >= 0 && gt < 1 ? Math.sin(Math.PI * gt) : 0, fr = Math.floor(now / 42);
    if (mode === 'dots') dots(now, gs, fr); else if (mode === 'noise') noise(now, gs, fr); else glow(now, gs);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
