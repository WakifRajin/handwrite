// Stroke geometry shared by the on-screen pad, the thumbnails and the font exporter.
// Everything here lives in font units (1000 per em), y pointing UP like a real font.
//
// A stroke is a list of [x, y, pressure] points (raw input; the brush is applied at
// render time, so switching brushes restyles the whole font). Each pair of neighbouring
// points becomes one convex piece — a "capsule" (hull of two circles) for round brushes,
// a hull of two nib rectangles for the chisel. Every piece is counter-clockwise, so on
// screen the nonzero fill rule merges overlaps for free. For the exported font the pieces
// are unioned into clean outlines (see outlinePath), because desktop font rasterizers
// (Windows especially) draw heavily overlapping contours with streaks and holes.

export const BOX = { left: 0, right: 1200, top: 950, bottom: -350 };
BOX.w = BOX.right - BOX.left;
BOX.h = BOX.top - BOX.bottom;

export const METRICS = { ascender: 760, capHeight: 700, xHeight: 460, baseline: 0, descender: -240 };

export const GUIDES = [
  { y: METRICS.ascender, label: 'ascender', kind: 'dot' },
  { y: METRICS.capHeight, label: 'caps', kind: 'light' },
  { y: METRICS.xHeight, label: 'x-height', kind: 'dash' },
  { y: METRICS.baseline, label: 'baseline', kind: 'base' },
  { y: METRICS.descender, label: 'descender', kind: 'dot' },
];

export const BRUSHES = {
  fineliner: { label: 'fineliner', icon: '🖊', hint: 'even line, ignores pressure' },
  marker: { label: 'marker', icon: '🖍', hint: 'round tip, a little pressure' },
  brush: { label: 'brush pen', icon: '🖌', hint: 'pressure-hungry, tapered ends' },
  chisel: { label: 'calligraphy', icon: '✒️', hint: 'flat nib: thick & thin by direction' },
};

/* ---------------- per-point sizes ---------------- */

const TAU = Math.PI * 2;

/** Radius of each point for round brushes. `live` = stroke still being drawn (no end taper yet). */
function pointRadii(pts, s, live) {
  const w = s.weight / 2, k = s.pressure, n = pts.length;
  const out = new Array(n);
  let cum = null, L = 0, T = 1;
  if (s.brush === 'brush') {
    cum = new Float64Array(n);
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    L = cum[n - 1];
    T = Math.max(30, s.weight * 1.6);
  }
  for (let i = 0; i < n; i++) {
    const p = pts[i][2];
    let r;
    if (s.brush === 'fineliner') r = w;
    else if (s.brush === 'brush') {
      const base = w * ((1 - k) * 0.75 + k * (0.08 + 1.6 * Math.pow(p, 1.5)));
      const t = Math.min(1, cum[i] / T, live ? 1 : (L - cum[i]) / T);
      r = n === 1 ? base : base * (0.12 + 0.88 * Math.sin(Math.max(0, t) * Math.PI / 2));
    } else r = w * ((1 - k) + k * (0.25 + 1.25 * p)); // marker
    out[i] = Math.max(1.5, r);
  }
  return out;
}

/** Rough half-width of the brush, for hit-testing and cursors. */
export function brushRadius(s, p = 0.5) {
  if (s.brush === 'chisel') return s.weight * 0.6;
  return pointRadii([[0, 0, p]], s, true)[0];
}

/* ---------------- primitive shapes ---------------- */

function arc(cmds, cx, cy, r, a0, a1) {
  const n = Math.max(1, Math.ceil((a1 - a0) / (Math.PI / 2) - 1e-9));
  const step = (a1 - a0) / n;
  const k = (4 / 3) * Math.tan(step / 4);
  for (let i = 0; i < n; i++) {
    const s = a0 + i * step, e = s + step;
    const cs = Math.cos(s), ss = Math.sin(s), ce = Math.cos(e), se = Math.sin(e);
    cmds.push(['C',
      cx + r * (cs - k * ss), cy + r * (ss + k * cs),
      cx + r * (ce + k * se), cy + r * (se - k * ce),
      cx + r * ce, cy + r * se]);
  }
}

function circle(cx, cy, r) {
  const cmds = [['M', cx + r, cy]];
  arc(cmds, cx, cy, r, 0, TAU);
  cmds.push(['Z']);
  return cmds;
}

function capsule(x1, y1, r1, x2, y2, r2) {
  const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy);
  if (d <= Math.abs(r1 - r2) + 1e-6) return r1 >= r2 ? circle(x1, y1, r1) : circle(x2, y2, r2);
  const th = Math.atan2(dy, dx);
  const al = Math.acos((r1 - r2) / d);
  const s = th - al, e = th + al;
  const cmds = [['M', x2 + r2 * Math.cos(s), y2 + r2 * Math.sin(s)]];
  arc(cmds, x2, y2, r2, s, e);                          // front cap
  cmds.push(['L', x1 + r1 * Math.cos(e), y1 + r1 * Math.sin(e)]);
  arc(cmds, x1, y1, r1, e, s + TAU);                    // back cap
  cmds.push(['Z']);
  return cmds;
}

