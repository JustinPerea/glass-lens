// The renderer from Lab 03 "Liquid glass" (good-machines commit 4686091), cut out of the
// lab page and wrapped in createGlass(). The shaders, uniform packing, scene cache, blur
// pyramid, luminance grid and tone rules are the lab's; the editor, camera input, labels,
// motion, recording and the CSS fallback are not here. Comments marked "lab:" say where
// the code differs from the lab and why (also listed in implementation-notes.md).
import { MAX_SHAPES, VERT, COVER, BLUR, GLASS } from './shaders.js';
import { PARAMS, DEF, SCENE_KEYS, MAT_KEYS, PRESETS } from './params.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const KINDS = new Set(['rect', 'capsule', 'circle']);

// Scene cache and pyramid constants (lab, verbatim).
const SIGMA0 = 3;           // σ of pyramid level 0, in cache texels (level 0 is half res; 1.5 of its texels)
const PICK_SIGMA = 12;      // "colour from below" reads the pyramid at this σ, in world px
const MARGIN = 0.25;        // cache margin on each side, as a fraction of the view
const PYR_MAX = 10;         // pyramid levels; level i has σ = SIGMA0 · 2^i
const mipLevels = (w, h) => Math.floor(Math.log2(Math.max(w, h))) + 1;

// Luminance helpers (lab, verbatim).
const smoothstep01 = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const LIN = Float32Array.from({ length: 256 }, (_, c) => lin(c));
const mirror1 = t => { t = ((t % 2) + 2) % 2; return t > 1 ? 2 - t : t; };

function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }

// Links and pasted JSON are untrusted: a value of the wrong type keeps the fallback,
// numbers are clamped to the slider's range. (lab, verbatim)
function coerce(def, v, fallback) {
  if (def.type === 'bool') return typeof v === 'boolean' ? v : fallback;
  if (def.type === 'color') return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback;
  if (def.type === 'seg') return def.options.some(o => o[0] === v) ? v : fallback;
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? clamp(n, def.min, def.max) : fallback;
}

/** True when this browser can create a WebGL2 context. */
export function isSupported() {
  if (typeof document === 'undefined') return false;
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch (_) { return false; }
}

/**
 * Resolves a material: a preset id, or an object of settings (optionally with `preset`
 * naming the base). Unknown keys are ignored and values are clamped to PARAMS ranges.
 * Returns a complete settings object.
 */
export function resolveMaterial(m, base = PRESETS[0].p) {
  if (typeof m === 'string') {
    const P = PRESETS.find(p => p.id === m);
    if (!P) throw new Error(`glass-lens: unknown preset "${m}". Presets: ${PRESETS.map(p => p.id).join(', ')}`);
    return { ...P.p };
  }
  if (!m || typeof m !== 'object') throw new TypeError('glass-lens: a material is a preset id or an object of settings');
  const out = { ...(m.preset ? resolveMaterial(m.preset) : base) };
  for (const def of PARAMS) if (def.key in m) out[def.key] = coerce(def, m[def.key], out[def.key]);
  return out;
}

/**
 * Creates a glass renderer on `canvas` (which it owns: it draws the source and the glass).
 * Throws an Error with code 'ERR_NO_WEBGL2' when WebGL2 isn't available.
 *
 * options: { source, shapes, material, dpr, width, height }
 *   width/height: the canvas's CSS size; read from the canvas's layout box when left out.
 *   dpr: device px per CSS px; defaults to min(devicePixelRatio, 2), as in the lab.
 */
