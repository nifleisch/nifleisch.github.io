// 2.5D puppet rig. Layers come from assets/manifest.json (generated) and their
// placement from assets/rig.json (hand-tunable: open the page with ?edit).
(async () => {
  const get = async u => { const r = await fetch(u); if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); };
  let M, R;
  try { [M, R] = await Promise.all([get('assets/manifest.json'), get('assets/rig.json')]); }
  catch (e) {                                          // offline / blocked: show the still sticker instead of "loading…" forever
    const l = document.getElementById('loading'); if (l) l.remove();
    const im = new Image(); im.src = 'apple-touch-icon.png'; im.alt = '';
    Object.assign(im.style, { position: 'absolute', inset: '15%', width: '70%', height: '70%', objectFit: 'contain' });
    document.getElementById('figure').appendChild(im); throw e;
  }
  const EDIT = new URLSearchParams(location.search).has('edit');
  const S = R.stage, PX = R.mode === 'frame' ? 1024 : 900;                       // stage units -> backing pixels
  const fig = document.getElementById('figure');
  const rigC = document.getElementById('rig'), ctx = rigC.getContext('2d');
  rigC.width = rigC.height = PX;
  const shade = (hex, f) => { const n = parseInt(hex.slice(1), 16);
    return `rgb(${(n >> 16) * f | 0},${(n >> 8 & 255) * f | 0},${(n & 255) * f | 0})`; };
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = PX; return c; };
  const k = PX / S;

  // ---------- assets: first style, then the rest in the background
  const imgs = {};
  const loadImg = src => new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
  // the flame art is fetched together with the layers, so a style only counts as ready once its flames are too
  const loadStyle = s => Promise.all([...Object.entries(s.parts).map(([n, src]) => loadImg('assets/' + src).then(i => [n, i])),
    ...(s.flames && s.flames.art ? [loadImg(s.flames.art).then(() => ['_flames', null])] : [])]).then(list => (imgs[s.id] = Object.assign(Object.fromEntries(list), { lid: s.lid, lidLine: s.lidLine, eyes: s.eyes })));
  await loadStyle(M.styles[0]);
  document.getElementById('loading').remove();
  M.styles.slice(1).forEach(loadStyle);

  // no WebGL (old devices, blocked GPU): the creature still works, just without shader flames
  let flames;
  try { flames = new Flames(document.getElementById('flames')); }
  catch (e) {                                          // fallback: the painted flame image, standing still
    console.warn('WebGL flames unavailable, using still flames:', e.message);
    const c2 = document.getElementById('flames'), g2 = c2.getContext('2d'); let art = null;
    flames = { setStyle(s) { const i = new Image(); i.onload = () => { art = i; }; i.src = s.art; }, update() {},
      draw() { const w = c2.clientWidth, h = c2.clientHeight; if (c2.width !== w || c2.height !== h) { c2.width = w; c2.height = h; }
        g2.clearRect(0, 0, w, h); const f = this.frame; if (art && f) g2.drawImage(art, f[0] * w, (1 - f[1] - f[3]) * h, f[2] * w, f[3] * h); } };
  }
  flames.setStyle(M.styles[0].flames, 0);
  const fl = document.getElementById('flames');
  // the flame canvas covers the whole figure; the art box from rig.json is handed to the shader,
  // so the flames can flare past their box without being clipped by the canvas edge
  Object.assign(fl.style, { inset: '0', width: '100%', height: '100%' });
  flames.frame = [(R.flames.x - R.flames.w / 2) / S, 1 - (R.flames.y + R.flames.h / 2) / S, R.flames.w / S, R.flames.h / S];

  // ---------- zones
  const zonesEl = document.getElementById('zones');
  const cols = Math.ceil(Math.sqrt(M.styles.length)), rows = Math.ceil(M.styles.length / cols);
  zonesEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  zonesEl.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
  // the grid has more cells than styles; the spare cells get a repeat of some other style, so no corner is dead
  const SPARE = ['lava', 'chrome', 'xray', 'gold', 'moss', 'blueprint'].map(id => M.styles.findIndex(s => s.id === id)).filter(i => i >= 0);
  const ZONE = Array.from({ length: cols * rows }, (_, i) => i < M.styles.length ? i : SPARE[(i - M.styles.length) % SPARE.length]);
  const zoneEls = M.styles.map(s => { const d = document.createElement('div'); d.className = 'zone'; d.textContent = s.name; zonesEl.appendChild(d); return d; });

  // ---------- input
  // `touched` stays false until a real pointer moves: until then the creature shows its original look
  // instead of whatever style happens to sit under the (imaginary) cursor in the middle of the screen
  let mx = innerWidth / 2, my = innerHeight / 2, lastMove = performance.now(), clickUntil = 0, idleStyle = null, nextIdle = 0, touched = false;
  const moved = (x, y) => { mx = x; my = y; lastMove = performance.now(); touched = true; };
  addEventListener('pointermove', e => moved(e.clientX, e.clientY));
  addEventListener('touchmove', e => moved(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  if (!EDIT) addEventListener('pointerdown', () => (clickUntil = performance.now() + 1300));

  // ---------- rig state
  const st = { yaw: 0, pitch: 0, vy: 0, vp: 0, lean: 0, vl: 0, leaf: 0, vleaf: 0, blink: 0, nextBlink: 2000, click: false, eyeTarget: [0, 0],
    eye: [0, 0], ve: [0, 0], arms: { arm_l: [0, 0], arm_r: [0, 0] }, saccade: [0, 0], nextSaccade: 800 };

  // ---------- drawing
  // Body layers are drawn flat. Everything on the head (fur, leaf, eyes + live pupils, nose, mouth)
  // is first composited flat, front-facing, then wrapped onto a sphere and rotated (sphere.js).
  const FRAME = R.mode === 'frame';                   // full-frame layers cut pixel for pixel from the original
  const FLAT = !R.sphere;                              // flat 2D rig: features slide over the body (parallax), no 3D warp
  const sphere = FLAT || FRAME ? null : new SphereHead(768);
  const faceC = document.createElement('canvas'); faceC.width = faceC.height = 768;
  const fctx = faceC.getContext('2d');
  const SP = Object.assign({ r: 0.42, dy: 0.02, square: 1.6, maxYaw: 0.45, maxPitch: 0.28 }, R.sphere || {});
  const headL = (R.layers || []).find(L => L.part === 'head');
  const isBody = L => L.part === 'body' || L.part === 'body_armsup';

  function size(L, img) { return [L.w, L.w * img.naturalHeight / img.naturalWidth]; }

  function drawLayer(c, L, img, x, y) {
    let [w, h] = size(L, img);
    c.save(); c.translate(x, y);
    if (isBody(L)) c.scale(1, 1 + Math.sin(performance.now() / 900) * 0.008);
    if (L.wobble) { const pv = L.pivot || [0.5, 0.5]; c.translate((pv[0] - .5) * w, (pv[1] - .5) * h); c.rotate(st.leaf); c.translate(-(pv[0] - .5) * w, -(pv[1] - .5) * h); }
    if (L.eye) h *= 1 - 0.9 * st.blink;
    if (FLAT && L.eye) w *= 1 - 0.18 * Math.max(0, -st.yaw * L.eye);   // the far eye narrows a bit when turning
    c.drawImage(img, -w / 2, -h / 2, w, h);
    if (L.eye && st.blink < 0.6) {                                   // live pupil
      const r = R.pupil.size * L.w / 2, t = R.pupil.travel * L.w, [ex, ey] = st.eyeTarget, sq = 1 - st.blink;
      c.fillStyle = R.pupil.color; c.beginPath(); c.ellipse(ex * t, ey * t * sq, r, r * sq, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(255,255,255,.85)'; c.beginPath(); c.arc(ex * t - r * .35, ey * t * sq - r * .35, r * .22, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }

  function visible(L) {
    if (L.only === 'click' && !st.click) return false;
    if (L.not === 'click' && st.click) return false;
    if (L.part === 'body' && st.click) return false;
    return true;
  }

  // frame mode: body, live pixel pupils, nose, leaf, all on the original's pixel grid
  const G1 = FRAME ? S / R.grid : 1;                  // one original pixel in stage units
  const bottom = FRAME ? (R.bottom || 115) * G1 : 0;
  function drawFrame(P, c) {
    c.imageSmoothingEnabled = !R.pixelated;
    c.save();
    const m = R.margin || 1; c.translate(S * (1 - m) / 2, S * 0.1); c.scale(m, m);
    // the body stays put; only the arms swing (idle sway + reaching toward the cursor, a cheer on click)
    const now = performance.now() / 1000;
    for (const [n, side] of [['arm_l', -1], ['arm_r', 1]]) {
      const A = R.arms && R.arms[n]; if (!A || !P[n]) continue;
      const ang = st.arms[n][0] * side;
      c.save(); c.translate(A.pivot[0] * G1, A.pivot[1] * G1); c.rotate(ang); c.translate(-A.pivot[0] * G1, -A.pivot[1] * G1);
      c.drawImage(P[n], 0, 0, S, S); c.restore();
    }
    if (P.body) c.drawImage(P.body, 0, 0, S, S);
    // pupils slide inside each eye (the style's own eye position), the eyelid comes down over them
    const pw = R.pupil.w, ph = R.pupil.h;
    for (const e of (P.eyes || R.eyes)) {
      c.save(); c.beginPath(); c.ellipse(e.cx * G1, e.cy * G1, (e.rx + .1) * G1, (e.ry + .1) * G1, 0, 0, Math.PI * 2); c.clip();
      const [tx, ty] = st.eye;
      if (!R.pixelated) {                             // smooth pupil + shine for the hi-res art
        const pr = Math.min(e.rx, e.ry) * (0.4 + 0.05 * st.lean);      // pupils widen a little when you come close
        const qx = e.cx + tx * (e.rx - pr - .4), qy = e.cy + ty * (e.ry - pr - .4);
        c.fillStyle = R.pupil.color; c.beginPath(); c.ellipse(qx * G1, qy * G1, pr * 1.04 * G1, pr * G1, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = 'rgba(255,255,255,.92)'; c.beginPath(); c.arc((qx - pr * .35) * G1, (qy - pr * .38) * G1, pr * .28 * G1, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.arc((qx + pr * .3) * G1, (qy + pr * .32) * G1, pr * .11 * G1, 0, Math.PI * 2); c.fill();
      } else {
        const px = Math.round(e.cx + tx * (e.rx - pw / 2 - .4) - pw / 2), py = Math.round(e.cy + ty * (e.ry - ph / 2 - .4) - ph / 2);
        c.fillStyle = R.pupil.color;                  // rounded pixel pupil: full middle row, corners left out
        c.fillRect((px + 1) * G1, py * G1, (pw - 2) * G1, ph * G1);
        c.fillRect(px * G1, (py + 1) * G1, pw * G1, (ph - 2) * G1);
        c.fillStyle = 'rgba(255,255,255,.9)'; c.fillRect((px + 1) * G1, (py + 1) * G1, G1, G1);
      }
      if (st.blink > 0.02) {                          // a real eyelid: fur-coloured, curved lower edge with a lash line
        const b = st.blink, top = (e.cy - e.ry - .5) * G1, L = (e.cx - e.rx - .5) * G1, Rr = (e.cx + e.rx + .5) * G1;
        const edge = top + b * (e.ry * 2 + 1.2) * G1, bow = e.ry * 0.55 * G1 * Math.min(1, b * 1.6);
        c.beginPath(); c.moveTo(L, top - G1); c.lineTo(Rr, top - G1); c.lineTo(Rr, edge - bow * 0.6);
        c.quadraticCurveTo(e.cx * G1, edge + bow, L, edge - bow * 0.6); c.closePath();
        const gr = c.createLinearGradient(0, top, 0, edge + bow);
        gr.addColorStop(0, P.lid || '#6b21a8'); gr.addColorStop(1, shade(P.lid || '#6b21a8', 0.82));
        c.fillStyle = gr; c.fill();
        c.beginPath(); c.moveTo(Rr, edge - bow * 0.6); c.quadraticCurveTo(e.cx * G1, edge + bow, L, edge - bow * 0.6);
        c.strokeStyle = P.lidLine || '#1a1024'; c.lineWidth = Math.max(1.2, e.ry * 0.22) * G1; c.lineCap = 'round'; c.stroke();
      }
      c.restore();
    }
    if (P.nose) c.drawImage(P.nose, 0, 0, S, S);
    if (P.leaf) {
      const [lx, ly] = R.leafPivot;
      c.translate(lx * G1, ly * G1); c.rotate(st.leaf * 1.6); c.translate(-lx * G1, -ly * G1);
      c.drawImage(P.leaf, 0, 0, S, S);
    }
    c.restore();
  }

  function drawRig(id, c) {
    const P = imgs[id] || imgs[M.styles[0].id];
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, PX, PX); c.setTransform(k, 0, 0, k, 0, 0);
    if (FRAME) return drawFrame(P, c);
    if (FLAT) {
      for (const L of R.layers) if (visible(L) && P[L.part]) {
        const d = L.depth ?? 0.5;
        drawLayer(c, L, P[L.part], L.x + st.yaw * R.turn.yawPx * d, L.y - st.pitch * R.turn.pitchPx * d);
      }
      if (EDIT && sel) { const img = P[sel.part]; if (img) { const [w, h] = size(sel, img);
        c.strokeStyle = '#f0f'; c.lineWidth = 3 / k; c.strokeRect(sel.x - w / 2, sel.y - h / 2, w, h); } }
      return;
    }
    // body, shifted a little with the turn
    for (const L of R.layers) if (isBody(L) && visible(L) && P[L.part])
      drawLayer(c, L, P[L.part], L.x + st.yaw * R.turn.yawPx * (L.depth ?? .15), L.y - st.pitch * R.turn.pitchPx * (L.depth ?? .15));
    // flat head composite in a square around the head
    const side = headL.w * SP.square, hx = headL.x, hy = headL.y + headL.w * SP.dy;
    const fk = faceC.width / side;
    fctx.setTransform(1, 0, 0, 1, 0, 0); fctx.clearRect(0, 0, faceC.width, faceC.height);
    fctx.setTransform(fk, 0, 0, fk, fk * (side / 2 - hx), fk * (side / 2 - hy));
    for (const L of R.layers) if (!isBody(L) && visible(L) && P[L.part]) drawLayer(fctx, L, P[L.part], L.x, L.y);
    const out = sphere.render(faceC, faceC.width / 2, faceC.height / 2, headL.w * SP.r * fk, st.yaw * SP.maxYaw, st.pitch * SP.maxPitch);
    const ox = st.yaw * R.turn.yawPx * 0.25, oy = -st.pitch * R.turn.pitchPx * 0.25;
    c.drawImage(out, hx - side / 2 + ox, hy - side / 2 + oy, side, side);
    if (EDIT && sel) { const img = P[sel.part]; if (img) { const [w, h] = size(sel, img);
      c.strokeStyle = '#f0f'; c.lineWidth = 3 / k; c.strokeRect(sel.x - w / 2, sel.y - h / 2, w, h); } }
  }

  // edit mode needs flat positions
  function place(L, img) { const [w, h] = size(L, img); return { x: L.x, y: L.y, w, h }; }

  // ---------- glitch transition between styles: horizontal bands flip to the new style
  // out of order, tear sideways, flicker back, with an RGB split and a few pixelated blocks
  const bufA = mk(), bufB = mk(), mixC = mk(), HP = PX / 2;
  const mkH = () => { const c = document.createElement('canvas'); c.width = c.height = HP; return c; };
  const redC = mkH(), cyanC = mkH();   // the RGB ghosts are drawn at half size: much cheaper, and invisible in a 0.5 s glitch
  const lowC = document.createElement('canvas'); lowC.width = lowC.height = 64;
  const DUR = 480 * (+new URLSearchParams(location.search).get('slow') || 1);
  let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  function tint(dst, src, col) {
    const d = dst.getContext('2d');
    d.globalCompositeOperation = 'copy'; d.drawImage(src, 0, 0, HP, HP);
    d.globalCompositeOperation = 'multiply'; d.fillStyle = col; d.fillRect(0, 0, HP, HP);
    d.globalCompositeOperation = 'destination-in'; d.drawImage(src, 0, 0, HP, HP);
    d.globalCompositeOperation = 'source-over';
  }
  function glitch(t, g, now) {
    seed = 1 + Math.floor(now / 42) % 100000;                                  // re-roll ~24x a second
    const m = mixC.getContext('2d');
    m.setTransform(1, 0, 0, 1, 0, 0); m.clearRect(0, 0, PX, PX); m.imageSmoothingEnabled = false;
    for (let y = 0; y < PX;) {
      const h = Math.round(PX * (0.008 + rnd() * rnd() * 0.12));
      let src = rnd() < t ? bufB : bufA;
      if (rnd() < g * 0.3) src = src === bufA ? bufB : bufA;                  // flicker back
      const dx = rnd() < g * 0.55 ? (rnd() - 0.5) * 2 * g * PX * 0.09 : 0;    // tear sideways
      m.drawImage(src, 0, y, PX, h, dx, y, PX, h);
      y += h;
    }
    const nb = Math.floor(g * 4 * rnd() + g);                                // a few pixelated blocks
    for (let i = 0; i < nb; i++) {
      const w = PX * (0.1 + rnd() * 0.3), h = PX * (0.03 + rnd() * 0.12), x = rnd() * (PX - w), y = PX * (0.15 + rnd() * 0.7);
      const l = lowC.getContext('2d'); l.clearRect(0, 0, 64, 64);
      const lw = Math.max(2, Math.round(w / 24)), lh = Math.max(2, Math.round(h / 24));
      l.drawImage(mixC, x, y, w, h, 0, 0, lw, lh);
      m.clearRect(x, y, w, h); m.drawImage(lowC, 0, 0, lw, lh, x, y, w, h);
    }
    const d = Math.round(g * PX * 0.014);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, PX, PX);
    if (d < 1) { ctx.drawImage(mixC, 0, 0); return; }
    tint(redC, mixC, '#ff0000'); tint(cyanC, mixC, '#00ffff');
    ctx.drawImage(redC, -d, 0, PX, PX);
    ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(cyanC, d, 0, PX, PX);
    ctx.globalCompositeOperation = 'source-over';
  }
  let style = M.styles[0].id, trans = null;

  // ---------- edit mode: click a layer, drag to move, wheel to resize, C to copy rig.json
  let sel = null, drag = null;
  const editEl = document.getElementById('edit');
  const toStage = e => { const r = rigC.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * S, (e.clientY - r.top) / r.height * S]; };
  const showRig = () => (editEl.textContent = 'drag = move, wheel = size, C = copy\n' + JSON.stringify(R, null, 1));
  if (EDIT) {
    editEl.style.display = 'block'; showRig();
    rigC.style.pointerEvents = 'auto'; fig.style.zIndex = 5;
    rigC.addEventListener('pointerdown', e => {
      const [x, y] = toStage(e), P = imgs[style];
      sel = [...R.layers].reverse().find(L => { const img = P[L.part]; if (!img || L.only) return false;
        const p = place(L, img); return Math.abs(x - p.x) < p.w / 2 && Math.abs(y - p.y) < p.h / 2; }) || null;
      if (sel) drag = [x - sel.x, y - sel.y];
    });
    addEventListener('pointermove', e => { if (drag && sel) { const [x, y] = toStage(e); sel.x = Math.round(x - drag[0]); sel.y = Math.round(y - drag[1]); showRig(); } });
    addEventListener('pointerup', () => (drag = null));
    rigC.addEventListener('wheel', e => { if (sel) { e.preventDefault(); sel.w = Math.max(10, Math.round(sel.w * (e.deltaY < 0 ? 1.03 : 0.97))); showRig(); } }, { passive: false });
    addEventListener('keydown', e => { if (e.key === 'c') navigator.clipboard?.writeText(JSON.stringify(R, null, 1)); });
  }

  // ---------- main loop
  let HOVER = null;
  document.querySelectorAll('[data-style]').forEach(el => {
    el.addEventListener('pointerenter', () => { HOVER = el.dataset.style; }); el.addEventListener('pointerleave', () => { HOVER = null; });
    el.addEventListener('focus', () => { HOVER = el.dataset.style; }); el.addEventListener('blur', () => { HOVER = null; });
  });
  const FORCE_STYLE = new URLSearchParams(location.search).get('style');          // for checking one style
  const FORCE_BLINK = +new URLSearchParams(location.search).get('blink') || 0;   // for checking eyelids
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let prev = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
    const r = fig.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height * 0.4;
    let tx = mx, ty = my;
    if (now - lastMove > 5000) { tx = cx + Math.sin(now / 1900) * innerWidth * 0.3; ty = cy + Math.sin(now / 2700) * innerHeight * 0.2; }
    const dx = Math.max(-1, Math.min(1, (tx - cx) / (innerWidth / 2))), dy = Math.max(-1, Math.min(1, (ty - cy) / (innerHeight / 2)));
    const kk = reduce ? 40 : 55, damp = reduce ? 14 : 10;
    const tyaw = EDIT ? 0 : dx, tpitch = EDIT ? 0 : -dy;
    st.vy += (tyaw - st.yaw) * kk * dt - st.vy * damp * dt; st.yaw += st.vy * dt;
    st.vp += (tpitch - st.pitch) * kk * dt - st.vp * damp * dt; st.pitch += st.vp * dt;
    const near = Math.max(0, 1 - Math.hypot(dx, dy) / 0.9);
    st.vl += (near - st.lean) * 30 * dt - st.vl * 9 * dt; st.lean += st.vl * dt;
    // the leaf stays still (Nils didn't like it wobbling); st.leaf stays 0
    st.click = now < clickUntil;
    // pupils: look straight at the cursor (no spring: googly eyes are snappy)
    const ex = (mx - cx), ey = (my - (r.top + r.height * (FRAME ? 0.55 : 0.375))), len = Math.hypot(ex, ey), sat = Math.min(1, len / 160);
    st.eyeTarget = EDIT ? [0, 0] : [len ? ex / len * sat : 0, len ? ey / len * sat : 0];
    // tiny saccades so the eyes never look frozen, and a quick but springy pupil follow
    st.nextSaccade -= dt * 1000;
    if (st.nextSaccade < 0) { st.saccade = [(Math.random() - .5) * .16, (Math.random() - .5) * .12]; st.nextSaccade = 600 + Math.random() * 1800; }
    for (let i = 0; i < 2; i++) {
      let goal = st.eyeTarget[i] + st.saccade[i]; goal = Math.max(-1, Math.min(1, goal));
      st.ve[i] += (goal - st.eye[i]) * 900 * dt - st.ve[i] * 42 * dt; st.eye[i] += st.ve[i] * dt;
    }
    const gl = Math.hypot(st.eye[0], st.eye[1]); if (gl > 1) { st.eye[0] /= gl; st.eye[1] /= gl; }
    // arms: springs with a bit of overshoot; they reach toward the cursor, sway, react to fast moves, cheer on click
    const tnow = now / 1000;
    for (const [n, side] of [['arm_l', -1], ['arm_r', 1]]) {
      const reach = st.yaw * side * 0.09 - st.pitch * 0.06 + st.lean * 0.05;
      const sway = Math.sin(tnow * 1.7 + (side > 0 ? 1.3 : 0)) * 0.035 + Math.sin(tnow * 0.63 + side) * 0.02;
      const cheer = st.click ? 0.1 + Math.sin(tnow * 17 + (side > 0 ? 0 : 1.2)) * 0.16 : 0;
      const A = st.arms[n], goal = reach + sway + cheer - st.vy * side * 0.02;
      A[1] += (goal - A[0]) * 140 * dt - A[1] * 9 * dt; A[0] += A[1] * dt;
    }
    // blink
    st.nextBlink -= dt * 1000;
    if (st.nextBlink < 0) { st.blink = Math.min(1, st.blink + dt * 14); if (st.blink >= 1) st.nextBlink = Math.random() < .18 ? 160 : 2200 + Math.random() * 3800; }   // sometimes a double blink
    else st.blink = Math.max(0, st.blink - dt * 10);
    if (FORCE_BLINK) { st.nextBlink = 1e9; st.blink = FORCE_BLINK; }

    // zone -> style
    const cell = Math.max(0, Math.min(cols - 1, Math.floor(mx / innerWidth * cols))) + cols * Math.max(0, Math.min(rows - 1, Math.floor(my / innerHeight * rows)));
    const zi = ZONE[cell];
    // nobody moving the cursor (or a phone): drift through random styles on its own
    let idle = null;
    if (!FORCE_STYLE && !reduce && now - lastMove > 6000) {
      if (now > nextIdle || !idleStyle) { const pool = M.styles.filter(s => s.id !== style && imgs[s.id]); idleStyle = pool[Math.floor(Math.random() * pool.length)]; nextIdle = now + 3200; }
      idle = idleStyle;
    } else idleStyle = null;
    const hov = HOVER && M.styles.find(s => s.id === HOVER && imgs[s.id]);   // hovering a link previews a matching style
    const want = (FORCE_STYLE && M.styles.find(s => s.id === FORCE_STYLE)) || hov || idle || (touched ? M.styles[zi] : M.styles[0]);
    zoneEls.forEach((z, i) => z.classList.toggle('active', M.styles[i] === want));
    if (!EDIT && !trans && want.id !== style && imgs[want.id]) { trans = { from: style, to: want.id, t0: now }; flames.setStyle(want.flames, DUR); dispatchEvent(new CustomEvent('styleglitch', { detail: { color: want.lid } })); }

    if (trans) {
      const t = Math.min(1, (now - trans.t0) / DUR), g = Math.sin(Math.PI * t);
      drawRig(trans.from, bufA.getContext('2d')); drawRig(trans.to, bufB.getContext('2d'));
      glitch(t, g, now);
      if (t >= 1) { style = trans.to; trans = null; }
    } else drawRig(style, ctx);

    flames.update({ sway: -st.vy * 0.5 - st.yaw * 0.25, intensity: 1 + st.lean * 0.4 + (st.click ? 0.9 : 0) });
    flames.draw();

    const breathe = reduce ? 0 : Math.sin(now / 900) * 0.006;
    const s = 1 + 0.16 * st.lean + breathe + (st.click ? 0.03 : 0);
    const hop = st.click ? -Math.abs(Math.sin((clickUntil - now) / 130)) * 14 : 0;
    const range = FRAME ? 2.2 : 1;
    const ox = dx * 24 * range * (0.4 + st.lean), oy = dy * 16 * range * (0.4 + st.lean) + hop;
    if (FRAME) { requestAnimationFrame(frame); return; }   // the figure itself stays put; CSS places it
    fig.style.transform = EDIT ? 'translate(-50%, -50%)' : `translate(calc(-50% + ${ox}px), calc(-50% + ${oy}px)) scale(${s})`;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
