# glass-lens

glass-lens draws glass shapes (rounded rectangles, capsules and circles) over an image, a video or a canvas, into a canvas you give it. Each shape bends what's behind it at its rim, blurs and tints it, catches light along the edge and casts a soft shadow, and shapes that come close melt into each other. It uses WebGL2 and has no dependencies. The renderer comes from Lab 03 "Liquid glass" on goodmachines.ai; the shaders, the material settings and the presets (including the Apple preset) are the lab's, unchanged, and a pixel check shows the package renders the same frame as the lab.

## Install

It isn't on npm. Install it from a git URL or from a tarball made with `npm pack`:

```sh
npm install git+https://github.com/JustinPerea/glass-lens.git
# or
npm pack                      # in this repo: writes glass-lens-0.1.0.tgz
npm install ./glass-lens-0.1.0.tgz
```

The package is plain ES modules, so it also works without a bundler:

```html
<script type="module">
  import { createGlass } from './node_modules/glass-lens/src/index.js';
</script>
```

React is an optional peer dependency, needed only for `glass-lens/react`.

## Quick start

```js
import { createGlass } from 'glass-lens';

const canvas = document.querySelector('canvas');   // size it with CSS; the renderer reads its box
const glass = createGlass(canvas);

const img = new Image();
img.src = 'photo.jpg';
await glass.setSource(img);                          // waits for the image to decode
glass.setShapes([
  { kind: 'rect', x: 300, y: 200, w: 320, h: 200, r: 34 },  // x, y are the centre, in CSS px
  { kind: 'capsule', x: 300, y: 360, w: 220, h: 58 },
  { kind: 'circle', x: 460, y: 360, w: 58 },
]);
glass.setMaterial('apple');
glass.render();
```

Nothing redraws on its own. Call `render()` after a change, or every frame while a video or a canvas you draw into is the source:

```js
const video = document.querySelector('video');      // muted, playsinline, playing
await glass.setSource(video);
(function loop() { glass.render(); requestAnimationFrame(loop); })();
```

### React

```jsx
import { GlassCanvas } from 'glass-lens/react';

const shapes = [{ kind: 'rect', x: 320, y: 200, w: 320, h: 200, r: 34 }];

function Hero({ image }) {
  return <GlassCanvas source={image} shapes={shapes} material="apple" style={{ width: 640, height: 400 }} />;
}
```

`GlassCanvas` renders a `<canvas>`, creates the renderer on mount and destroys it on unmount, redraws when `source`, `shapes` or `material` change, follows the canvas's size with a `ResizeObserver`, and redraws every frame while the source is a video or `live` is set. Pass a ref to reach the renderer (for `toBlob()`). Pass the same `shapes` array between renders if the shapes haven't changed; a new array redraws. Without WebGL2 it renders `fallback` (default: nothing) and calls `onError`.

## Demo

```sh
npm run demo        # serves this repo on http://127.0.0.1:8040
```

Open `http://127.0.0.1:8040/demo/`. The background (a slow gradient under a grid and some type) is drawn in canvas; drag the glass card, switch materials, save a PNG, or pick your own image or video, which stays in the tab.

## API

### `createGlass(canvas, options?)`

Creates a renderer on `canvas`. The renderer owns the canvas: it draws the cover-fitted source and the glass into it, and the context is opaque (`alpha: false`), so the canvas is not an overlay on top of other page content.

Throws an `Error` with `code: 'ERR_NO_WEBGL2'` when the browser has no WebGL2. Check `isSupported()` first if you want to show something else instead.

| Option | Default | |
|---|---|---|
| `source` | none | Same as calling `setSource(source)`; its promise is `glass.ready` |
| `shapes` | `[]` | Same as `setShapes(shapes)` |
| `material` | `'apple'` | Same as `setMaterial(material)` |
| `width`, `height` | the canvas's layout box | CSS size in px. When given, the canvas's `style.width/height` are set to match |
| `dpr` | `min(devicePixelRatio, 2)` | Device px per CSS px. The backing size is `round(width × dpr)` by `round(height × dpr)` |

