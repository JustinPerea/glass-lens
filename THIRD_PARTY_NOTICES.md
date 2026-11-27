# Third-party notices and credits

The renderer comes from Lab 03, "Liquid glass", on goodmachines.ai (good-machines repo, commit 4686091). Justin Perea wrote it with Claude Code. Some of its math and tuning comes from the sources below. No code from any of them is copied in, with one exception: the two shader functions credited under Inigo Quilez, which match his published versions.

## Inigo Quilez

- `smin` in the glass shader is the quadratic polynomial smooth minimum from https://iquilezles.org/articles/smin/. It matches his published version character for character.
- `sdRB` is a signed distance to a rounded box. It is built the way his box SDF is, from https://iquilezles.org/articles/distfunctions2d/.

When I checked his article pages on 2026-11-27 they carried no license statement, so this file keeps the credit and links.

## kube.io

From "Liquid Glass in the Browser: Refraction with CSS and SVG" (https://kube.io/blog/liquid-glass-css-svg/, 2025):

- the convex squircle edge profile, `y = (1 - (1 - x)^4)^(1/4)`
- the Lip profile, `mix(convex, 1 - convex, smootherstep(x))`
- index of refraction 1.5
- the rule that the displacement points inward

These are formulas and constants only. That article builds the effect with SVG displacement maps. This package implements it in a WebGL2 fragment shader and uses none of that article's code.

## Apple

The "Apple" preset is a remake tuned by eye from Apple's public material: the Human Interface Guidelines Materials page, WWDC25 sessions 219, 323 and 356, the SwiftUI `Glass` and `GlassEffectContainer` documentation, and the June 2025 newsroom post. It uses no Apple code, images or assets. Liquid Glass is Apple's name for its material. This project is not affiliated with or endorsed by Apple.
