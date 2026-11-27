// Unit tests that need no browser: materials, springs and the no-WebGL2 error.
import assert from 'node:assert/strict';
import { createGlass, isSupported, resolveMaterial, PRESETS, PARAMS, SCENE_KEYS, MAX_SHAPES, Spring, SPRINGS, SPRINGS_REDUCED } from '../src/index.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok   ' + name); };

test('presets include the Apple preset with its lab values', () => {
  const apple = PRESETS.find(p => p.id === 'apple');
  assert.equal(apple.p.refraction, 18); assert.equal(apple.p.blur, 6); assert.equal(apple.p.appearance, 'auto');
  assert.deepEqual(PRESETS.map(p => p.id), ['apple', 'apple-clear', 'thick', 'frosted', 'clear', 'prism']);
});
test('every preset sets every setting', () => {
  for (const P of PRESETS) for (const d of PARAMS) assert.ok(d.key in P.p, `${P.id} lacks ${d.key}`);
});
test('resolveMaterial: a preset id gives a copy', () => {
  const m = resolveMaterial('frosted'); m.blur = 0;
  assert.equal(PRESETS.find(p => p.id === 'frosted').p.blur, 22);
});
test('resolveMaterial: overrides, clamping and a base preset', () => {
  const m = resolveMaterial({ preset: 'thick', refraction: 500, edge: 'lip', tint: '#ABCDEF', blur: 'x', nope: 1 });
  assert.equal(m.refraction, 80);         // clamped to PARAMS max
  assert.equal(m.edge, 'lip');
  assert.equal(m.tint, '#abcdef');
  assert.equal(m.blur, 0);                // wrong type keeps the base value
  assert.ok(!('nope' in m));
  assert.equal(m.bezel, 44);              // from 'thick'
});
test('resolveMaterial: unknown preset throws', () => assert.throws(() => resolveMaterial('nope'), /unknown preset/));
test('scene-only keys', () => assert.deepEqual([...SCENE_KEYS].sort(), ['dim', 'interactive', 'lightAngle', 'merge']));
test('MAX_SHAPES is the shader limit', () => assert.equal(MAX_SHAPES, 8));
test('Spring settles on its target', () => {
  const s = new Spring(0, ...SPRINGS.move); s.t = 200;
  let peak = 0;
  for (let i = 0; i < 240; i++) { s.step(1 / 120); peak = Math.max(peak, s.x); }
  assert.ok(s.rest(), 'at rest after 2 s');
  assert.ok(peak > 200 && peak < 212, `one soft overshoot, got peak ${peak}`);   // the lab measured about 4% on a 200 px move
  const r = new Spring(0, ...SPRINGS_REDUCED.move); r.t = 200; let rp = 0;
  for (let i = 0; i < 240; i++) { r.step(1 / 120); rp = Math.max(rp, r.x); }
  assert.ok(rp <= 200 + 1e-9, 'reduced motion does not overshoot');
});
test('isSupported is false without a DOM', () => assert.equal(isSupported(), false));
test('createGlass without WebGL2 throws ERR_NO_WEBGL2', () => {
  const fake = { getContext: () => null };
  assert.throws(() => createGlass(fake), e => e.code === 'ERR_NO_WEBGL2');
  assert.throws(() => createGlass(null), TypeError);
});
console.log(`unit: ${n} tests passed`);
