// Material settings and presets, lifted verbatim from Lab 03 "Liquid glass" (good-machines commit 4686091).
// test/shader-identity.mjs checks PARAMS and PRESETS against the lab.

// ---------------------------------------------------------------------------
// Settings. Every material setting is a live control; presets are just values.
// ---------------------------------------------------------------------------
const PARAMS = [
  { group: 'Lens', key: 'refraction', name: 'Refraction', min: 0, max: 80, step: 0.5, unit: 'px', tip: 'How far the curved edge bends what sits behind it.' },
  { group: 'Lens', key: 'bezel', name: 'Edge width', min: 2, max: 80, step: 0.5, unit: 'px', tip: 'Width of the rounded rim where the bending happens.' },
  { group: 'Lens', key: 'magnify', name: 'Magnify', min: 1, max: 1.8, step: 0.01, unit: '×', tip: 'Zoom on what sits under the middle of the glass.' },
  { group: 'Lens', key: 'dispersion', name: 'Dispersion', min: 0, max: 1, step: 0.01, unit: '', tip: 'Splits color at the rim, like a prism.' },
  { group: 'Lens', key: 'edge', name: 'Edge shape', type: 'seg', options: [['convex', 'Convex'], ['lip', 'Lip']], tip: 'Lip is a raised rim around a shallow dip, so the middle shrinks a little. Apple’s switch knob is shaped like this.' },
  { group: 'Lens', key: 'sizeScale', name: 'Bigger glass bends more', type: 'bool', tip: 'Larger shapes get a stronger lens.' },
  { group: 'Surface', key: 'blur', name: 'Blur', min: 0, max: 40, step: 0.5, unit: 'px', tip: 'Softens what shows through the glass.' },
  { group: 'Surface', key: 'frost', name: 'Frost', min: 0, max: 1, step: 0.01, unit: '', tip: 'A milky haze that keeps text on the glass readable.' },
  { group: 'Surface', key: 'vibrancy', name: 'Vibrancy', min: 0, max: 2, step: 0.01, unit: '×', tip: 'Color saturation of what shows through.' },
  { group: 'Surface', key: 'brightness', name: 'Brightness', min: -0.3, max: 0.3, step: 0.01, unit: '', tip: '' },
  { group: 'Surface', key: 'dim', name: 'Dim bright images', min: 0, max: 0.6, step: 0.01, unit: '', tip: 'A dark scrim around the glass on bright images, so clear glass stays readable. Apple suggests 35%.' },
  { group: 'Surface', key: 'appearance', name: 'Appearance', type: 'seg', options: [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], tip: 'Auto flips each shape light or dark to match what is under it.' },
  { group: 'Tint', key: 'pickup', name: 'Color from below', min: 0, max: 1, step: 0.01, unit: '', tip: 'Lets the glass take on the color of what is under it.' },
  { group: 'Tint', key: 'tintAmount', name: 'Tint', min: 0, max: 1, step: 0.01, unit: '', tip: '' },
  { group: 'Tint', key: 'tint', name: 'Tint color', type: 'color', tip: '' },
  { group: 'Light', key: 'specular', name: 'Rim light', min: 0, max: 1.5, step: 0.01, unit: '', tip: 'The bright line where light catches the edge.' },
  { group: 'Light', key: 'rimWidth', name: 'Rim width', min: 0.3, max: 12, step: 0.1, unit: 'px', tip: '' },
  { group: 'Light', key: 'lightAngle', name: 'Light angle', min: -180, max: 180, step: 1, unit: '°', tip: 'Where the light comes from. −135° is the upper left.' },
  { group: 'Light', key: 'shadow', name: 'Shadow', min: 0, max: 1, step: 0.01, unit: '', tip: '' },
  { group: 'Merge and touch', key: 'merge', name: 'Merge distance', min: 0, max: 60, step: 1, unit: 'px', tip: 'Shapes closer than this melt into each other.' },
  { group: 'Merge and touch', key: 'interactive', name: 'React to touch', type: 'bool', tip: 'Pressed glass swells and lights up from your finger.' },
];
const GROUPS = ['Lens', 'Surface', 'Tint', 'Light', 'Merge and touch'];
const DEF = Object.fromEntries(PARAMS.map(d => [d.key, d]));
// A shape with its own material overrides every setting except these, which belong
// to the whole scene: one light, one scrim, one merge field, one touch behaviour.
const SCENE_KEYS = new Set(['dim', 'lightAngle', 'merge', 'interactive']);
const MAT_KEYS = PARAMS.map(d => d.key).filter(k => !SCENE_KEYS.has(k));

