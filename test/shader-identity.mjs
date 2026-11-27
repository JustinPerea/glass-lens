// Checks that the shaders, their constants and the material PARAMS / PRESETS are the lab's, byte for byte.
//
//   node test/shader-identity.mjs                 compares the package with test/lab-reference.json
//   LAB_HTML=/path/to/lab/index.html node test/shader-identity.mjs
//                                                 also compares directly with the lab page
//   LAB_HTML=... node test/shader-identity.mjs --write-reference
//                                                 records the lab's hashes (run once, from the lab page)
//
// The lab page isn't in this repo; the reference file holds its hashes (see README, "Verifying").
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { parts, hashes, sha256, SHADERS, OMITTED } from './extract.mjs';
import * as shaders from '../src/shaders.js';
import { PARAMS, PRESETS } from '../src/params.js';

const root = new URL('..', import.meta.url);
const refPath = fileURLToPath(new URL('test/lab-reference.json', root));
const pkgSrc = ['src/shaders.js', 'src/params.js'].map(f => readFileSync(new URL(f, root), 'utf8')).join('\n');
const pkg = parts(pkgSrc);
let failed = 0;
const fail = msg => { failed++; console.error('FAIL ' + msg); };
const ok = msg => console.log('ok   ' + msg);

function firstDiff(a, b) {
  const A = a.split('\n'), B = b.split('\n');
  for (let i = 0; i < Math.max(A.length, B.length); i++) if (A[i] !== B[i]) return `line ${i + 1}:\n  lab:     ${A[i]}\n  package: ${B[i]}`;
  return 'no line differs (whitespace at the end?)';
}

const labPath = process.env.LAB_HTML;
if (process.argv.includes('--write-reference')) {
  if (!labPath) { console.error('--write-reference needs LAB_HTML'); process.exit(2); }
  const html = readFileSync(labPath, 'utf8');
  const ref = { source: 'Lab 03 "Liquid glass", good-machines commit 4686091, site/lab/liquid-glass/index.html', fileSha256: sha256(html), lines: html.split('\n').length, omitted: OMITTED, ...hashes(parts(html)) };
  writeFileSync(refPath, JSON.stringify(ref, null, 2) + '\n');
  console.log('wrote ' + refPath);
  process.exit(0);
}

// 1. Against the recorded lab hashes.
const ref = JSON.parse(readFileSync(refPath, 'utf8'));
const got = hashes(pkg);
if (isDeepStrictEqual(got.constants, ref.constants)) ok(`constants ${JSON.stringify(got.constants)}`); else fail(`constants ${JSON.stringify(got.constants)} != lab ${JSON.stringify(ref.constants)}`);
for (const k of ['raw', 'compiled', 'data']) for (const n of Object.keys(ref[k])) {
  if (got[k][n] === ref[k][n]) ok(`${k} ${n} matches the lab (sha256 ${got[k][n].slice(0, 12)})`);
  else fail(`${k} ${n} differs from the lab`);
}

// 2. What the modules export is what their source text says (nothing rewrites it at load).
for (const n of SHADERS) if (shaders[n] !== pkg.compiled[n]) fail(`exported ${n} != its source text`); else ok(`exported ${n} is the compiled source text`);
const evalArr = txt => Function(`"use strict"; return (${txt});`)();
if (isDeepStrictEqual(PARAMS, evalArr(pkg.data.PARAMS)) && isDeepStrictEqual(PRESETS, evalArr(pkg.data.PRESETS))) ok('exported PARAMS and PRESETS equal their source text');
else fail('exported PARAMS / PRESETS differ from their source text');

// 3. Directly against the lab page, when it's available.
if (labPath) {
  const html = readFileSync(labPath, 'utf8');
  if (sha256(html) === ref.fileSha256) ok(`lab page ${labPath} is the recorded file`); else fail(`lab page hash ${sha256(html)} isn't the recorded ${ref.fileSha256}`);
  const lab = parts(html);
  for (const k of ['raw', 'compiled', 'data']) for (const n of Object.keys(lab[k])) {
    if (lab[k][n] === pkg[k][n]) ok(`${k} ${n} identical to the lab page (${lab[k][n].length} chars)`);
    else fail(`${k} ${n} differs from the lab page, ${firstDiff(lab[k][n], pkg[k][n])}`);
  }
  for (const n of Object.keys(OMITTED)) {
    if (!html.includes(`const ${n} = \``)) fail(`expected the lab to have ${n}`);
  }
} else console.log('note LAB_HTML not set: compared with the recorded hashes only');

for (const [n, why] of Object.entries(OMITTED)) console.log(`omit ${n}: ${why}`);
if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('shader identity: all checks passed');
