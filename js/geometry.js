// Stroke geometry shared by the on-screen pad, the thumbnails and the font exporter.
// Everything here lives in font units (1000 per em), y pointing UP like a real font.
//
// A stroke is a list of [x, y, pressure] points. Each pair of neighbouring points
// becomes a "capsule" (convex hull of two circles with pressure-dependent radii).
// Every capsule is emitted counter-clockwise, so with the nonzero fill rule their
// overlaps simply merge — no boolean path ops needed, and no self-intersection holes.

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

/** Radius (font units) for a point with pressure p in [0,1]. */
export function radiusFor(p, s) {
  const k = s.pressure; // 0 = ignore pressure, 1 = full effect
  return Math.max(2, (s.weight / 2) * ((1 - k) + k * (0.25 + 1.25 * p)));
}

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
  arc(cmds, cx, cy, r, 0, Math.PI * 2);
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
  arc(cmds, x2, y2, r2, s, e);                         // front cap
  cmds.push(['L', x1 + r1 * Math.cos(e), y1 + r1 * Math.sin(e)]);
  arc(cmds, x1, y1, r1, e, s + Math.PI * 2);            // back cap
  cmds.push(['Z']);
  return cmds;
}

/** Outline contours for one stroke. */
export function strokeContours(stroke, s) {
  const pts = stroke.pts, out = [];
  if (!pts || !pts.length) return out;
  if (pts.length === 1) {
    out.push(circle(pts[0][0], pts[0][1], radiusFor(pts[0][2], s)));
    return out;
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    out.push(capsule(a[0], a[1], radiusFor(a[2], s), b[0], b[1], radiusFor(b[2], s)));
  }
  return out;
}

export function glyphContours(strokes, s) {
  const out = [];
  for (const st of strokes || []) out.push(...strokeContours(st, s));
  return out;
}

/** Apply an affine point map to all contours. */
export function mapContours(contours, fn) {
  return contours.map(c => c.map(cmd => {
    if (cmd[0] === 'Z') return cmd;
    const o = [cmd[0]];
    for (let i = 1; i < cmd.length; i += 2) {
      const [x, y] = fn(cmd[i], cmd[i + 1]);
      o.push(x, y);
    }
    return o;
  }));
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

/** Horizontal extent of the inked glyph after a shear of x += y * t. */
export function glyphXExtent(strokes, s, t = 0) {
  let min = Infinity, max = -Infinity;
  const hwk = Math.sqrt(1 + t * t);
  for (const st of strokes || []) {
    for (const [x, y, p] of st.pts) {
      const cx = x + y * t, hw = radiusFor(p, s) * hwk;
      if (cx - hw < min) min = cx - hw;
      if (cx + hw > max) max = cx + hw;
    }
  }
  return min === Infinity ? null : { min, max };
}

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

/** Squared distance from a point to a stroke's centreline, minus its local radius. */
export function strokeDistance(stroke, s, x, y) {
  let best = Infinity;
  const pts = stroke.pts;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[i + 1] || a;
    const vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy;
    let t = l2 ? ((x - a[0]) * vx + (y - a[1]) * vy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - a[0] - t * vx, y - a[1] - t * vy) - radiusFor(a[2] + (b[2] - a[2]) * t, s);
    if (d < best) best = d;
  }
  return best;
}