// Apple values: no numeric constants are published. Directions and the two hard
// numbers (35% dim for clear glass, capsule radius = height / 2) come from Apple;
// the rest were tuned by eye against iOS 26 screenshots. See implementation-notes.md.
const PRESETS = [
  { id: 'apple', name: 'Apple Liquid Glass', note: 'Our remake of Apple’s regular Liquid Glass. The edge lens is light, there’s just enough blur to keep labels readable, and small shapes switch to light or dark to match what’s behind them.',
    p: { refraction: 18, bezel: 20, magnify: 1, dispersion: 0.04, edge: 'convex', sizeScale: true, blur: 6, frost: 0.1, vibrancy: 1.35, brightness: 0.02, dim: 0, appearance: 'auto', pickup: 0.35, tintAmount: 0, tint: '#e8593c', specular: 0.7, rimWidth: 1.4, lightAngle: -135, shadow: 0.3, merge: 10, interactive: true } },
  { id: 'apple-clear', name: 'Apple clear', note: 'Apple’s clear variant. Almost no blur or haze, and it doesn’t switch between light and dark. Bright content behind it is dimmed by 35%, as Apple suggests.',
    p: { refraction: 18, bezel: 16, magnify: 1, dispersion: 0.05, edge: 'convex', sizeScale: true, blur: 0.5, frost: 0.02, vibrancy: 1.1, brightness: 0, dim: 0.35, appearance: 'light', pickup: 0.1, tintAmount: 0, tint: '#e8593c', specular: 0.65, rimWidth: 1.4, lightAngle: -135, shadow: 0.18, merge: 10, interactive: true } },
  { id: 'thick', name: 'Thick lens', note: 'A deep, clear lens with a wide rim. It magnifies the middle and folds the image hard at the edge.',
    p: { refraction: 46, bezel: 44, magnify: 1.28, dispersion: 0.12, edge: 'convex', sizeScale: false, blur: 0, frost: 0, vibrancy: 1.05, brightness: 0.02, dim: 0, appearance: 'light', pickup: 0, tintAmount: 0, tint: '#e8593c', specular: 0.8, rimWidth: 2.2, lightAngle: -135, shadow: 0.45, merge: 24, interactive: true } },
  { id: 'frosted', name: 'Frosted', note: 'Sandblasted glass. Heavy blur and haze hide the detail but keep the color.',
    p: { refraction: 8, bezel: 12, magnify: 1, dispersion: 0, edge: 'convex', sizeScale: true, blur: 22, frost: 0.3, vibrancy: 1.4, brightness: 0.04, dim: 0, appearance: 'auto', pickup: 0.6, tintAmount: 0, tint: '#e8593c', specular: 0.35, rimWidth: 1, lightAngle: -135, shadow: 0.25, merge: 14, interactive: true } },
  { id: 'clear', name: 'Plain lens', note: 'Plain clear glass: a sharp lens with no blur, haze or tint.',
    p: { refraction: 26, bezel: 22, magnify: 1.06, dispersion: 0, edge: 'convex', sizeScale: false, blur: 0, frost: 0, vibrancy: 1, brightness: 0, dim: 0, appearance: 'light', pickup: 0, tintAmount: 0, tint: '#e8593c', specular: 0.5, rimWidth: 1, lightAngle: -135, shadow: 0.15, merge: 14, interactive: true } },
  { id: 'prism', name: 'Prism', note: 'Strong dispersion at the rim, so edges break into color.',
    p: { refraction: 30, bezel: 30, magnify: 1.1, dispersion: 0.85, edge: 'convex', sizeScale: false, blur: 0, frost: 0, vibrancy: 1.2, brightness: 0.02, dim: 0, appearance: 'light', pickup: 0, tintAmount: 0, tint: '#e8593c', specular: 0.9, rimWidth: 1.6, lightAngle: -135, shadow: 0.25, merge: 20, interactive: true } },
];

export { PARAMS, GROUPS, DEF, SCENE_KEYS, MAT_KEYS, PRESETS };
