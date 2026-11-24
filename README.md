# handwrite

Draw the alphabet on screen and download it as an OpenType font. It runs entirely in the browser, and nothing is uploaded.

Live at https://wakifrajin.github.io/handwrite/

## Features

- Stylus input with pressure (Apple Pencil, S Pen, Surface, Wacom). The eraser end of a pen, the S Pen side button and a right-drag with a mouse all erase.
- Palm rejection: once a pen has touched the pad, touches can't draw, and while the pen is near they can't scroll or tap either.
- Mouse and finger input, with optional pressure simulated from drawing speed.
- Guide lines for ascender, cap height, x-height, baseline and descender, plus a faint reference letter.
- 94 characters: A–Z, a–z, 0–9 and ASCII punctuation.
- Four brushes: fineliner, marker, brush pen and calligraphy (flat nib with an adjustable angle). The brush, stroke weight and pressure settings apply to the whole font, so changing them restyles every letter.
- Undo and redo, and keyboard shortcuts: type a character to jump to it, ←/→ to step, Ctrl+Z / Ctrl+Shift+Z.
- A type tester that uses your font as you draw.
- Export settings: font name, letter spacing, word spacing, slant, and filling missing lowercase letters with small capitals.
- Autosave in the browser, plus project files you can save and reopen.
- Installable as an app, and works offline after the first visit.
- A layout for portrait tablets that fits the pad, tools and character strip on one screen.
- Light and dark themes.

## How it works

Strokes are stored as raw `[x, y, pressure]` points in font units (1000 per em), and the brush is applied when drawing. Each pair of neighbouring points becomes one convex, counter-clockwise piece: the hull of two circles for round brushes, or the hull of two nib rectangles for calligraphy. On screen the pieces overlap and the nonzero fill rule merges them.

On export, each glyph's pieces are unioned with the Clipper library (clipper-lib 6.4.2) into non-overlapping outlines, and runs of short edges are smoothed back into curves. This step matters because desktop rasterizers, Windows in particular, draw overlapping contours with visible streaks. [opentype.js](https://github.com/opentypejs/opentype.js) then writes a CFF-based OpenType font. Both libraries are kept in `vendor/` so the app works offline.

## Run locally

It's a static site with no build step:

```sh
python -m http.server 8000
```

Then open http://localhost:8000.