/** Convex hull (monotone chain), counter-clockwise. */
function hull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

function polyCmds(poly) {
  const cmds = poly.map(([x, y], i) => [i ? 'L' : 'M', x, y]);
  cmds.push(['Z']);
  return cmds;
}

function nibCorners(pt, s, dot = false) {
  const k = s.pressure;
  const half = s.weight * 0.8 * ((1 - k) + k * (0.45 + 1.1 * pt[2]));
  const thin = dot ? half * 0.55 : Math.max(2, s.weight * 0.07); // a lone tap stamps a full nib mark
  const a = (s.nibAngle ?? 35) * Math.PI / 180;
  const ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
  const out = [];
  for (const sa of [-1, 1]) for (const sb of [-1, 1]) out.push([pt[0] + sa * half * ux + sb * thin * vx, pt[1] + sa * half * uy + sb * thin * vy]);
  return out;
}

/* ---------------- strokes -> contours ---------------- */

/**
 * Outline contours for one stroke. `from` lets the pad draw only the newest segments of
 * a stroke in progress (segments ending at index >= from).
 */
export function strokeContours(stroke, s, { live = false, from = 0 } = {}) {
  const pts = stroke.pts, out = [];
  if (!pts || !pts.length) return out;
  if (s.brush === 'chisel') {
    if (pts.length === 1) return [polyCmds(hull(nibCorners(pts[0], s, true)))];
    let prev = nibCorners(pts[Math.max(0, from - 1)], s);
    for (let i = Math.max(1, from); i < pts.length; i++) {
      const cur = nibCorners(pts[i], s);
      out.push(polyCmds(hull(prev.concat(cur))));
      prev = cur;
    }
    return out;
  }
  const r = pointRadii(pts, s, live);
  if (pts.length === 1) return [circle(pts[0][0], pts[0][1], r[0])];
  for (let i = Math.max(1, from); i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    out.push(capsule(a[0], a[1], r[i - 1], b[0], b[1], r[i]));
  }
  return out;
}

export function glyphContours(strokes, s) {
  const out = [];
  for (const st of strokes || []) out.push(...strokeContours(st, s));
  return out;
}

export function drawContours(ctx, contours, map) {
  ctx.beginPath();
  for (const c of contours) {
    for (const cmd of c) {
      if (cmd[0] === 'M') ctx.moveTo(...map(cmd[1], cmd[2]));
      else if (cmd[0] === 'L') ctx.lineTo(...map(cmd[1], cmd[2]));
      else if (cmd[0] === 'C') {
        const [a, b] = map(cmd[1], cmd[2]), [c2, d] = map(cmd[3], cmd[4]), [e, f] = map(cmd[5], cmd[6]);
        ctx.bezierCurveTo(a, b, c2, d, e, f);
      } else ctx.closePath();
    }
  }
  ctx.fill('nonzero');
}

const r1 = v => Math.round(v * 10) / 10;
/** SVG path data with y flipped (viewBox should be BOX.left, -BOX.top, BOX.w, BOX.h). */
export function contoursToSvg(contours) {
  let d = '';
  for (const c of contours) {
    for (const cmd of c) {
      if (cmd[0] === 'Z') { d += 'Z'; continue; }
      d += cmd[0];
      for (let i = 1; i < cmd.length; i += 2) d += r1(cmd[i]) + ' ' + r1(-cmd[i + 1]) + ' ';
    }
  }
  return d;
}

/* ---------------- export outlines: union + smoothing ---------------- */

function flatten(contour) {
  const out = [];
  let cx = 0, cy = 0;
  for (const cmd of contour) {
    if (cmd[0] === 'M' || cmd[0] === 'L') { cx = cmd[1]; cy = cmd[2]; out.push([cx, cy]); }
    else if (cmd[0] === 'C') {
      const [, x1, y1, x2, y2, x3, y3] = cmd;
      const len = Math.hypot(x1 - cx, y1 - cy) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2);
      const n = Math.max(2, Math.min(24, Math.ceil(len / 5)));
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        out.push([
          u * u * u * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
          u * u * u * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
        ]);
      }
      cx = x3; cy = y3;
    }
  }
  return out;
}

const area = poly => {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] - poly[i][0]) * (poly[j][1] + poly[i][1]);
  return a / 2; // > 0 for counter-clockwise with y up
};

/**
 * Union of all stroke pieces of a glyph -> non-overlapping polygons, outer contours
 * counter-clockwise (PostScript convention), holes clockwise. `xf` maps points (slant).
 */
