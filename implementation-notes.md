# Implementation notes

Source: Lab 03 "Liquid glass", good-machines commit 4686091, `site/lab/liquid-glass/index.html` (4,406 lines, sha256 in `test/lab-reference.json`). Worked from a copy of the live page; the good-machines checkout was not touched.

## What was lifted, and how

- The shader strings (`VERT`, `COVER`, `BLUR`, `GLASS`), `UI_MAX`, the `PARAMS` table (with its comments), `GROUPS`, `DEF`, `SCENE_KEYS`, `MAT_KEYS` and `PRESETS` were cut out of the lab file by line range with a script, not retyped. `src/shaders.js` and `src/params.js` hold them; `MAX_SHAPES = 8` became an export so the `GLASS` template interpolates it as before.
- The `Spring` class was cut the same way into `src/springs.js`.
- The JS around the shaders (`compile`, `rtex`, `drawTo`, `pass`, `uploadImage`, `coverFit`, `ensureCache`, `buildCache`, `buildPyramid`, `drawGlass`, `buildLum`, `lumRect`, `lumUnder`, `measureTones`, `useSource`, `uploadVideo`, `coerce`) was copied and kept as close to the lab text as the API allowed, inside `createGlass`. Comments marked `lab:` in `src/glass.js` mark each change.

## Changes to lifted JS, and why

