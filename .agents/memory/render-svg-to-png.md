---
name: Render SVG → PNG (app icons) in this environment
description: How to deterministically rasterize hand-authored SVG into PNG assets (PWA/app icons) without AI generation
---

To produce raster brand assets (e.g. `icon.png` for the PWA/apple-touch icon) from a
hand-authored SVG, rasterize deterministically — do NOT use AI image generation.

**Tooling:** ImageMagick (`magick`) is installed and its SVG delegate is **librsvg**
(`rsvg-convert`), so SVG gradients/strokes/transforms render faithfully. Example:
`magick -background none -density 384 icon.svg -resize 1024x1024 -depth 8 -strip icon.png`
(`-depth 8 -strip` keeps the file small; default output is bloated 16-bit).

**Why:** AI generation is non-deterministic and off-brand; librsvg gives pixel-exact,
repeatable output straight from the design source.

**How to apply:** Author the icon as a standalone SVG, convert, verify with the `read`
tool (renders the PNG), then delete the temp SVG. For maskable PWA icons
(`purpose: "any maskable"`) the background must bleed full-bleed to the edges and the
artwork must stay inside a ~64% center safe zone or iOS's circular crop clips it.
