// Pulls the renderer's verbatim parts out of a source file (the lab page or this package's
// src/*.js) as text, so they can be compared byte for byte.
import { createHash } from 'node:crypto';

export const SHADERS = ['VERT', 'COVER', 'BLUR', 'GLASS'];
// In the lab, not in the package, on purpose: they draw the WebGL labels and the compare overlay.
export const OMITTED = { LABEL_VERT: 'labels (icons and text on the glass) are left out', LABEL: 'labels are left out', REF: 'the compare tool is left out' };

export const sha256 = s => createHash('sha256').update(s, 'utf8').digest('hex');

// The raw template literal of `const NAME = \`...\`;` (before ${} interpolation).
export function template(src, name) {
  const m = new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`).exec(src);
  if (!m) throw new Error(`no template literal "${name}" found`);
  return m[1];
}
export function constant(src, name) {
  const m = new RegExp(`const ${name} = (\\d+);`).exec(src);
  if (!m) throw new Error(`no numeric constant "${name}" found`);
  return Number(m[1]);
}
// An array literal `const NAME = [ ... ];` that ends with a line holding only `];`.
export function arrayLiteral(src, name) {
  const m = new RegExp(`const ${name} = (\\[[\\s\\S]*?\\n\\];)`).exec(src);
  if (!m) throw new Error(`no array literal "${name}" found`);
  return m[1].slice(0, -1);
}
export function interpolate(raw, consts) {
  return raw.replace(/\$\{(\w+)\}/g, (_, k) => { if (!(k in consts)) throw new Error(`unknown \${${k}}`); return String(consts[k]); });
}
// Everything the identity check compares, from one source text.
export function parts(src) {
  const consts = { MAX_SHAPES: constant(src, 'MAX_SHAPES'), UI_MAX: constant(src, 'UI_MAX') };
  const out = { constants: consts, raw: {}, compiled: {}, data: {} };
  for (const n of SHADERS) { out.raw[n] = template(src, n); out.compiled[n] = interpolate(out.raw[n], consts); }
  for (const n of ['PARAMS', 'PRESETS']) out.data[n] = arrayLiteral(src, n);
  return out;
}
export function hashes(p) {
  const h = { constants: p.constants };
  for (const k of ['raw', 'compiled', 'data']) { h[k] = {}; for (const [n, s] of Object.entries(p[k])) h[k][n] = sha256(s); }
  return h;
}