export function outlinePolygons(strokes, s, xf = (x, y) => [x, y]) {
  const C = globalThis.ClipperLib;
  const SC = 16;
  const paths = [];
  for (const c of glyphContours(strokes, s)) {
    const poly = flatten(c);
    if (poly.length >= 3) paths.push(poly.map(([x, y]) => { const [X, Y] = xf(x, y); return { X: Math.round(X * SC), Y: Math.round(Y * SC) }; }));
  }
  if (!paths.length) return [];
  const clipper = new C.Clipper();
  clipper.AddPaths(paths, C.PolyType.ptSubject, true);
  const sol = new C.Paths();
  clipper.Execute(C.ClipType.ctUnion, sol, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  let polys = C.Clipper.CleanPolygons(sol, 0.8 * SC)
    .map(p => p.map(pt => [pt.X / SC, pt.Y / SC]))
    .filter(p => p.length >= 3 && Math.abs(area(p)) > 6);
  if (!polys.length) return polys;
  const biggest = polys.reduce((a, b) => (Math.abs(area(b)) > Math.abs(area(a)) ? b : a));
  if (area(biggest) < 0) polys = polys.map(p => p.reverse());
  return polys;
}

/**
 * Polygon -> smooth path commands. Runs of short edges (sampled curves) become quadratic
 * B-spline curves through edge midpoints (emitted as cubics); real corners stay sharp.
 */
export function smoothPath(polys) {
  const cmds = [];
  for (const P of polys) {
    const n = P.length;
    const len = i => Math.hypot(P[(i + 1) % n][0] - P[i][0], P[(i + 1) % n][1] - P[i][1]);
    const smooth = P.map((v, i) => {
      const a = P[(i - 1 + n) % n], b = P[(i + 1) % n];
      const l1 = len((i - 1 + n) % n), l2 = len(i);
      if (l1 > 18 || l2 > 18 || !l1 || !l2) return false;
      const cos = ((v[0] - a[0]) * (b[0] - v[0]) + (v[1] - a[1]) * (b[1] - v[1])) / (l1 * l2);
      return cos > 0.55; // turn of less than ~57°
    });
    const mid = i => { const a = P[(i - 1 + n) % n], b = P[i]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
    let cur = smooth[0] ? mid(0) : P[0];
    cmds.push(['M', cur[0], cur[1]]);
    for (let k = 0; k < n; k++) {
      const i = k % n;
      if (smooth[i]) {
        const m0 = mid(i), m1 = mid((i + 1) % n), q = P[i];
        if (m0[0] !== cur[0] || m0[1] !== cur[1]) cmds.push(['L', m0[0], m0[1]]);
        cmds.push(['C', m0[0] + 2 / 3 * (q[0] - m0[0]), m0[1] + 2 / 3 * (q[1] - m0[1]), m1[0] + 2 / 3 * (q[0] - m1[0]), m1[1] + 2 / 3 * (q[1] - m1[1]), m1[0], m1[1]]);
        cur = m1;
      } else if (k > 0 || !(cur[0] === P[i][0] && cur[1] === P[i][1])) {
        cmds.push(['L', P[i][0], P[i][1]]);
        cur = P[i];
      }
    }
    cmds.push(['Z']);
  }
  return cmds;
}

/* ---------------- misc ---------------- */

/** Ramer–Douglas–Peucker on (x, y, pressure*PW), keeping endpoints. */
export function simplify(pts, tol = 1.5) {
  if (pts.length < 3) return pts.slice();
  const PW = 60;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const a = pts[i0], b = pts[i1];
    const ax = a[0], ay = a[1], ap = a[2] * PW;
    const vx = b[0] - ax, vy = b[1] - ay, vp = b[2] * PW - ap;
    const len2 = vx * vx + vy * vy + vp * vp;
    let best = -1, bestD = tol * tol;
    for (let i = i0 + 1; i < i1; i++) {
      const q = pts[i];
      const wx = q[0] - ax, wy = q[1] - ay, wp = q[2] * PW - ap;
      let tt = len2 ? (wx * vx + wy * vy + wp * vp) / len2 : 0;
      tt = Math.max(0, Math.min(1, tt));
      const ex = wx - tt * vx, ey = wy - tt * vy, ep = wp - tt * vp;
      const dd = ex * ex + ey * ey + ep * ep;
      if (dd > bestD) { bestD = dd; best = i; }
    }
    if (best > 0) { keep[best] = 1; stack.push([i0, best], [best, i1]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Distance from a point to a stroke's centreline minus the brush half-width. */
export function strokeDistance(stroke, s, x, y) {
  let best = Infinity;
  const pts = stroke.pts, rr = brushRadius(s);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[i + 1] || a;
    const vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy;
    let t = l2 ? ((x - a[0]) * vx + (y - a[1]) * vy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - a[0] - t * vx, y - a[1] - t * vy) - rr;
    if (d < best) best = d;
  }
  return best;
}
