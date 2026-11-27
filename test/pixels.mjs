// Renders one fixed scene in the original lab page and in this package, in headless Chrome,
// and diffs the pixels. Both renderers run in the lab's page (the package is imported there),
// so they share one browser, one GPU path and one devicePixelRatio. The package is also rendered
// in a blank page, to show the lab page around it changes nothing.
//
//   LAB_HTML=/path/to/lab/index.html npm run check:pixels
//
// Chrome: the installed Google Chrome with its sandbox on. On Justin's machine this goes through
// ~/.claude/scripts/lib/agent-chrome.js; elsewhere set CHROME_PATH and install puppeteer-core.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const labHtml = process.env.LAB_HTML;
if (!labHtml || !existsSync(labHtml)) {
  console.error('check:pixels needs LAB_HTML, the path to the lab page (Lab 03 "Liquid glass", good-machines commit 4686091, site/lab/liquid-glass/index.html).');
  process.exit(2);
}

function browserTools() {
  const helper = join(homedir(), '.claude/scripts/lib/agent-chrome.js');
  if (existsSync(helper)) {
    const { chromePath, loadPuppeteer, closeBrowser } = require(helper);
    return { executablePath: chromePath(), puppeteer: loadPuppeteer(), close: closeBrowser };
  }
  if (!process.env.CHROME_PATH) throw new Error('Set CHROME_PATH to an installed Chrome, and install puppeteer-core.');
  return { executablePath: process.env.CHROME_PATH, puppeteer: require('puppeteer-core'), close: b => b.close() };
}

function startServer() {
  const script = fileURLToPath(new URL('../scripts/serve.mjs', import.meta.url));
  const child = spawn(process.execPath, [script, '--port', '0', '--mount', `/lab=${dirname(labHtml)}`], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.stdout.on('data', d => { const m = /listening (\S+)/.exec(String(d)); if (m) resolve({ child, base: m[1] }); });
    setTimeout(() => reject(new Error('server did not start')), 5000);
  });
}

// Shapes as fractions of the stage (the lab's links store x and y this way), sizes in CSS px.
// The card and the capsule sit 8 px apart, inside every preset's merge distance; the circle
// is small (≤ 96 px) and over the dark block, so it turns dark; the top capsule stays light.
const SHAPES = [
  { k: 'rect', fx: 0.34, fy: 0.4, w: 300, h: 180, r: 34 },
  { k: 'capsule', gapAfter: 0, w: 120, h: 56 },
  { k: 'circle', fx: 0.84, fy: 0.8, w: 64 },
  { k: 'capsule', fx: 0.2, fy: 0.14, w: 130, h: 52 },
];
const SCENES = [
  { name: 'apple, DPR 2', dpr: 2, material: 'apple' },
  { name: 'apple, DPR 1', dpr: 1, material: 'apple' },
  { name: 'thick, DPR 2', dpr: 2, material: 'thick' },
  { name: 'frosted with the Lip edge, DPR 2', dpr: 2, material: { preset: 'frosted', edge: 'lip' } },
  { name: 'prism, DPR 2', dpr: 2, material: 'prism' },
  { name: 'apple, DPR 1.5, odd viewport', dpr: 1.5, material: 'apple', viewport: [1111, 777] },
];

