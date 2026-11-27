// Springs for animating shapes, lifted from Lab 03 "Liquid glass" (good-machines commit 4686091).
// Optional: the renderer doesn't use them. Step them yourself and pass the values to setShapes().
//
//   const x = new Spring(100, ...SPRINGS.move);   // x, stiffness k, damping c
//   x.t = 300;                                     // new target
//   x.step(1 / 120);                               // the lab steps at a fixed 120 Hz
//   if (!x.rest()) requestAnimationFrame(...);

// Springs: every moving value is a damped spring stepped at a fixed 120 Hz.
class Spring {
  constructor(x, k, c) { this.x = x; this.v = 0; this.t = x; this.k = k; this.c = c; }
  step(h) { this.v += (-this.k * (this.x - this.t) - this.c * this.v) * h; this.x += this.v * h; }
  rest() { return Math.abs(this.x - this.t) < 1e-3 && Math.abs(this.v) < 1e-3; }
  snap(x) { this.x = this.t = x; this.v = 0; }
}

// The lab's tunings as [k, c] (stiffness, damping). In the lab, TUNE picked these at call time
// from prefers-reduced-motion; here both sets are data, so nothing touches the DOM on import.
// `reduced` is critical damping, used when the visitor asks for reduced motion.
export const SPRINGS = {
  move:    [320, 24],   // ζ ≈ 0.67: drag follow; settles with one soft overshoot
  press:   [420, 17],   // ζ ≈ 0.41: the swell on touch bounces once
  stretch: [380, 22],
  appear:  [140, 19],   // lens strength when a shape appears
  tone:    [120, 22],   // light/dark flip
  size:    [300, 30],   // ζ ≈ 0.87: size changes without a bounce
  morph:   [230, 25],   // ζ ≈ 0.82: glass changing place, size and radius together
};
export const SPRINGS_REDUCED = {
  move:    [900, 60],
  press:   [600, 49],
  stretch: [600, 49],
  appear:  [400, 40],
  tone:    [120, 22],
  size:    [600, 49],
  morph:   [600, 49],
};

export { Spring };
