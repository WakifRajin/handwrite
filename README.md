# handwrite ✍️

Turn your handwriting into a real font, right in the browser.

Draw each character on the pad with a stylus, finger, or mouse, watch it show up live in a type tester, then download an OpenType (`.otf`) font you can install anywhere.

## Features

- **Stylus support**: pressure sensitivity (Apple Pencil, S Pen, Surface, Wacom), high-rate coalesced pointer events, the eraser end or the S Pen / barrel side button erases (even pressed mid-stroke), and palm rejection ignores touches once a pen is used, blocking palm scrolls and taps while the pen is near
- **Mouse & finger friendly**: optional speed-based fake pressure
- Guide lines (ascender, caps, x-height, baseline, descender) plus a faint guide letter
- 94 characters (A–Z, a–z, 0–9, punctuation) with thumbnails and progress tracking
- Undo/redo, eraser, clear, "next blank", keyboard shortcuts (type a letter to jump to it, ←/→, Ctrl+Z / Ctrl+Shift+Z)
- **Four brushes**: fineliner, marker, brush pen (tapered, pressure-hungry) and calligraphy (flat nib with adjustable angle). The brush restyles the whole font, and so do the stroke weight, pressure effect and smoothing settings
- Low-latency drawing: layered canvas, coalesced and predicted pointer events, desynchronized 2D context
- Live font preview: the page title and type tester use your font as you draw
- Export tweaks: font name, letter spacing, word spacing, slant, and small-caps fallback for missing cases
- Autosaves locally, and you can save or open project `.json` files
- **Installable PWA** that works offline after the first visit
- A pen event log in pen settings for troubleshooting a stylus
- Portrait-tablet layout: pad, tools and a swipeable glyph strip fit on one screen
- Notebook (light) and chalkboard (dark) themes
- 100% client-side: nothing is uploaded

## How it works

Each stroke is stored as raw `[x, y, pressure]` points in font units (1000/em), and the brush is applied at render time. Every pair of neighbouring points becomes one convex counter-clockwise piece: a tapered "capsule" (hull of two circles) for round brushes, or a hull of two nib rectangles for calligraphy. On screen, overlaps simply merge under the nonzero fill rule.

For export, each glyph's pieces are unioned with [Clipper](http://www.angusj.com/clipper2/Docs/Overview.htm) into clean, non-overlapping outlines (outer contours counter-clockwise, holes clockwise). Runs of short edges are then smoothed back into curves. Desktop rasterizers, especially Windows, draw heavily overlapping contours with streaks and holes, so this step matters. [opentype.js](https://github.com/opentypejs/opentype.js) writes the CFF-flavoured OpenType font. Both libraries are vendored in `vendor/` so the app works offline.

## Run locally

It's a static site with no build step:

```sh
python -m http.server 8000
# open http://localhost:8000
```
