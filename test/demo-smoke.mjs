// Opens the demo in headless Chrome: it renders, the card drags on its spring, Save PNG works,
// a picked image file replaces the background, and a video source (recorded in the page) plays.
//   npm run check:demo           (SHOT=path.png also saves a screenshot of the stage)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
function browserTools() {
  const helper = join(homedir(), '.claude/scripts/lib/agent-chrome.js');
  if (existsSync(helper)) { const { chromePath, loadPuppeteer, closeBrowser } = require(helper); return { executablePath: chromePath(), puppeteer: loadPuppeteer(), close: closeBrowser }; }
  if (!process.env.CHROME_PATH) throw new Error('Set CHROME_PATH to an installed Chrome, and install puppeteer-core.');
  return { executablePath: process.env.CHROME_PATH, puppeteer: require('puppeteer-core'), close: b => b.close() };
}
const child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/serve.mjs', import.meta.url)), '--port', '0'], { stdio: ['ignore', 'pipe', 'inherit'] });
const base = await new Promise((res, rej) => { child.stdout.on('data', d => { const m = /listening (\S+)/.exec(String(d)); if (m) res(m[1]); }); setTimeout(() => rej(new Error('no server')), 5000); });
const { executablePath, puppeteer, close } = browserTools();
const browser = await puppeteer.launch({ headless: true, executablePath });
const tmp = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'glass-demo-'));
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' (' + extra + ')' : ''}`); if (!ok) failed++; };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 900, deviceScaleFactor: 2 });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.setRequestInterception(true);
  page.on('request', r => r.url().startsWith(base) || /^(data|blob):/.test(r.url()) ? r.continue() : r.abort());
  await page.goto(`${base}/demo/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.demo && window.demo.glass.info.source, { timeout: 10000 });
  const sig = () => page.evaluate(() => { const c = document.getElementById('glass'), g = c.getContext('webgl2'); window.demo.glass.render(); const px = new Uint8Array(4 * 64); g.readPixels(c.width >> 1, c.height >> 1, 64, 1, g.RGBA, g.UNSIGNED_BYTE, px); return Array.from(px).join(); });
  const info = await page.evaluate(() => window.demo.glass.info);
  check('demo renders a live canvas source', info.live && info.canvas[0] > 0, `canvas ${info.canvas.join('×')}`);
  const a = await sig(); await new Promise(r => setTimeout(r, 600)); const b = await sig();
  check('the background moves', a !== b);

  const box = await page.evaluate(() => { const r = document.getElementById('glass').getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; });
  const c0 = await page.evaluate(() => [window.demo.card.x.x, window.demo.card.y.x]);
  await page.mouse.move(box.x + c0[0], box.y + c0[1]); await page.mouse.down();
  await page.mouse.move(box.x + c0[0] - 150, box.y + c0[1] + 60, { steps: 8 }); await page.mouse.up();
  await new Promise(r => setTimeout(r, 1500));
  const c1 = await page.evaluate(() => [window.demo.card.x.x, window.demo.card.y.x]);
  check('dragging moves the card on its spring', Math.abs(c1[0] - (c0[0] - 150)) < 2 && Math.abs(c1[1] - (c0[1] + 60)) < 2, `${c0.map(Math.round)} -> ${c1.map(Math.round)}`);

  if (process.env.SHOT) { await page.screenshot({ path: process.env.SHOT, clip: { x: box.x, y: box.y, width: box.w, height: box.h } }); console.log('screenshot ' + process.env.SHOT); }

  const png = await page.evaluate(async () => { const b = await window.demo.glass.toBlob(); const u = new Uint8Array(await b.arrayBuffer()); return { type: b.type, size: b.size, sig: Array.from(u.slice(0, 4)) }; });
  check('Save PNG (toBlob) gives a PNG', png.type === 'image/png' && png.sig.join() === '137,80,78,71', `${png.size} bytes`);

  // A picked image file.
  const dataUrl = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 400; c.height = 300; const x = c.getContext('2d'); x.fillStyle = '#123456'; x.fillRect(0, 0, 400, 300); x.fillStyle = '#fedcba'; x.fillRect(100, 50, 200, 200); return c.toDataURL('image/png'); });
  const file = join(tmp, 'pick.png'); writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  const input = await page.$('#file'); await input.uploadFile(file);
  await page.waitForFunction(() => { const s = window.demo.glass.info.source; return s && s[0] === 400; }, { timeout: 5000 });
  const i2 = await page.evaluate(() => window.demo.glass.info);
  check('a picked image becomes the source', !i2.live && i2.source.join() === '400,300');

  // A video source: recorded in the page from a moving canvas, then played.
  const vid = await page.evaluate(async () => {
    if (!window.MediaRecorder) return { skipped: 'no MediaRecorder' };
    const c = document.createElement('canvas'); c.width = 320; c.height = 240; const x = c.getContext('2d');
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm' }); const parts = [];
    rec.ondataavailable = e => parts.push(e.data);
    let f = 0; const id = setInterval(() => { x.fillStyle = `hsl(${f * 12},70%,50%)`; x.fillRect(0, 0, 320, 240); x.fillStyle = '#fff'; x.fillRect((f * 9) % 320, 80, 40, 80); f++; }, 33);
    rec.start(); await new Promise(r => setTimeout(r, 1500)); rec.stop(); clearInterval(id);
    await new Promise(r => { rec.onstop = r; });
    const v = document.createElement('video'); v.muted = true; v.loop = true; v.playsInline = true; v.src = URL.createObjectURL(new Blob(parts, { type: 'video/webm' }));
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = rej; });
    await v.play();
    const g = window.demo.glass; await g.setSource(v);
    const cv = g.canvas, gl = cv.getContext('webgl2');
    const grab = () => { g.render(); const p = new Uint8Array(4 * 32); gl.readPixels(0, cv.height >> 1, 32, 1, gl.RGBA, gl.UNSIGNED_BYTE, p); return Array.from(p).join(); };
    const s1 = grab(); await new Promise(r => setTimeout(r, 500)); const s2 = grab();
    return { live: g.info.live, source: g.info.source, changed: s1 !== s2 };
  });
  if (vid.skipped) console.log('skip video: ' + vid.skipped);
  else check('a playing video source updates the frame', vid.live && vid.source.join() === '320,240' && vid.changed);
  // The README's quick start: an <img> still loading is awaited; then an OffscreenCanvas source.
  const qs = await page.evaluate(async () => {
    const { createGlass } = await import('/src/index.js');
    const c = document.createElement('canvas'); c.style.cssText = 'width:600px;height:400px;position:fixed;left:0;top:0;opacity:0'; document.body.appendChild(c);
    const glass = createGlass(c);
    const d = document.createElement('canvas'); d.width = 640; d.height = 480; const x = d.getContext('2d'); x.fillStyle = '#204060'; x.fillRect(0, 0, 640, 480);
    const img = new Image(); img.src = d.toDataURL('image/png');
    const completeBefore = img.complete && img.naturalWidth > 0;
    await glass.setSource(img);
    glass.setShapes([{ kind: 'rect', x: 300, y: 200, w: 320, h: 200, r: 34 }, { kind: 'capsule', x: 300, y: 360, w: 220, h: 58 }, { kind: 'circle', x: 460, y: 360, w: 58 }]);
    glass.setMaterial('apple');
    const drew = glass.render(), imgSrc = glass.info.source.join();
    const off = new OffscreenCanvas(300, 200); const ox = off.getContext('2d'); ox.fillStyle = '#e8593c'; ox.fillRect(0, 0, 300, 200);
    await glass.setSource(off); const offDrew = glass.render(), offSrc = glass.info.source.join();
    glass.destroy(); c.remove();
    return { completeBefore, drew, imgSrc, offDrew, offSrc };
  });
  check('quick start: a loading <img> is awaited and drawn', !qs.completeBefore && qs.drew && qs.imgSrc === '640,480');
  check('an OffscreenCanvas source draws', qs.offDrew && qs.offSrc === '300,200');
  check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
  await close(browser); child.kill(); rmSync(tmp, { recursive: true, force: true });
}
if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('demo smoke test passed');