Returns an object with:

- **`setSource(src, { live }?)`** → `Promise`. `src` is an `HTMLImageElement`, `HTMLVideoElement`, `HTMLCanvasElement`, `OffscreenCanvas` or `ImageBitmap`, or `null` to clear it. Images still loading are awaited. Stills are copied once (capped at 4096 px on the long side, transparency flattened onto `#F4F1E9`, as in the lab). Videos, and any source passed with `{ live: true }`, are uploaded again on each `render()` (a video only when its frame changed). The source is cover-fitted to the canvas. If you call `setSource` again before an earlier image finishes decoding, the later call wins.
- **`setShapes(shapes)`**. Up to 8 shapes (the shader's limit; more throws a `RangeError`). Each shape:

  | Field | | |
  |---|---|---|
  | `kind` | required | `'rect'`, `'capsule'` or `'circle'` |
  | `x`, `y` | `0` | Centre, CSS px from the canvas's top left |
  | `w`, `h` | required | Size in CSS px. A circle uses `w` for both |
  | `r` | `24` | Corner radius for `rect`, capped at half the short side. Capsules and circles always use half the short side |
  | `material` | the scene's | A preset id or a settings object, for this shape only. Scene-only settings (`dim`, `lightAngle`, `merge`, `interactive`) always come from the scene |
  | `press` | `0` | 0 to 1: the shape swells by up to 8% and lights up from its centre, as when touched (needs `interactive`) |
  | `appear` | `1` | 0 to 1: lens strength. The lab forms glass by turning this up rather than fading it in |
  | `tone` | measured | 0 light, 1 dark. Left out, it's set from the material's `appearance` and, for `auto`, from the luminance under the shape |

- **`setMaterial(m)`**. A preset id (`'apple'`, `'apple-clear'`, `'thick'`, `'frosted'`, `'clear'`, `'prism'`) replaces every setting. An object changes only the settings it names, on top of the current ones; with a `preset` key it starts from that preset instead. Values are clamped to the ranges in the table below, and values of the wrong type are ignored.
- **`getMaterial()`** → a copy of the scene's settings.
- **`render()`** → `true` if it drew a frame, `false` if there's no source yet or the context is lost.
- **`resize(width?, height?)`**. Re-reads the canvas's box (or takes the CSS size you pass) and the device pixel ratio. Call it when the canvas changes size, then `render()`.
- **`toBlob(type = 'image/png', quality?)`** → `Promise<Blob>`: renders a full-resolution frame and encodes it, the same as the lab's Save PNG.
- **`destroy()`**. Frees the textures, framebuffers and programs. It leaves the WebGL context alive, so a new `createGlass` on the same canvas works (React StrictMode mounts twice).
- **`ready`**: the promise from the `source` option.
- **`info`**: size, device pixel ratio, backing size, mean luminance of the source, each shape's tone, and whether the context is lost. For tests and debugging.

A lost WebGL context is handled: `render()` returns `false` until the browser restores it, then the renderer rebuilds its resources and the next `render()` draws again.

### Other exports

- `isSupported()`: true when WebGL2 is available.
- `resolveMaterial(m)`: the full settings object a preset id or partial object resolves to.
- `PARAMS`, `PRESETS`, `SCENE_KEYS`, `MAT_KEYS`, `MAX_SHAPES`: the lab's settings table, presets and limits.
- `Spring`, `SPRINGS`, `SPRINGS_REDUCED`: the lab's damped spring and its tunings as `[stiffness, damping]`, for animating shapes yourself. The renderer doesn't use them. The demo moves its card with `SPRINGS.move` and swells it with `SPRINGS.press`, stepping at 120 Hz like the lab; use `SPRINGS_REDUCED` (critical damping) when the visitor asks for reduced motion.

```js
import { Spring, SPRINGS } from 'glass-lens';
const x = new Spring(100, ...SPRINGS.move);
x.t = 300;                       // the new target
x.step(1 / 120);                 // per 120 Hz step; x.x is the value, x.rest() says when it has settled
```

## Material settings

From `PARAMS`. Lengths are CSS px. "Scene" settings apply to the whole canvas and can't be set per shape.

| Key | Name | Range | Apple | What it does |
|---|---|---|---|---|
| `refraction` | Refraction | 0 to 80 px | 18 | How far the curved edge bends what sits behind it |
| `bezel` | Edge width | 2 to 80 px | 20 | Width of the rounded rim where the bending happens |
| `magnify` | Magnify | 1 to 1.8 × | 1 | Zoom on what sits under the middle of the glass |
| `dispersion` | Dispersion | 0 to 1 | 0.04 | Splits colour at the rim, like a prism |
| `edge` | Edge shape | `convex`, `lip` | convex | Lip is a raised rim around a shallow dip, so the middle shrinks a little (shaped like Apple's switch knob) |
| `sizeScale` | Bigger glass bends more | boolean | true | Larger shapes get a stronger lens |
| `blur` | Blur | 0 to 40 px | 6 | Softens what shows through the glass |
| `frost` | Frost | 0 to 1 | 0.1 | A milky haze that keeps text on the glass readable |
| `vibrancy` | Vibrancy | 0 to 2 × | 1.35 | Colour saturation of what shows through |
| `brightness` | Brightness | −0.3 to 0.3 | 0.02 | Added to the glass colour |
| `dim` | Dim bright images (scene) | 0 to 0.6 | 0 | A dark scrim around the glass on bright images, so clear glass stays readable. Apple suggests 35% |
| `appearance` | Appearance | `auto`, `light`, `dark` | auto | Auto turns each small shape (96 px or less on its short side) light or dark to match what's under it |
| `pickup` | Colour from below | 0 to 1 | 0.35 | Lets the glass take on the colour of what's under it |
| `tintAmount` | Tint | 0 to 1 | 0 | Strength of the tint colour |
| `tint` | Tint colour | `#rrggbb` | #e8593c | Mapped onto the brightness behind, so tinted glass stays see-through |
| `specular` | Rim light | 0 to 1.5 | 0.7 | The bright line where light catches the edge |
| `rimWidth` | Rim width | 0.3 to 12 px | 1.4 | Width of that line |
| `lightAngle` | Light angle (scene) | −180 to 180° | −135 | Where the light comes from. −135° is the upper left |
| `shadow` | Shadow | 0 to 1 | 0.3 | Soft shadow below the glass |
| `merge` | Merge distance (scene) | 0 to 60 px | 10 | Shapes closer than this melt into each other |
| `interactive` | React to touch (scene) | boolean | true | Pressed glass swells and lights up (see `press`) |

## Browser support

Tested only in headless Google Chrome 158.0.8127.88 on macOS (the installed Chrome, through Puppeteer). No other browser, operating system or GPU has been run. Without WebGL2, `createGlass` throws (see above); there is no CSS fallback.

## React Native / Expo

Not run on React Native or Expo. Routes that might work, none of them tried:

- **react-native-webview**: host the web build (a page using this package) in a WebView. The WebView's browser engine has to provide WebGL2.
- **Expo web**: with react-native-web the app runs in a browser, where a DOM `<canvas>` exists, so `GlassCanvas` or `createGlass` would run the same as on any web page.
- **expo-gl** (native): its `GLView` context extends `WebGL2RenderingContext` per Expo's docs, so the shaders could likely compile. The package would still need a port: it creates its context with `canvas.getContext('webgl2')`, copies and measures the source through 2D canvases, and saves through `canvas.toBlob`. Expo documents that `texImage2D` there takes only `null`, an `ArrayBuffer` or a `{ localUri }` file, and that a frame is presented with `gl.endFrameEXP()`. None of that port exists.

## How the renderer works

Three kinds of pass, each a full-screen triangle:

1. **Scene cache.** The source, cover-fitted to the canvas, is drawn into a texture with mipmaps at one texel per device pixel. It's rebuilt only when the source, the size or a live source's frame changes.
2. **Blur pyramid.** One texture whose mip chain holds Gaussian levels: level *i* is the scene blurred to σ = 3 · 2^i cache texels, at half the size of the level above. Each level costs two small separable passes. Any blur radius is then one `textureLod` at a fractional level, where the GPU blends two neighbouring levels. Below level 0 the shader takes four taps on the sharp scene.
3. **Glass.** One fragment shader. Every shape is a signed distance field (a rounded box), combined with a polynomial smooth minimum, so shapes melt together within the merge distance. Per-shape values (geometry, tone and every material setting) are blended per pixel by closeness, so merged shapes share their material smoothly.
   - **Edge lens.** Across the edge width the surface follows a convex squircle height profile, `h(x) = (1 − (1 − x)^4)^(1/4)`, or the Lip profile. The normal comes from that slope and the distance field's gradient; a straight-down view ray is refracted at an index of 1.5, and the bent ray picks the point behind that shows through. It bends inward, so the rim shows content from further inside, squeezed toward the edge. The mip level for that lookup comes from the screen-space rate of change of the bent coordinates, so the squeezed rim filters cleanly.
   - **Dispersion** samples red, green and blue at slightly different offsets, so it shows only at the rim.
   - **Surface.** Vibrancy (saturation), then frost: a white haze over light content and a graphite one over dark, tinted toward the colour underneath. The tint maps the chosen colour onto the brightness behind it.
   - **Light.** A thin exponential rim, strongest facing the light and a little weaker on the far side, plus a soft Fresnel term across the curved edge.
   - **Shadow** is a soft, offset falloff of the distance field, outside the glass only. Pixels more than 96 px from any glass skip the shader's work.

Light or dark per shape is measured on a 160 px copy of the source, in linear luminance: small shapes over dark content (luminance under 0.14, with hysteresis up to 0.22) turn dark, and large ones stay light.

The Apple preset follows what Apple has published (lensing over scatter, a 35% dim for the clear variant on bright content, small elements turning light or dark with the content, capsule radius = height / 2, shapes blending when close). Apple publishes no optical numbers, so every value in it was tuned by eye against iOS 26 screenshots.

## Verifying

| Command | Needs | Checks |
|---|---|---|
| `npm test` | Node | The shaders, `MAX_SHAPES`, `UI_MAX`, `PARAMS` and `PRESETS` match hashes recorded from the lab page; materials, springs, the no-WebGL2 error |
| `LAB_HTML=… npm test` | the lab page | The same, compared directly with the lab's source text |
| `LAB_HTML=… npm run check:pixels` | the lab page, Chrome, puppeteer | Renders seven scenes (four presets, three pixel ratios, a pressed shape, a per-shape material) in the lab and in the package and diffs the pixels |
| `npm run check:demo` | Chrome, puppeteer | The demo renders, drags, saves, takes an image file and a video |
| `npm run check:react` | Chrome, puppeteer, network | `GlassCanvas` under React 18 StrictMode |
| `npm run check:pack` | network | Installs the packed tarball with React and imports both entry points |

`LAB_HTML` is the path to the lab page, `site/lab/liquid-glass/index.html` at good-machines commit 4686091; it isn't in this repo. The browser checks use the installed Google Chrome; set `CHROME_PATH` and install `puppeteer-core` to run them.

## License

MIT, see LICENSE. Liquid Glass is Apple's name for its material; this project is not affiliated with or endorsed by Apple.

## Credits

See THIRD_PARTY_NOTICES.md.
