# handwrite ✍️

Turn your handwriting into a real font, right in the browser.

Draw each character on the pad with a stylus, finger, or mouse, watch it show up live in a type tester, then download an OpenType (`.otf`) font you can install anywhere.

## Features

- **Stylus support**: pressure sensitivity (Apple Pencil, S Pen, Surface, Wacom), high-rate coalesced pointer events, the pen's eraser end and barrel button erase, and palm rejection ignores touches once a pen is used
- **Mouse & finger friendly**: optional speed-based fake pressure
- Guide lines (ascender, caps, x-height, baseline, descender) plus a faint guide letter
- 94 characters (A–Z, a–z, 0–9, punctuation) with thumbnails and progress tracking
- Undo/redo, eraser, clear, "next blank", keyboard shortcuts (type a letter to jump to it, ←/→, Ctrl+Z / Ctrl+Shift+Z)
- Global stroke weight, pressure effect, and smoothing settings that re-render every glyph
- Live font preview: the page title and type tester use your font as you draw
- Export tweaks: font name, letter spacing, word spacing, slant, and small-caps fallback for missing cases
- Autosaves locally, and you can save or open project `.json` files
- Notebook (light) and chalkboard (dark) themes
- 100% client-side: nothing is uploaded

## How it works

Each stroke is stored as `[x, y, pressure]` points in font units (1000/em). At render and export time, every pair of neighbouring points becomes a tapered "capsule" outline (the convex hull of two circles), always wound counter-clockwise. Overlaps merge under the nonzero fill rule, so outlines never need boolean ops and never get self-intersection holes. [opentype.js](https://github.com/opentypejs/opentype.js) assembles the glyphs into a CFF-flavoured OpenType font.

## Run locally

It's a static site with no build step:

```sh
python -m http.server 8000
# open http://localhost:8000
```
