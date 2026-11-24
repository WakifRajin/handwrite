// Turns drawn strokes into an OpenType (CFF) font with opentype.js (global `opentype`).
// Each glyph's stroke pieces are unioned into clean, non-overlapping outlines first
// (geometry.outlinePolygons) so the font renders correctly in every rasterizer.
import { outlinePolygons, smoothPath, METRICS } from './geometry.js';

const range = (a, b) => Array.from({ length: b.charCodeAt(0) - a.charCodeAt(0) + 1 }, (_, i) => String.fromCharCode(a.charCodeAt(0) + i));

export const GROUPS = {
  upper: range('A', 'Z'),
  lower: range('a', 'z'),
  digits: range('0', '9'),
  punct: [...'.,!?\'"-:;()&@#$%+=/*_<>[]{}\\|~^`'],
};
export const CHARSET = [...GROUPS.upper, ...GROUPS.lower, ...GROUPS.digits, ...GROUPS.punct];

export function groupOf(ch) {
  for (const [k, v] of Object.entries(GROUPS)) if (v.includes(ch)) return k;
  return 'punct';
}

const hex = c => c.toString(16).toUpperCase().padStart(4, '0');

/** Strokes for a char, falling back to the other case when allowed. */
export function strokesFor(glyphs, ch, settings) {
  const own = glyphs[ch];
  if (own && own.length) return { strokes: own, borrowed: false };
  if (!settings.fallbackCase) return { strokes: null, borrowed: false };
  const up = ch.toUpperCase(), lo = ch.toLowerCase();
  if (ch === lo && up !== lo && glyphs[up]?.length) {
    // small-caps: shrink capitals down to x-height, keeping the pen width
    const k = METRICS.xHeight / METRICS.capHeight;
    return { strokes: glyphs[up].map(st => ({ pts: st.pts.map(([x, y, p]) => [x * k, y * k, p]) })), borrowed: true, scaledFrom: glyphs[up] };
  }
  if (ch === up && up !== lo && glyphs[lo]?.length) return { strokes: glyphs[lo], borrowed: true };
  return { strokes: null, borrowed: false };
}

// Outline cache: unioning is the expensive part, so keep the result per glyph until its
// strokes (arrays are replaced, never mutated) or the shape-affecting settings change.
const cache = new Map();
const shapeKey = s => `${s.brush}|${s.weight}|${s.pressure}|${s.nibAngle}|${s.slant}`;

function glyphOutline(ch, glyphs, settings) {
  const { strokes, scaledFrom } = strokesFor(glyphs, ch, settings);
  if (!strokes) return null;
  const src = scaledFrom || strokes, key = shapeKey(settings);
  const hit = cache.get(ch);
  if (hit && hit.src === src && hit.key === key) return hit.out;
  const t = Math.tan((settings.slant || 0) * Math.PI / 180);
  const polys = outlinePolygons(strokes, settings, (x, y) => [x + y * t, y]);
  let min = Infinity, max = -Infinity;
  for (const p of polys) for (const [x] of p) { if (x < min) min = x; if (x > max) max = x; }
  const out = polys.length ? { cmds: smoothPath(polys), min, max } : null;
  cache.set(ch, { src, key, out });
  return out;
}

export function buildFont(glyphs, settings) {
  const sb = settings.spacing;
  const list = [
    new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 500, path: new opentype.Path() }),
    new opentype.Glyph({ name: 'space', unicode: 32, advanceWidth: Math.round(settings.wordSpace), path: new opentype.Path() }),
  ];
  let count = 0;
  for (const ch of CHARSET) {
    const o = glyphOutline(ch, glyphs, settings);
    if (!o) continue;
    const shift = sb - o.min;
    const path = new opentype.Path();
    const X = x => Math.round(x + shift), Y = y => Math.round(y);
    for (const c of o.cmds) {
      if (c[0] === 'M') path.moveTo(X(c[1]), Y(c[2]));
      else if (c[0] === 'L') path.lineTo(X(c[1]), Y(c[2]));
      else if (c[0] === 'C') path.curveTo(X(c[1]), Y(c[2]), X(c[3]), Y(c[4]), X(c[5]), Y(c[6]));
      else path.close();
    }
    const code = ch.charCodeAt(0);
    list.push(new opentype.Glyph({
      name: 'uni' + hex(code),
      unicode: code,
      advanceWidth: Math.max(1, Math.round(o.max - o.min + 2 * sb)),
      path,
    }));
    count++;
  }
  const family = (settings.name || 'My Handwriting').trim() || 'My Handwriting';
  const font = new opentype.Font({
    familyName: family,
    styleName: 'Regular',
    unitsPerEm: 1000,
    ascender: 900,
    descender: -300,
    designer: 'made with handwrite',
    description: 'Handwritten font drawn on screen with handwrite',
    version: '1.0',
    glyphs: list,
  });
  return { font, count, family };
}
