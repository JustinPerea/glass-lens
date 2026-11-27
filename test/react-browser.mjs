// Mounts <GlassCanvas> in headless Chrome under React 18 StrictMode (which mounts, unmounts and
// mounts again on one canvas), then checks it draws, takes new props, and hands out the instance.
//   npm run check:react        (installs react@18.3.1 and react-dom@18.3.1 into a temp directory)
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
const tmp = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'glass-react-'));
writeFileSync(join(tmp, 'package.json'), '{"private":true}');
execFileSync('npm', ['install', '--no-audit', '--no-fund', 'react@18.3.1', 'react-dom@18.3.1'], { cwd: tmp, stdio: 'ignore' });
const child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/serve.mjs', import.meta.url)), '--port', '0', '--mount', `/vendor=${join(tmp, 'node_modules')}`], { stdio: ['ignore', 'pipe', 'inherit'] });
const base = await new Promise((res, rej) => { child.stdout.on('data', d => { const m = /listening (\S+)/.exec(String(d)); if (m) res(m[1]); }); setTimeout(() => rej(new Error('no server')), 5000); });
const { executablePath, puppeteer, close } = browserTools();
const browser = await puppeteer.launch({ headless: true, executablePath });
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' (' + extra + ')' : ''}`); if (!ok) failed++; };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 700, deviceScaleFactor: 2 });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warn') && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('response', res => { if (res.status() >= 400 && !res.url().endsWith('/favicon.ico')) errors.push(`${res.status()} ${res.url()}`); });
  await page.goto(`${base}/test/react.html`, { waitUntil: 'load' });
  const r = await page.evaluate(async () => {
    const { GlassCanvas } = await import('/src/react.js');
    const { drawFixture } = await import('/test/fixture.js');
    const { createElement: h, StrictMode, createRef } = window.React;
    const src = drawFixture(800, 500), ref = createRef(), errs = [];
    const shapes1 = [{ kind: 'rect', x: 300, y: 200, w: 260, h: 160, r: 30 }];
    const root = window.ReactDOM.createRoot(document.getElementById('root'));
    const draw = (shapes, material) => root.render(h(StrictMode, null, h(GlassCanvas, { ref, source: src, shapes, material, style: { width: 600, height: 400, display: 'block' }, onError: e => errs.push(String(e)) })));
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const sig = () => { const g = ref.current; g.render(); const c = g.canvas, gl = c.getContext('webgl2'); const p = new Uint8Array(4 * 400); gl.readPixels(300, c.height - 400, 400, 1, gl.RGBA, gl.UNSIGNED_BYTE, p); return Array.from(p).join(); };
    draw(shapes1, 'apple'); await wait(300);
    const canvases = document.querySelectorAll('canvas').length;
    const info1 = ref.current && ref.current.info;
    const s1 = sig();
    draw([{ kind: 'circle', x: 200, y: 200, w: 120 }], 'prism'); await wait(200);
    const s2 = sig(), mat = ref.current.getMaterial().dispersion;
    const blob = await ref.current.toBlob();
    root.unmount(); await wait(50);
    return { canvases, info1, changed: s1 !== s2, mat, png: blob.type, errs, after: ref.current };
  });
  check('one canvas after StrictMode double mount', r.canvases === 1);
  check('ref is the glass instance with a source and one shape', !!r.info1 && r.info1.source && r.info1.tones.length === 1, r.info1 && `canvas ${r.info1.canvas.join('×')}`);
  check('new shapes and material props redraw', r.changed && r.mat === 0.85);
  check('toBlob through the ref', r.png === 'image/png');
  check('unmount clears the ref', r.after === null);
  check('no errors', !r.errs.length && !errors.length, [...r.errs, ...errors].join(' | '));
} finally {
  await close(browser); child.kill(); rmSync(tmp, { recursive: true, force: true });
}
if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('react browser check passed');