export function createGlass(canvas, options = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('glass-lens: createGlass needs a <canvas> element');
  let gl = null;
  try { gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false }); } catch (_) { gl = null; }
  if (!gl) {
    const err = new Error('glass-lens: WebGL2 is not available in this browser, so the glass cannot render.');
    err.code = 'ERR_NO_WEBGL2';
    throw err;
  }

  // ---- State (lab: these were page globals; here they belong to one renderer) ----
  const params = Object.assign({}, PRESETS[0].p);
  let W = 1, H = 1, dpr = 1, sizeOpt = { w: options.width, h: options.height }, dprOpt = options.dpr;
  // lab: the camera is fixed at zoom 1, centred. The lab's zoom terms are kept in the packing.
  const cam = { z: { x: 1 }, x: { x: 0.5 }, y: { x: 0.5 } };
  const scroll = { x: 0, y: 0 };   // lab: hands-free scrolling is left out; the offset stays 0
  let shapes = [];
  let progs = null, quad = null, imgTex = null, img = null, imgW = 1, imgH = 1;
  let fb = {};
  let sceneStale = true, cache = null;
  let live = null;                 // { el, video, lastT } when the source changes over time
  let srcGen = 0, destroyed = false, lost = false, ownImg = null;
  let lumCanvas = null, lumLin = null, lumW = 0, lumH = 0, meanLum = 0.5, lumAt = 0;
  const tintMemo = new Map();
  const tintRgb = h => { let v = tintMemo.get(h); if (!v) { if (tintMemo.size > 64) tintMemo.clear(); tintMemo.set(h, v = hexToRgb(h)); } return v; };

  // ---- WebGL2 (lab, verbatim apart from the label and compare programs) ----
  function compile(fragSrc, vertSrc = VERT) {
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vertSrc)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fragSrc));
    gl.bindAttribLocation(p, 0, 'a'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const loc = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, ''); loc[name] = gl.getUniformLocation(p, name); }
    return { p, loc };
  }
  function initGL() {
    // lab: the label and compare programs are left out.
    progs = { cover: compile(COVER), blur: compile(BLUR), glass: compile(GLASS) };
    quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    // The full-screen triangle, plus a fourth vertex so 4-vertex label strips stay in range.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3, 0, 0]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }
  // A render target. `levels` > 1 gives a mip chain with one framebuffer per level,
  // so passes can draw into a chosen level.
  function rtex(name, w, h, levels = 1) {
    let t = fb[name];
    if (t && t.w === w && t.h === h && t.levels === levels) return t;
    if (t) { gl.deleteTexture(t.tex); t.fbos.forEach(f => gl.deleteFramebuffer(f)); }
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, levels > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, levels - 1);
    const fbos = [];
    for (let i = 0; i < levels; i++) {
      const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, i);
      fbos.push(f);
    }
    return (fb[name] = { tex, fbo: fbos[0], fbos, w, h, levels });
  }
  function drawTo(prog, fbo, w, h, setup) {
    gl.useProgram(prog.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    setup(prog.loc);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function pass(prog, out, setup) { drawTo(prog, out ? out.fbo : null, out ? out.w : canvas.width, out ? out.h : canvas.height, setup); }
  function bindTex(unit, tex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }

  // w, h: the source's size. Same-size uploads (video frames) reuse the storage.
  let imgTexW = 0, imgTexH = 0;
  function uploadImage(source, w, h) {
    const fresh = !imgTex || w !== imgTexW || h !== imgTexH;
    if (!imgTex) imgTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, imgTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (fresh) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source); imgTexW = w; imgTexH = h;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      // Mirrored, so a scrolled image continues as its own reflection with no seam.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
    } else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
  }
  function coverFit() {
    const as = W / H, ai = imgW / imgH;
    return as > ai ? [1, ai / as] : [as / ai, 1];
  }

  // ---- Scene cache (lab, verbatim; with the camera fixed it is always "settled") ----
  function viewRect() { const z = cam.z.x, w = W / z, h = H / z; return { x: cam.x.x - w / 2, y: cam.y.x - h / 2, w, h }; }
  const camSettled = () => true;                    // lab: no camera input, so the camera is always at rest
  const sceneLive = () => !!live;                   // lab: scrolling() || mediaPlaying() || ui.live
  function ensureCache(scale) {
    const settled = camSettled();
    const key = [cam.z.x, cam.x.x, cam.y.x].map(v => v.toFixed(3)).join() + `|${canvas.width}x${canvas.height}`;
    let need = sceneStale || !cache;
    if (!need && settled) need = cache.key !== key || cache.scale !== 1;
    else if (!need) {
      const V = viewRect(), R = cache.R, e = 0.5 / cache.cpx;
      need = V.x < R.x - e || V.y < R.y - e || V.x + V.w > R.x + R.w + e || V.y + V.h > R.y + R.h + e || cam.z.x / cache.z > 1.5;
    }
    // A scene that changes every frame (scroll, video, a track under a moving knob) is rebuilt every frame,
    // so it takes the adaptive scale even with the camera still. The first still frame rebuilds it exactly.
    if (need) buildCache(settled && !sceneLive() ? 1 : scale, key);
  }
  function buildCache(scale, key) {
    const z = cam.z.x, V = viewRect();
    const ow = Math.max(1, Math.round(canvas.width * scale)), oh = Math.max(1, Math.round(canvas.height * scale));
    const cpx = ow / W * z, cpy = oh / H * z;
    const maxTex = Math.min(8192, gl.getParameter(gl.MAX_TEXTURE_SIZE));
    const mg = sceneLive() ? 0 : MARGIN;   // a scene that changes every frame is rebuilt every frame, so a margin buys nothing
    const mx = Math.max(0, Math.min(Math.round(ow * mg), Math.floor((maxTex - ow) / 2)));
    const my = Math.max(0, Math.min(Math.round(oh * mg), Math.floor((maxTex - oh) / 2)));
    // Margins stop at the edge of the world, in whole texels so the grid stays aligned.
    const mL = Math.max(0, Math.min(mx, Math.floor(V.x * cpx + 1e-3))), mR = Math.max(0, Math.min(mx, Math.floor((W - V.x - V.w) * cpx + 1e-3)));
    const mT = Math.max(0, Math.min(my, Math.floor(V.y * cpy + 1e-3))), mB = Math.max(0, Math.min(my, Math.floor((H - V.y - V.h) * cpy + 1e-3)));
    const cw = ow + mL + mR, ch = oh + mT + mB;
    const R = { x: V.x - mL / cpx, y: V.y - mT / cpy, w: cw / cpx, h: ch / cpy };
    const scene = rtex('scene', cw, ch, mipLevels(cw, ch));
    pass(progs.cover, scene, loc => {
      bindTex(0, imgTex); gl.uniform1i(loc.u_img, 0);
      const [fx, fy] = coverFit(); gl.uniform4f(loc.u_fit, fx, fy, scroll.x / W * fx, scroll.y / H * fy);
      gl.uniform4f(loc.u_rect, R.x / W, R.y / H, R.w / W, R.h / H);
      gl.uniform1i(loc.u_un, 0); gl.uniform2f(loc.u_world, W, H);   // lab: ui.n; the underlay (iOS control tracks) is left out
    });
    gl.bindTexture(gl.TEXTURE_2D, scene.tex); gl.generateMipmap(gl.TEXTURE_2D);
    buildPyramid(cw, ch);
    cache = { R, cpx, cpy, z, key, scale };
    sceneStale = false;
  }
  // Gaussian pyramid in one texture's mip chain: level i holds the scene blurred to
  // σ = SIGMA0 · 2^i cache texels, at 1 / 2^(i+1) of the cache size. Each level is
  // the one above it blurred a little more (σ 1.3 of its own texels) and halved, so
  // every level costs two tiny passes. Any blur radius is then one textureLod.
  function buildPyramid(cw, ch, src = fb.scene.tex, pn = 'pyr', tn = 'pyrTmp') {
    const bw = Math.max(1, Math.ceil(cw / 2)), bh = Math.max(1, Math.ceil(ch / 2));
    const levels = Math.min(PYR_MAX, mipLevels(bw, bh));
    const P = rtex(pn, bw, bh, levels), T = rtex(tn, bw, bh, levels);
    for (let i = 0; i < levels; i++) {
      const w = Math.max(1, bw >> i), h = Math.max(1, bh >> i), sig = i ? 1.3 : 1.5;
      drawTo(progs.blur, T.fbos[i], w, h, loc => {
        bindTex(0, i ? P.tex : src); gl.uniform1i(loc.u_tex, 0);
        gl.uniform2f(loc.u_step, 1 / w, 0); gl.uniform1f(loc.u_sigma, sig); gl.uniform1f(loc.u_lod, i ? i - 1 : 1);
      });
      drawTo(progs.blur, P.fbos[i], w, h, loc => {
        bindTex(0, T.tex); gl.uniform1i(loc.u_tex, 0);
        gl.uniform2f(loc.u_step, 0, 1 / h); gl.uniform1f(loc.u_sigma, sig); gl.uniform1f(loc.u_lod, i);
      });
    }
    return P;
  }

  // ---- Shapes ----
  function radiusOf(s) {
    const m = Math.min(s.w, s.h) / 2;
    return s.kind === 'rect' ? Math.min(s.r, m) : m;   // capsule and circle: half the short side
  }
  // Live geometry: press swell applied, half sizes in CSS px.
  // lab: knobs (iOS control parts) and velocity stretch are left out, so their factors are 1.
  function geom(s) {
    const k = params.interactive ? 1 : 0;
    const swell = 1 + 0.08 * s.press * k;
    const hx = s.w / 2 * swell, hy = s.h / 2 * swell;
    const r = Math.min(radiusOf(s) * swell, hx, hy);
    return { cx: s.x, cy: s.y, hx, hy, r };
  }
  function toScreen(wx, wy) { const z = cam.z.x; return [(wx - cam.x.x) * z + W / 2, (wy - cam.y.x) * z + H / 2]; }
  function view(g) { const [cx, cy] = toScreen(g.cx, g.cy), z = cam.z.x; return { cx, cy, hx: g.hx * z, hy: g.hy * z, r: g.r * z }; }
  const matOf = s => s && s.mat ? s.mat : params;

  const s0 = new Float32Array(MAX_SHAPES * 4), s1 = new Float32Array(MAX_SHAPES * 4), s2 = new Float32Array(MAX_SHAPES * 4);
  const m0 = new Float32Array(MAX_SHAPES * 4), m1 = new Float32Array(MAX_SHAPES * 4), m2 = new Float32Array(MAX_SHAPES * 4), m3 = new Float32Array(MAX_SHAPES * 4);
  function drawGlass(scale) {
    const vis = shapes, n = vis.length, z = cam.z.x, C = cache;   // lab: tucked split pieces are filtered out here
    const ow = Math.max(1, Math.round(canvas.width * scale)), oh = Math.max(1, Math.round(canvas.height * scale)), sx = ow / W;
    let touch = null;
    for (let i = 0; i < n; i++) {
      const s = vis[i], g = view(geom(s)), m = matOf(s), o = i * 4, rgb = tintRgb(m.tint);
      // Written by index: this runs every frame for every shape, so it builds no arrays.
      s0[o] = g.cx; s0[o + 1] = g.cy; s0[o + 2] = g.hx; s0[o + 3] = g.hy;
      s1[o] = g.r; s1[o + 1] = s.tone; s1[o + 2] = clamp(s.appear, 0, 1.2); s1[o + 3] = m.sizeScale ? clamp(Math.sqrt(Math.min(s.w, s.h) / 62), 0.75, 1.7) : 1;
      m0[o] = m.refraction * z; m0[o + 1] = m.bezel * z; m0[o + 2] = m.magnify; m0[o + 3] = m.dispersion;
      m1[o] = m.blur * C.cpx / SIGMA0; m1[o + 1] = m.frost; m1[o + 2] = m.vibrancy; m1[o + 3] = m.brightness;
      m2[o] = rgb[0]; m2[o + 1] = rgb[1]; m2[o + 2] = rgb[2]; m2[o + 3] = m.tintAmount;
      m3[o] = m.pickup; m3[o + 1] = m.specular; m3[o + 2] = m.rimWidth * z; m3[o + 3] = m.shadow;
      // lab: split pieces (presence, wider merge) and knobs (solid) are left out: presence 1, solid 0.
      s2[o] = m.edge === 'lip' ? 1 : 0; s2[o + 1] = 0; s2[o + 2] = 1; s2[o + 3] = Math.max(params.merge, 0) * z;
      if (s.press > 0 && (!touch || s.press > touch.press)) touch = s;   // lab: the touched shape came from the pointer
    }
    const a = params.lightAngle * Math.PI / 180;   // lab: + lightDrift.x + tilt.x, both left out
    const [tx, ty] = touch ? toScreen(touch.x, touch.y) : toScreen(0, 0);
    const out = scale < 1 ? rtex('out', ow, oh) : null;
    pass(progs.glass, out, L => {
      bindTex(0, fb.scene.tex); gl.uniform1i(L.u_scene, 0);
      bindTex(1, fb.pyr.tex); gl.uniform1i(L.u_blur, 1);
      gl.uniform2f(L.u_res, ow, oh); gl.uniform2f(L.u_dpr, sx, oh / H);
      gl.uniform2f(L.u_texel, 1 / fb.scene.w, 1 / fb.scene.h);
      const R = C.R;
      gl.uniform4f(L.u_map, 1 / (z * R.w), -1 / (z * R.h), (cam.x.x - W / (2 * z) - R.x) / R.w, 1 - (cam.y.x - H / (2 * z) - R.y) / R.h);
      gl.uniform1f(L.u_sceneLod, Math.max(0, Math.log2(C.cpx / (sx * z))));
      gl.uniform1i(L.u_n, n);
      gl.uniform4fv(L.u_s0, s0); gl.uniform4fv(L.u_s1, s1); gl.uniform4fv(L.u_s2, s2);
      gl.uniform4fv(L.u_m0, m0); gl.uniform4fv(L.u_m1, m1); gl.uniform4fv(L.u_m2, m2); gl.uniform4fv(L.u_m3, m3);
      const ts = touch ? touch.press : 0;
      gl.uniform4f(L.u_touch, tx, ty, params.interactive ? clamp(ts, 0, 1.2) : 0, 46 * z);
      gl.uniform1f(L.u_merge, params.merge * z); gl.uniform1f(L.u_zoom, z);
      gl.uniform1f(L.u_dimK, params.dim * smoothstep01((meanLum - 0.12) / 0.25));
      gl.uniform1f(L.u_pickLod, Math.max(0, Math.log2(PICK_SIGMA * C.cpx / SIGMA0)));
      gl.uniform2f(L.u_light, Math.cos(a), Math.sin(a));
    });
    if (out) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, out.fbo); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, ow, oh, 0, 0, canvas.width, canvas.height, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  // ---- Light or dark per shape, measured on a small copy of the image (lab, verbatim) ----
  // The whole image is kept as a small grid of linear luminance. Lookups map world
  // points through the cover fit and the scroll offset (mirrored, like the texture).
  function buildLum() {
    if (!img || !imgW || !imgH) return;
    lumCanvas ||= document.createElement('canvas');
    const k = 160 / Math.max(imgW, imgH), lw = Math.max(1, Math.round(imgW * k)), lh = Math.max(1, Math.round(imgH * k));
    if (lumCanvas.width !== lw || lumCanvas.height !== lh) { lumCanvas.width = lw; lumCanvas.height = lh; }
    const cx = lumCanvas.getContext('2d', { willReadFrequently: true });
    let data;
    try { cx.imageSmoothingQuality = 'high'; cx.drawImage(img, 0, 0, lw, lh); data = cx.getImageData(0, 0, lw, lh).data; } catch (_) { return; }
    if (!lumLin || lumLin.length !== lw * lh) lumLin = new Float32Array(lw * lh);
    lumW = lw; lumH = lh;
    for (let i = 0, j = 0; i < lumLin.length; i++, j += 4) lumLin[i] = 0.2126 * LIN[data[j]] + 0.7152 * LIN[data[j + 1]] + 0.0722 * LIN[data[j + 2]];
    meanLum = lumRect(0, 0, W, H, 24);
  }
  // Mean linear luminance over a world rect (clamped to the stage), from n × n samples.
  function lumRect(x0, y0, x1, y1, n = 10) {
    if (!lumLin) return 0.6;
    x0 = clamp(x0, 0, W); x1 = clamp(x1, 0, W); y0 = clamp(y0, 0, H); y1 = clamp(y1, 0, H);
    const [fx, fy] = coverFit(), ou = scroll.x / W * fx, ov = scroll.y / H * fy;
    let sum = 0;
    for (let j = 0; j < n; j++) {
      const v = mirror1(((y0 + (j + 0.5) / n * (y1 - y0)) / H - 0.5) * fy + 0.5 + ov), row = Math.min(lumH - 1, Math.floor(v * lumH)) * lumW;
      for (let i = 0; i < n; i++) {
        const u = mirror1(((x0 + (i + 0.5) / n * (x1 - x0)) / W - 0.5) * fx + 0.5 + ou);
        sum += lumLin[row + Math.min(lumW - 1, Math.floor(u * lumW))];
      }
    }
    return sum / (n * n);
  }
  function lumUnder(s) {
    const x = s.x, y = s.y;
    return lumRect(x - s.w / 2, y - s.h / 2, x + s.w / 2, y + s.h / 2);
  }
  // Apple: small elements flip with the content; big ones (menus, sidebars) adapt but stay light.
  // lab: the tone is a spring there; here it is set directly (the lab's value at rest). Label ink is left out.
  function measureTones() {
    for (const s of shapes) {
      let t;
      const m = matOf(s);
      if (s.toneOverride != null) t = s.toneOverride;
      else if (m.appearance === 'light') t = 0;
      else if (m.appearance === 'dark') t = 1;
      else {
        const small = Math.min(s.w, s.h) <= 96;
        const L = lumUnder(s);                                  // linear luminance
        const cur = s.tone;                                     // hysteresis, so it doesn't flicker at the threshold
        t = small ? (cur > 0.5 ? (L < 0.22 ? 1 : 0) : (L < 0.14 ? 1 : 0)) : 0;
      }
      s.tone = t;
    }
  }

  // ---- Sources ----
  function maxSide() { return Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE)); }
  function sizeOf(src) {
    if (typeof HTMLVideoElement !== 'undefined' && src instanceof HTMLVideoElement) return [src.videoWidth, src.videoHeight];
    return [src.naturalWidth || src.width || 0, src.naturalHeight || src.height || 0];
  }
  // lab (useSource): redraw through a 2D canvas: caps the size, flattens transparency onto cream.
  function useSource(src) {
    const [sw, sh] = sizeOf(src);
    const k = Math.min(1, maxSide() / Math.max(sw, sh));
    const c = ownImg || document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
    const cx = c.getContext('2d'); cx.fillStyle = '#F4F1E9'; cx.fillRect(0, 0, c.width, c.height); cx.drawImage(src, 0, 0, c.width, c.height);
    ownImg = c; live = null;
    img = c; imgW = c.width; imgH = c.height;
    uploadImage(c, c.width, c.height); sceneStale = true;
    buildLum(); measureTones();
  }
  // lab (uploadVideo): frames bigger than the texture cap go through a scaled 2D canvas.
  let liveScale = null;
  function uploadLive() {
    const el = live.el, [w, h] = sizeOf(el), m = maxSide();
    if (!w || !h) return false;
    let src = el, uw = w, uh = h;
    if (Math.max(w, h) > m) {
      const k = m / Math.max(w, h); uw = Math.round(w * k); uh = Math.round(h * k);
      liveScale ||= document.createElement('canvas');
      if (liveScale.width !== uw || liveScale.height !== uh) { liveScale.width = uw; liveScale.height = uh; }
      liveScale.getContext('2d').drawImage(el, 0, 0, uw, uh); src = liveScale;
    }
    const resized = w !== imgW || h !== imgH;
    img = el; imgW = w; imgH = h;
    uploadImage(src, uw, uh); sceneStale = true;
    // lab: light/dark follows moving content every 500 ms.
    const now = performance.now();
    if (resized || now - lumAt > 500) { lumAt = now; buildLum(); measureTones(); }
    return true;
  }
  function needsUpload() {
    if (!live) return false;
    if (live.video) {
      const v = live.el;
      if (v.readyState < 2 || !v.videoWidth) return false;
      if (v.currentTime === live.lastT && imgTex && img === v) return false;
      live.lastT = v.currentTime; return true;
    }
    return true;
  }

  function setSource(src, opts = {}) {
    if (destroyed) return Promise.reject(new Error('glass-lens: this renderer was destroyed'));
    const gen = ++srcGen;
    if (src == null) { img = null; live = null; imgTex && gl.deleteTexture(imgTex); imgTex = null; imgTexW = imgTexH = 0; lumLin = null; return Promise.resolve(); }
    const isVideo = typeof HTMLVideoElement !== 'undefined' && src instanceof HTMLVideoElement;
    if (isVideo || opts.live) {
      live = { el: src, video: isVideo, lastT: -1 }; lumAt = 0;
      if (!isVideo) uploadLive();
      return Promise.resolve();
    }
    const isImg = typeof HTMLImageElement !== 'undefined' && src instanceof HTMLImageElement;
    const ready = isImg && !(src.complete && src.naturalWidth) ? src.decode() : Promise.resolve();
    return ready.then(() => {
      if (gen !== srcGen || destroyed) return;                 // a later source wins
      const [w, h] = sizeOf(src);
      if (!w || !h) throw new Error('glass-lens: the source has no pixels yet (an image that failed to load, or a zero-size canvas)');
      useSource(src);
    });
  }

  // ---- Public shape and material setters ----
  function toShape(o, i, prev) {
    if (!o || !KINDS.has(o.kind)) throw new TypeError(`glass-lens: shape ${i} needs kind 'rect', 'capsule' or 'circle'`);
    const w = Number(o.w), h = o.kind === 'circle' ? w : Number(o.h);
    if (!(w > 0) || !(h > 0)) throw new TypeError(`glass-lens: shape ${i} needs a positive w${o.kind === 'circle' ? '' : ' and h'}`);
    const p = prev && prev.kind === o.kind ? prev : null;    // keep the measured tone, for the lab's hysteresis
    return {
      kind: o.kind, x: Number(o.x) || 0, y: Number(o.y) || 0, w, h, r: o.r ?? 24,
      appear: o.appear ?? 1, press: o.press ?? 0, tone: p ? p.tone : 0,
      toneOverride: o.tone == null ? null : clamp(Number(o.tone), 0, 1),
      spec: o.material ?? null, mat: null,
    };
  }
  function resolveShapeMats() {
    for (const s of shapes) {
      if (s.spec == null) { s.mat = null; continue; }
      const full = resolveMaterial(s.spec, params);
      // Scene-only keys (dim, lightAngle, merge, interactive) always come from the scene.
      s.mat = Object.fromEntries(MAT_KEYS.map(k => [k, full[k]]));
    }
  }
  function setShapes(list) {
    if (!Array.isArray(list)) throw new TypeError('glass-lens: setShapes takes an array');
    if (list.length > MAX_SHAPES) throw new RangeError(`glass-lens: at most ${MAX_SHAPES} shapes (the shader's limit), got ${list.length}`);
    const prev = shapes;
    shapes = list.map((o, i) => toShape(o, i, prev[i]));
    resolveShapeMats(); measureTones();
  }
  function setMaterial(m) {
    const next = typeof m === 'string' ? resolveMaterial(m) : resolveMaterial(m, params);
    Object.assign(params, next);
    resolveShapeMats(); measureTones();
  }

  // ---- Size ----
  function resize(width, height) {
    if (width != null) sizeOpt.w = width;
    if (height != null) sizeOpt.h = height;
    let w = sizeOpt.w, h = sizeOpt.h;
    if (w == null || h == null) {
      const r = canvas.getBoundingClientRect();
      w ??= r.width; h ??= r.height;
    }
    W = Math.max(1, w); H = Math.max(1, h);
    if (sizeOpt.w != null) canvas.style.width = W + 'px';
    if (sizeOpt.h != null) canvas.style.height = H + 'px';
    dpr = dprOpt ?? Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);
    const cw = Math.round(W * dpr), ch = Math.round(H * dpr);
    if (cw !== canvas.width || ch !== canvas.height) { canvas.width = cw; canvas.height = ch; }
    cam.x.x = W / 2; cam.y.x = H / 2;
    sceneStale = true;
    buildLum(); measureTones();
  }

  function render() {
    if (destroyed || lost || !progs) return false;
    if (needsUpload()) uploadLive();
    if (!imgTex) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); return false; }
    ensureCache(1);       // lab: the adaptive render scale is left out; every frame is full resolution
    drawGlass(1);
    return true;
  }

  function toBlob(type = 'image/png', quality) {
    // The drawing buffer isn't preserved, so render and read it in the same task (as the lab's Save PNG does).
    return new Promise((resolve, reject) => {
      if (!render()) return reject(new Error('glass-lens: nothing to save yet (no source, or the context is lost)'));
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('glass-lens: the browser could not encode the image')), type, quality);
    });
  }

  function freeGL() {
    if (gl.isContextLost()) return;
    for (const t of Object.values(fb)) { gl.deleteTexture(t.tex); t.fbos.forEach(f => gl.deleteFramebuffer(f)); }
    if (imgTex) gl.deleteTexture(imgTex);
    if (progs) for (const P of Object.values(progs)) gl.deleteProgram(P.p);
    if (quad) gl.deleteBuffer(quad);
  }
  const onLost = e => { e.preventDefault(); lost = true; };
  const onRestored = () => {
    lost = false; fb = {}; cache = null; imgTex = null; imgTexW = imgTexH = 0; sceneStale = true;
    initGL();
    if (live) { live.lastT = -1; } else if (img) uploadImage(img, imgW, imgH);
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  function destroy() {
    if (destroyed) return;
    destroyed = true; srcGen++;
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
    freeGL();
    // The context itself is left alive: getContext returns it again for the same canvas,
    // so a new createGlass on this canvas (React StrictMode remounts) works.
    fb = {}; progs = null; quad = null; imgTex = null; img = null; ownImg = null; live = null; shapes = [];
  }

  // ---- Boot ----
  initGL();
  resize();
  if (options.material != null) setMaterial(options.material);
  if (options.shapes) setShapes(options.shapes);
  const ready = options.source != null ? setSource(options.source) : Promise.resolve();
  ready.catch(() => {});   // surfaced through glass.ready

  return {
    canvas,
    ready,
    setSource,
    setShapes,
    setMaterial,
    getMaterial: () => ({ ...params }),
    resize,
    render,
    toBlob,
    destroy,
    /** Read-only state, for tests and debugging. */
    get info() {
      return { width: W, height: H, dpr, canvas: [canvas.width, canvas.height], meanLum, lost, destroyed,
        tones: shapes.map(s => s.tone), source: img ? [imgW, imgH] : null, live: !!live };
    },
  };
}

export { PARAMS, PRESETS, SCENE_KEYS, MAT_KEYS, DEF, MAX_SHAPES };