// Runs in the page. Helpers are defined inside so puppeteer can serialize them.
async function inLab({ material, shapes }) {
  const read = cv => { const g = cv.getContext('webgl2'), px = new Uint8Array(cv.width * cv.height * 4); g.bindFramebuffer(g.FRAMEBUFFER, null); g.readPixels(0, 0, cv.width, cv.height, g.RGBA, g.UNSIGNED_BYTE, px); return px; };
  const hex = async px => [...new Uint8Array(await crypto.subtle.digest('SHA-256', px))].map(b => b.toString(16).padStart(2, '0')).join('');
  const { drawFixture } = await import('/test/fixture.js');
  const G = await import('/src/index.js');
  const lab = window.glassLab;
  if (!lab) throw new Error('the lab page has no window.glassLab');
  if (!lab.previews.visual) throw new Error('the lab is running its CSS fallback, not WebGL2');
  const blob = await new Promise(r => drawFixture().toBlob(r, 'image/png'));
  await lab.loadFile(new File([blob], 'fixture.png', { type: 'image/png' }));
  if (lab.anim || lab.video) throw new Error('the fixture loaded as an animation or video');
  const { W, H } = lab.frame;
  // The capsule's x: 8 px right of the card, as a fraction rounded to 4 places like the lab's links.
  const r4 = v => Math.round(v * 1e4) / 1e4;
  const S = shapes.map(o => ({ ...o }));
  S[1].fx = r4((S[0].fx * W + S[0].w / 2 + 8 + S[1].w / 2) / W); S[1].fy = S[0].fy;
  const p = G.resolveMaterial(material);
  const snap = lab.snapshot();
  snap.m = { preset: typeof material === 'string' ? material : material.preset, edited: typeof material !== 'string', p };
  snap.s = S.map((o, i) => ({ id: 9001 + i, k: o.k, x: o.fx, y: o.fy, w: o.w, h: o.k === 'circle' ? o.w : o.h, r: o.r ?? 24, l: null, m: null, ro: null }));
  snap.l = 'empty'; snap.sel = -1; snap.d = null;
  lab.restore(snap, { animate: false, view: false });
  lab.resetView();
  lab.advance(10);
  const geom = lab.geom;
  if (geom.some(g => g.appear !== 1 || g.press !== 0)) throw new Error('lab glass not settled: ' + JSON.stringify(geom.map(g => [g.appear, g.press])));
  const labTones = lab.shapes.map(s => s.tone.x), labMean = lab.meanLum, labFrame = lab.frame, auto = p.appearance === 'auto';

  const cv = document.createElement('canvas');
  cv.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none';
  document.body.appendChild(cv);
  const glass = G.createGlass(cv, { width: W, height: H, material });
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  await glass.setSource(bmp); bmp.close();
  const pkgShapes = S.map(o => ({ kind: o.k, x: o.fx * W, y: o.fy * H, w: o.w, h: o.k === 'circle' ? o.w : o.h, r: o.r ?? 24 }));
  glass.setShapes(pkgShapes);

  // The lab renders (advance(0) steps nothing, then draws), and both are read in this task.
  lab.advance(0);
  const A = read(document.getElementById('gl'));
  glass.render();
  const B = read(cv);
  glass.setShapes([]); glass.render();
  const Z = read(cv);                                  // no glass, for the blank-frame guard
  // Negative control: half a pixel more refraction must show up in the diff.
  glass.setShapes(pkgShapes); glass.setMaterial({ refraction: p.refraction + 0.5 }); glass.render();
  const N = read(cv);
  let controlPx = 0;
  for (let i = 0; i < A.length; i += 4) if (A[i] !== N[i] || A[i + 1] !== N[i + 1] || A[i + 2] !== N[i + 2]) controlPx++;

  let max = 0, sum = 0, diffPx = 0, over1 = 0, glassPx = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  const colors = new Set();
  const w = cv.width;
  for (let i = 0; i < A.length; i += 4) {
    let m = 0;
    for (let c = 0; c < 3; c++) { const d = Math.abs(A[i + c] - B[i + c]); sum += d; if (d > m) m = d; }
    if (m > max) max = m;
    if (m) { diffPx++; const px = i / 4, x = px % w, y = (px - x) / w; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (m > 1) over1++;
    if (A[i] !== Z[i] || A[i + 1] !== Z[i + 1] || A[i + 2] !== Z[i + 2]) glassPx++;
    if (colors.size < 5000 && (i & 63) === 0) colors.add((A[i] << 16) | (A[i + 1] << 8) | A[i + 2]);
  }
  const n = A.length / 4;
  const out = {
    W, H, auto, canvas: [cv.width, cv.height], labCanvas: labFrame.canvas, dpr: devicePixelRatio,
    tones: { lab: labTones, pkg: glass.info.tones }, meanLum: { lab: labMean, pkg: glass.info.meanLum },
    maxChannelDiff: max, meanChannelDiff: sum / (n * 3), differingPixelShare: diffPx / n, over1Share: over1 / n,
    diffBox: diffPx ? [x0, y0, x1, y1] : null, controlShare: controlPx / n, glassChangedShare: glassPx / n, sampledColours: colors.size,
    labHash: await hex(A), pkgHash: await hex(B), shapes: pkgShapes,
  };
  glass.destroy(); cv.remove();
  return out;
}

// The package alone in a blank page, plus create → destroy → create on one canvas and a lost and restored context.
async function inBlank({ material, shapes, W, H }) {
  const read = cv => { const g = cv.getContext('webgl2'), px = new Uint8Array(cv.width * cv.height * 4); g.bindFramebuffer(g.FRAMEBUFFER, null); g.readPixels(0, 0, cv.width, cv.height, g.RGBA, g.UNSIGNED_BYTE, px); return px; };
  const hex = async px => [...new Uint8Array(await crypto.subtle.digest('SHA-256', px))].map(b => b.toString(16).padStart(2, '0')).join('');
  const { drawFixture } = await import('/test/fixture.js');
  const G = await import('/src/index.js');
  const blob = await new Promise(r => drawFixture().toBlob(r, 'image/png'));
  const cv = document.createElement('canvas'); document.body.appendChild(cv);
  const make = async () => {
    const g = G.createGlass(cv, { width: W, height: H, material, shapes });
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' }); await g.setSource(bmp); bmp.close();
    return g;
  };
  let g = await make(); g.render(); const first = await hex(read(cv));
  g.destroy(); g = await make(); g.render(); const remount = await hex(read(cv));
  const ext = cv.getContext('webgl2').getExtension('WEBGL_lose_context');
  let restored = null;
  if (ext) {
    ext.loseContext(); await new Promise(r => setTimeout(r, 50));
    const whileLost = g.render();
    ext.restoreContext(); await new Promise(r => setTimeout(r, 200));
    g.render(); restored = { whileLost, hash: await hex(read(cv)) };
  }
  const png = await g.toBlob();
  g.destroy();
  return { first, remount, restored, png: { type: png.type, size: png.size } };
}

const { child, base } = await startServer();
console.log(`server pid ${child.pid} at ${base}`);
const { executablePath, puppeteer, close } = browserTools();
const browser = await puppeteer.launch({ headless: true, executablePath });
let failed = 0;
const results = [];
try {
  console.log(`browser: ${await browser.version()}`);
  for (const sc of SCENES) {
    const page = await browser.newPage();
    await page.setViewport({ width: sc.viewport?.[0] ?? 1280, height: sc.viewport?.[1] ?? 800, deviceScaleFactor: sc.dpr });
    let blocked = 0;
    await page.setRequestInterception(true);
    page.on('request', r => { const u = r.url(); if (u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:')) r.continue(); else { blocked++; r.abort(); } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(`${base}/lab/${labHtml.split('/').pop()}`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.glassLab, { timeout: 15000 });
    const r = await page.evaluate(inLab, { material: sc.material, shapes: SHAPES });
    const page2 = await browser.newPage();
    await page2.setViewport({ width: sc.viewport?.[0] ?? 1280, height: sc.viewport?.[1] ?? 800, deviceScaleFactor: sc.dpr });
    await page2.goto(`${base}/test/blank.html`, { waitUntil: 'load' });
    const b = await page2.evaluate(inBlank, { material: sc.material, shapes: r.shapes, W: r.W, H: r.H });
    await page.close(); await page2.close();

    const checks = [
      ['lab and package canvas sizes match', r.canvas.join() === r.labCanvas.join()],
      ['tones match', r.tones.lab.join() === r.tones.pkg.join()],
      ['scene has a dark and a light shape (presets with appearance auto)', !r.auto || (r.tones.pkg.includes(1) && r.tones.pkg.includes(0))],
      ['meanLum matches', r.meanLum.lab === r.meanLum.pkg],
      ['frame is not blank', r.sampledColours > 500],
      ['glass changes the frame', r.glassChangedShare > 0.02],
      ['negative control (refraction + 0.5 px) is caught', r.controlShare > 0.001],
      ['package in a blank page renders the same pixels', b.first === r.pkgHash],
      ['destroy then create on the same canvas renders the same pixels', b.remount === r.pkgHash],
      ['a lost and restored context renders the same pixels', !b.restored || (b.restored.whileLost === false && b.restored.hash === r.pkgHash)],
      ['toBlob gives a PNG', b.png.type === 'image/png' && b.png.size > 1000],
    ];
    const line = `${sc.name}: ${r.W}×${r.H} CSS px, canvas ${r.canvas.join('×')}, max channel diff ${r.maxChannelDiff}, mean ${r.meanChannelDiff.toExponential(3)}, differing pixels ${(r.differingPixelShare * 100).toFixed(4)}%` +
      (r.diffBox ? ` in box ${r.diffBox.join(',')}` : '') + `; glass changes ${(r.glassChangedShare * 100).toFixed(1)}% of the frame; +0.5 px refraction changes ${(r.controlShare * 100).toFixed(2)}%; tones ${r.tones.pkg.join(',')}; outside requests blocked ${blocked}`;
    console.log(line);
    if (errors.length) console.log('  page errors (lab page, expected: blocked fonts and samples): ' + errors.slice(0, 3).join(' | '));
    if (!b.restored) console.log('  note: WEBGL_lose_context missing; context restore not tested');
    for (const [name, pass] of checks) { if (!pass) { failed++; console.log(`  FAIL ${name}`); } }
    if (r.maxChannelDiff !== 0) { failed++; console.log('  FAIL pixels differ from the lab'); }
    results.push({ scene: sc.name, ...r, shapes: undefined, blank: b });
  }
} finally {
  await close(browser);
  child.kill();
  console.log(`stopped server pid ${child.pid}`);
}
if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('pixel check: the package renders the same pixels as the lab in every scene');
