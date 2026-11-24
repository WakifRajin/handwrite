// Turns drawn strokes into an OpenType (CFF) font with opentype.js (global `opentype`).
import { glyphContours, glyphXExtent, mapContours, METRICS } from './geometry.js';

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
    return { strokes: glyphs[up].map(st => ({ pts: st.pts.map(([x, y, p]) => [x * k, y * k, p]) })), borrowed: true };
  }
  if (ch === up && up !== lo && glyphs[lo]?.length) return { strokes: glyphs[lo], borrowed: true };
  return { strokes: null, borrowed: false };
}

export function buildFont(glyphs, settings) {
  const t = Math.tan((settings.slant || 0) * Math.PI / 180);
  const sb = settings.spacing;
  const list = [
    new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 500, path: new opentype.Path() }),
    new opentype.Glyph({ name: 'space', unicode: 32, advanceWidth: Math.round(settings.wordSpace), path: new opentype.Path() }),
  ];
  let count = 0;
  for (const ch of CHARSET) {
    const { strokes } = strokesFor(glyphs, ch, settings);
    if (!strokes) continue;
    const ext = glyphXExtent(strokes, settings, t);
    if (!ext) continue;
    const shift = sb - ext.min;
    const contours = mapContours(glyphContours(strokes, settings), (x, y) => [Math.round(x + y * t + shift), Math.round(y)]);
    const path = new opentype.Path();
    for (const c of contours) {
      for (const cmd of c) {
        if (cmd[0] === 'M') path.moveTo(cmd[1], cmd[2]);
        else if (cmd[0] === 'L') path.lineTo(cmd[1], cmd[2]);
        else if (cmd[0] === 'C') path.curveTo(cmd[1], cmd[2], cmd[3], cmd[4], cmd[5], cmd[6]);
        else path.close();
      }
    }
    const code = ch.charCodeAt(0);
    list.push(new opentype.Glyph({
      name: 'uni' + hex(code),
      unicode: code,
      advanceWidth: Math.max(1, Math.round(ext.max - ext.min + 2 * sb)),
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
    glyphs: list,
  });
  return { font, count, family };
}
