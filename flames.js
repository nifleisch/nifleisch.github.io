// Shader flames: the motion comes from procedural noise, a style is just
// a colour ramp + an optional tileable material texture + a few numbers.
// Switching style glitches between two styles inside the shader (band tearing + RGB split).
//
//   const f = new Flames(canvas);
//   f.setStyle({ ramp: ['#1a0033', '#6b1fd1', '#c77dff', '#fff0ff'], material: 'assets/mat_felt.webp',
//                materialAmount: 0.6, steps: 0, pixel: 0, outline: 0 }, 600);
//   f.update({ sway: -0.3, intensity: 1.2 });   // every frame, from the character's motion
window.Flames = class Flames {
  constructor(canvas) {
    this.c = canvas;
    const gl = (this.gl = canvas.getContext('webgl', { premultipliedAlpha: false, alpha: true }));
    const vs = `attribute vec2 p; varying vec2 uv0; void main(){ uv0 = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }`;
    const fs = `precision mediump float;
      varying vec2 uv0;
      uniform float t, sway, intensity, mixT;
      uniform sampler2D rampA, rampB, matA, matB, artA, artB;
      uniform float hasA, hasB;
      uniform vec4 fr;       // where the flame art sits inside the canvas: x, y, w, h (uv units)
      uniform vec4 pA, pB;   // materialAmount, steps, pixel, outline
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + 1.), f.x), f.y); }
      float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 5; i++){ v += a * n(p); p *= 2.03; a *= .5; } return v; }
      float heat(vec2 q, vec4 P){
        if (P.z > 0.) q = (floor(q * P.z) + .5) / P.z;                 // pixel / low-poly look
        float y = q.y;
        vec2 d = q;
        d.x += sway * y * y * .35;                                        // lean against the motion
        d.x += (fbm(vec2(q.x * 3., y * 2. - t * 1.6)) - .5) * .35 * y;    // flicker
        float w = .46 * (1. - y * .55);                                   // bonfire silhouette
        float shape = 1. - smoothstep(0., w, abs(d.x - .5));
        float tongues = fbm(vec2(d.x * 5., y * 3. - t * 2.4));
        float v = shape * (1.25 - y * (1.6 - intensity * .7)) + (tongues - .55) * 1.1 * smoothstep(0., .35, shape);
        v = clamp(v * (1. - smoothstep(.75, 1., y)), 0., 1.);
        if (P.y > 0.) v = floor(v * P.y + .5) / P.y;                      // cartoon bands
        return v;
      }
      vec4 painted(vec2 q, sampler2D art, vec4 P){
        if (P.z > 0.) q = (floor(q * P.z) + .5) / P.z;                  // pixel-art: animate on the pixel grid                              // animate a painted flame image
        float y = q.y;
        float n1 = fbm(vec2(q.x * 4., y * 3. - t * 1.7)), n2 = fbm(vec2(q.x * 3. + 7., y * 2.5 - t * 2.1));
        vec2 d = q;
        d.x += (n1 - .5) * .085 * (.25 + y) + sway * y * y * .22;
        d.y += (n2 - .5) * .06 * y;
        d.y /= .86 + .14 * intensity;                                   // flare taller when excited
        d.x = .5 + (d.x - .5) / (.95 + .05 * intensity);
        if (P.z > 0.) d = (floor(d * P.z) + .5) / P.z;
        vec4 c = texture2D(art, vec2(d.x, 1. - d.y));
        c.a *= step(0., d.x) * step(d.x, 1.) * step(0., d.y) * step(d.y, 1.);
        return c;
      }
      vec4 shade(vec2 q, sampler2D ramp, sampler2D mat, vec4 P){
        float v = heat(q, P);
        vec3 col = texture2D(ramp, vec2(.01 + v * .98, .5)).rgb;
        vec3 m = texture2D(mat, q * vec2(2.5, 2.5) + vec2(0., -t * .15)).rgb;
        col = mix(col, col * m * 1.8, P.x);
        float a = smoothstep(.05, .2, v);
        if (P.w > 0. && P.y > 0.) { float e = heat(q + vec2(.006, 0.), P) + heat(q - vec2(.006, 0.), P);
          if (v < .2 && e > .3) { col = vec3(.08, .02, .12); a = 1.; } }  // ink outline
        return vec4(col, a);
      }
      vec4 styleA(vec2 q){ return hasA > .5 ? painted(q, artA, pA) : shade(q, rampA, matA, pA); }
      vec4 styleB(vec2 q){ return hasB > .5 ? painted(q, artB, pB) : shade(q, rampB, matB, pB); }
      vec4 S(vec2 q, float k){ return k > .5 ? styleB(q) : styleA(q); }
      void main(){
        vec2 uv = (uv0 - fr.xy) / fr.zw;                                  // room around the art so flaring never clips
        float p = 1. - mixT, g = sin(3.14159 * p);                       // progress old->new, glitch strength
        if (g < .001) { gl_FragColor = p > .5 ? styleB(uv) : styleA(uv); return; }
        float fr = floor(t * 24.);                                        // glitch re-rolls 24x a second
        float rows = 5. + floor(h(vec2(fr, 1.)) * 30.);
        float band = floor(uv.y * rows);
        float pick = step(h(vec2(band, fr)), p);                          // each band flips to the new style
        if (h(vec2(band, fr + 7.)) < g * .3) pick = 1. - pick;            // ...and flickers back
        vec2 q = uv;
        if (h(vec2(band, fr + 3.)) < g * .6) q.x += (h(vec2(band, fr + 5.)) - .5) * .3 * g;   // band tearing
        float s = .018 * g;
        vec4 cm = S(q, pick), cr = S(q + vec2(s, 0.), pick), cb = S(q - vec2(s, 0.), pick);  // RGB split
        vec4 c = vec4(cr.r, cm.g, cb.b, max(cm.a, max(cr.a, cb.a)));
        c.rgb *= 1. - .3 * g * step(.5, fract(gl_FragCoord.y * .25));    // scanlines
        gl_FragColor = c;
      }`;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = (this.pr = gl.createProgram());
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr);
    gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = n => gl.getUniformLocation(pr, n);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.white = this.tex(new Uint8Array([255, 255, 255, 255]), 1, 1);
    this.cur = null; this.next = null; this.t0 = 0; this.dur = 1;
    this.sway = 0; this.intensity = 1; this.start = performance.now();
  }
  tex(src, w, h) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (src instanceof Uint8Array) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    const pot = !(src instanceof Uint8Array) && (src.width & (src.width - 1)) === 0 && (src.height & (src.height - 1)) === 0;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, pot ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, pot ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }
  ramp(stops) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 1;
    const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 256, 0);
    stops.forEach((s, i) => gr.addColorStop(i / (stops.length - 1), s));
    g.fillStyle = gr; g.fillRect(0, 0, 256, 1);
    return this.tex(c);
  }
  async build(s) {
    const st = { ramp: this.ramp(s.ramp || ['#000', '#fff']), mat: this.white, art: this.white, has: 0,
      p: [s.material ? s.materialAmount ?? 0.6 : 0, s.steps || 0, s.pixel || 0, s.outline || 0] };
    if (s.art) {
      const img = new Image(); img.src = s.art;
      try { await img.decode(); st.art = this.tex(img); st.has = 1; } catch (e) {}
    }
    if (s.material) {
      const img = new Image(); img.src = s.material;
      try { await img.decode(); st.mat = this.tex(img); } catch (e) { st.p[0] = 0; }
    }
    return st;
  }
  async setStyle(s, ms = 600) {
    const st = await this.build(s);
    if (!this.cur) { this.cur = st; return; }
    if (this.next) this.cur = this.next;
    this.next = st; this.t0 = performance.now(); this.dur = ms;
  }
  update({ sway = 0, intensity = 1 } = {}) { this.sway = sway; this.intensity = intensity; }
  draw() {
    const gl = this.gl;
    if (!this.cur) return;
    const q = Math.min(1.5, devicePixelRatio || 1), w = Math.round(this.c.clientWidth * q), h = Math.round(this.c.clientHeight * q);   // cap the shader's resolution
    if (this.c.width !== w || this.c.height !== h) { this.c.width = w; this.c.height = h; }
    gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    let mixT = 1, B = this.cur;
    if (this.next) {
      mixT = 1 - Math.min(1, (performance.now() - this.t0) / this.dur);
      B = this.next;
      if (mixT <= 0) { this.cur = this.next; this.next = null; mixT = 1; B = this.cur; }
    }
    const A = this.cur, u = this.u;
    gl.uniform1f(u('t'), (performance.now() - this.start) / 1000);
    gl.uniform1f(u('sway'), this.sway); gl.uniform1f(u('intensity'), this.intensity); gl.uniform1f(u('mixT'), mixT);
    gl.uniform4fv(u('fr'), this.frame || [0, 0, 1, 1]);
    [[A.ramp, 'rampA'], [B.ramp, 'rampB'], [A.mat, 'matA'], [B.mat, 'matB'], [A.art, 'artA'], [B.art, 'artB']].forEach(([tx, n], i) => {
      gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tx); gl.uniform1i(u(n), i); });
    gl.uniform4fv(u('pA'), A.p); gl.uniform4fv(u('pB'), B.p);
    gl.uniform1f(u('hasA'), A.has); gl.uniform1f(u('hasB'), B.has);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
};