| Where | Change | Why |
|---|---|---|
| Everything | Page globals (`fb`, `cache`, `imgTex`, the uniform arrays, `lumCanvas`, `params`) moved inside `createGlass` | Two renderers on one page must not share state, and importing the module must not touch the DOM (the Node import test) |
| Camera | `cam` is fixed at zoom 1, centred; `camSettled()` is always true | Camera input (wheel, pinch, follow, focus) is editor UI. The zoom terms stay in `buildCache` and `drawGlass`, multiplied by z = 1, so the packing is the lab's |
| `ensureCache`, `render` | Always full scale | The adaptive render scale is left out (see below) |
| `buildCache` | `u_un` is 0 | The underlay (iOS control tracks under knobs) is left out |
| `sceneLive` | True while the source is a video or a live canvas | Scrolling and the underlay are gone, so a moving source is the only live scene |
| `scroll` | Always 0 | Hands-free scrolling is left out; `lumRect` and the cover pass keep their scroll terms |
| Shapes | Plain numbers (`x`, `y`, `w`, `h`, `r`, `press`, `appear`, `tone`) instead of springs | The caller animates; the springs are an optional export |
| `geom` | No knob swell, no velocity stretch (both factors are 1) | Knobs belong to the iOS controls layout; stretch needs velocity the renderer doesn't have |
| `drawGlass` | No tucked-piece filter; presence 1; solid 0; merge `max(params.merge, 0)`; light angle without drift or tilt; touch point = the most-pressed shape's centre | Split pieces, knobs, drag drift and phone tilt are left out. The lab's touch point came from the pointer |
| `measureTones` | Sets the tone directly instead of a spring's target; label ink is gone; a shape can override `tone` | The lab's value at rest is the target, which the pixel check confirms |
| `useSource` | Reuses one 2D canvas; skips the CSS-fallback branch | Fewer allocations when sources change; no fallback |
| `uploadVideo` → `uploadLive` | Also takes a canvas or ImageBitmap marked `live`; rebuilds luminance every 500 ms (the lab's video cadence) | The demo's moving background is a canvas |
| `initGL` | No label or compare programs | Labels and the compare tool are left out |
| Context loss | `preventDefault` on loss; on restore, rebuild programs, targets and the source texture | The lab showed a toast and asked for a reload. Tested with `WEBGL_lose_context` in check:pixels |

## Left out, and why

- **Editor UI**: the panel, preset chips and visual previews, links (`#s=`), undo and redo, the compare tool, the recorder, the phone sheet, the shape toolbar, focus mode, the site nav. These belong to the lab page.
- **Interactive layouts** (Morph, iOS controls) and the underlay: demo layouts.
- **WebGL labels and icons**: the brief left them out. The `LABEL_VERT`, `LABEL` and `REF` shaders are the only lab shaders not in the package; the identity check lists them.
- **GIF decoder and animated images**: left out. A GIF or WebP passed as an `<img>` shows its first frame.
- **Hands-free motion** (scroll, glide), **phone tilt**, **light drift**, **velocity stretch**: they need a frame loop and input the renderer doesn't own.
- **Adaptive render scale**: it judges frame times from a rAF loop the lab owned. `render()` here is on demand and always full resolution. A caller with a slow GPU and a moving source pays full cost every frame; adding it back would mean the package running its own loop or taking frame times from the caller.
- **CSS backdrop-filter fallback**: the lab's version is about 35 lines of renderer, but it depends on a DOM world layer holding an `<img>` or the `<video>` behind the shapes, which a canvas-only API doesn't have. Porting it means an API that owns a container element, not a canvas, so it came to well over 60 lines. Without WebGL2, `createGlass` throws an Error with `code: 'ERR_NO_WEBGL2'`, and `isSupported()` checks first.
- **Analytics, Google Fonts, `/assets/site.css`, the favicon, all sample photos and videos**: not used. The demo and the test fixture draw their images in canvas with `system-ui`.

## Decisions not in the brief

- **x and y are centres**, as in the lab (where springs and the shader use centres).
- **`setSource` always returns a Promise**, so an `<img>` still loading can be awaited; a later call wins over an earlier one still decoding (the lab's `srcGen`).
- **`setMaterial(object)` merges onto the current settings**; with a `preset` key it starts from that preset. Values go through the lab's `coerce`, so wrong types are ignored and numbers are clamped to the `PARAMS` ranges.
- **Per-shape `material`** resolves against the scene's settings, and the four scene-only keys always come from the scene, as in the lab.
- **`destroy()` keeps the WebGL context** so React StrictMode's remount works on the same canvas; check:pixels and check:react cover it.
- **Springs export as data** (`SPRINGS`, `SPRINGS_REDUCED`, `[k, c]` pairs) because the lab's `TUNE` read `matchMedia` at call time. Only the tunings that make sense for free shapes are exported (move, press, stretch, appear, tone, size, morph).
- **The React wrapper is plain `createElement`**, no JSX, so it needs no build step.
- **The lab page is not in this repo.** `test/lab-reference.json` holds sha256 hashes of the lab file and of each lifted part, so `npm test` runs anywhere. With `LAB_HTML` set it also compares the text directly. `check:pixels` needs `LAB_HTML`. Justin to decide whether a copy of the lab page (or only its shader section) should be committed as a fixture.

## Verification results (2026-11-27, Chrome 158.0.8127.88, headless, macOS, sandbox on)

**Shader identity** (`LAB_HTML=… npm test`): `VERT`, `COVER`, `BLUR`, `GLASS` raw and interpolated, `MAX_SHAPES = 8`, `UI_MAX = 6`, `PARAMS` and `PRESETS` text identical to the lab page. A deliberate one-character change to `GLASS` (IOR 1.5 → 1.45) made the check fail and print the line; reverted.

**Pixel diff** (`LAB_HTML=… npm run check:pixels`). Method: the lab page is served locally with every non-local request aborted (one request was blocked per load). The script confirms the lab is on WebGL (`glassLab.previews.visual`), loads a canvas-drawn fixture through `glassLab.loadFile`, replaces the shapes with four unlabelled ones through `snapshot()` / `restore(…, { animate: false, view: false })`, resets the view and calls `advance(10)` so every spring settles (appear 1, press 0). The package is imported into the same page, given a second canvas at the lab's CSS size, and fed the same PNG through `createImageBitmap`. Both canvases are read with `readPixels` in the same task as their render. Before diffing, it asserts equal backing sizes, equal per-shape tones and equal mean luminance.

| Scene | Stage (CSS px) | Canvas | Max channel diff | Mean channel diff | Differing pixels |
|---|---|---|---|---|---|
| apple, DPR 2 | 924 × 736 | 1848 × 1472 | 0 | 0 | 0% |
| apple, DPR 1 | 924 × 736 | 924 × 736 | 0 | 0 | 0% |
| thick, DPR 2 | 924 × 736 | 1848 × 1472 | 0 | 0 | 0% |
| frosted with the Lip edge, DPR 2 | 924 × 736 | 1848 × 1472 | 0 | 0 | 0% |
| prism, DPR 2 | 924 × 736 | 1848 × 1472 | 0 | 0 | 0% |
| apple, DPR 1.5, 1111 × 777 viewport | 755 × 713 | 1133 × 1070 | 0 | 0 | 0% |

Guards that ran with each scene: the glass changes 15.6 to 19.9% of the frame against a no-shape render; 0.5 px more refraction in the package alone changes 0.58 to 1.70% of pixels (so a real difference shows); the Apple scenes have a dark shape and light ones (tones 0, 0, 1, 0); the package in a blank page, after destroy and re-create on one canvas, and after a lost and restored context renders the same hash as in the lab page.

**Other checks**: `check:demo` (renders, background moves, the card drags to within 2 px of its target on the move spring, Save PNG gives a PNG, a picked image and a video recorded in the page both work, no page errors); `check:react` (React 18.3.1 StrictMode: one canvas, the ref is the renderer, new props redraw, `toBlob` through the ref, unmount clears the ref, no console errors or warnings); `check:pack` (the tarball installs in a fresh directory next to react@18.3.1 and react-dom@18.3.1, both entry points import, `GlassCanvas` server-renders a `<canvas>`).

## Not verified

- Any browser other than headless Chrome 158 on macOS, any other GPU, any phone.
- The lab's exact Type sample in the pixel check: it uses Figtree from Google Fonts, which the check blocks, so the fixture is a separate canvas drawing.
- Sources larger than 4096 px through the scaled path, and `OffscreenCanvas` sources.
- React 19, and the React wrapper's `ResizeObserver` resizing.
- Performance: no frame timing was measured. A live source rebuilds the scene cache and pyramid on every render, as in the lab.
- React Native and Expo (the README lists routes, untried). expo-gl facts in the README come from Expo's GLView docs (docs.expo.dev/versions/latest/sdk/gl-view, read 2026-11-27).
