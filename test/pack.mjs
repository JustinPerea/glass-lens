// Packs the module, installs the tarball into a fresh directory with React, and imports both
// entry points the way the README says to. Uses the registry for react and react-dom only.
//   npm run check:pack          (the temp directory is made under $TMPDIR and removed after)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'glass-pack-'));
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
try {
  const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', dir], root))[0];
  console.log(`packed ${packed.filename}: ${packed.files.length} files, ${packed.size} bytes`);
  for (const f of packed.files) console.log('  ' + f.path);
  const app = join(dir, 'app');
  run('mkdir', ['-p', app], dir);
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'pack-check', private: true, type: 'module' }));
  run('npm', ['install', '--no-audit', '--no-fund', join(dir, packed.filename), 'react@18.3.1', 'react-dom@18.3.1'], app);
  writeFileSync(join(app, 'check.mjs'), `
import * as core from 'glass-lens';
import { GlassCanvas } from 'glass-lens/react';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
const want = ['createGlass', 'isSupported', 'resolveMaterial', 'PARAMS', 'PRESETS', 'Spring', 'SPRINGS'];
for (const k of want) if (!(k in core)) throw new Error('core is missing ' + k);
if (core.PRESETS[0].id !== 'apple') throw new Error('first preset is not apple');
const html = renderToString(createElement(GlassCanvas, { className: 'g', shapes: [], 'aria-label': 'glass' }));
if (!/^<canvas class="g" aria-label="glass"><\\/canvas>$/.test(html)) throw new Error('unexpected server render: ' + html);
console.log('core exports: ' + Object.keys(core).join(', '));
console.log('react: GlassCanvas server-renders ' + html);
`);
  process.stdout.write(run('node', ['check.mjs'], app));
  console.log('installed packages: ' + readdirSync(join(app, 'node_modules')).join(', '));
  console.log('pack check passed');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
