import { BOX, GUIDES, METRICS, glyphContours, strokeContours, drawContours, contoursToSvg, simplify, strokeDistance, radiusFor } from './geometry.js';
import { CHARSET, GROUPS, groupOf, buildFont, strokesFor } from './font.js';

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const STORE_KEY = 'handwrite:v1';

const DEFAULTS = {
  name: 'My Handwriting',
  weight: 48, pressure: 0.6, smoothing: 0.35,
  simPressure: true, palm: true, ghost: true,
  spacing: 50, wordSpace: 300, slant: 0, fallbackCase: true,
};

const state = {
  glyphs: {},               // char -> [{pts: [[x,y,p],...]}]
  settings: { ...DEFAULTS },
  current: 'A',
  tool: 'pen',
  filter: 'all',
};
const history = new Map();  // char -> {undo: [], redo: []}
const hist = ch => history.get(ch) || (history.set(ch, { undo: [], redo: [] }), history.get(ch));

/* ---------------- persistence ---------------- */
const round = (v, k) => Math.round(v * k) / k;
function serialize() {
  const glyphs = {};
  for (const [ch, strokes] of Object.entries(state.glyphs)) {
    if (strokes.length) glyphs[ch] = strokes.map(s => ({ pts: s.pts.map(([x, y, p]) => [round(x, 10), round(y, 10), round(p, 100)]) }));
  }
  return { app: 'handwrite', v: 1, settings: state.settings, glyphs };
}
function hydrate(data) {
  if (!data || typeof data !== 'object' || typeof data.glyphs !== 'object') throw new Error('not a handwrite project');
  const glyphs = {};
  for (const [ch, strokes] of Object.entries(data.glyphs)) {
    if (!CHARSET.includes(ch) || !Array.isArray(strokes)) continue;
    glyphs[ch] = strokes
      .filter(s => Array.isArray(s?.pts) && s.pts.length)
      .map(s => ({ pts: s.pts.filter(p => Array.isArray(p) && p.length >= 3 && p.every(Number.isFinite)).map(p => [p[0], p[1], p[2]]) }))
      .filter(s => s.pts.length);
  }
  state.glyphs = glyphs;
  state.settings = { ...DEFAULTS, ...(data.settings || {}) };
}
let saveTimer;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(serialize())); } catch { /* private mode / full */ }
  }, 300);
}
function loadSaved() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) hydrate(JSON.parse(raw));
  } catch { /* ignore */ }
}

/* ---------------- canvas pad ---------------- */
const pad = $('#pad');
const ctx = pad.getContext('2d');
let scale = 1, dpr = 1;
const toPx = (x, y) => [(x - BOX.left) * scale, (BOX.top - y) * scale];
const toUnits = (px, py) => [px / scale + BOX.left, BOX.top - py / scale];

function resizePad() {
  const rect = pad.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1;
  pad.width = Math.round(rect.width * dpr);
  pad.height = Math.round(rect.width * dpr * BOX.h / BOX.w);
  scale = pad.width / BOX.w;
  render();
}

const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
let live = null;      // stroke in progress {pts}
let hover = null;     // [x, y] in units while a pen hovers
let erasing = false;

function render() {
  const W = pad.width, H = pad.height;
  ctx.clearRect(0, 0, W, H);
  const guide = css('--guide'), guideStrong = css('--guide-strong'), ink = css('--ink'), ghost = css('--ghost');

  // guide lines
  ctx.save();
  ctx.font = `${Math.round(13 * dpr)}px "Patrick Hand", sans-serif`;
  ctx.textBaseline = 'bottom';
  for (const g of GUIDES) {
    const [, y] = toPx(0, g.y);
    ctx.beginPath();
    ctx.lineWidth = (g.kind === 'base' ? 2.5 : 1.25) * dpr;
    ctx.strokeStyle = g.kind === 'base' ? guideStrong : guide;
    ctx.setLineDash(g.kind === 'dash' ? [10 * dpr, 8 * dpr] : g.kind === 'dot' ? [2 * dpr, 7 * dpr] : []);
    ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    ctx.fillStyle = g.kind === 'base' ? guideStrong : guide;
    ctx.fillText(g.label, 8 * dpr, y - 3 * dpr);
  }
  ctx.restore();

  // ghost letter
  if (state.settings.ghost) {
    ctx.save();
    ctx.fillStyle = ghost;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `${Math.round(1000 * scale)}px "Patrick Hand", cursive`;
    const [cx, by] = toPx(BOX.w / 2, METRICS.baseline);
    ctx.fillText(state.current, cx, by);
    ctx.restore();
  }

  // strokes
  const own = state.glyphs[state.current] || [];
  const s = state.settings;
  const { strokes, borrowed } = own.length ? { strokes: own, borrowed: false } : strokesFor(state.glyphs, state.current, s);
  $('#borrowedTag').hidden = !(borrowed && !live);
  ctx.fillStyle = borrowed ? ghost : ink;
  if (strokes && !(borrowed && live)) drawContours(ctx, glyphContours(strokes, s), toPx);
  if (live) { ctx.fillStyle = ink; drawContours(ctx, strokeContours(live, s), toPx); }

  // hover cursor for pens / eraser
  if (hover && !live) {
    const [hx, hy] = toPx(hover[0], hover[1]);
    ctx.beginPath();
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = erasing || state.tool === 'eraser' ? css('--warn') : guideStrong;
    const r = (erasing || state.tool === 'eraser' ? ERASER_R : radiusFor(0.5, s)) * scale;
    ctx.arc(hx, hy, Math.max(3 * dpr, r), 0, Math.PI * 2);
    ctx.stroke();
  }
}
let raf = 0;
const requestRender = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };

/* ---------------- pointer input ---------------- */
const ERASER_R = 40;
let activeId = null, penSeen = false, lastT = 0, lastP = 0.6, eraseSnapshot = null;
const hint = $('#inputHint');

function setHint(e, p) {
  const type = e.pointerType === 'pen' ? '🖊 pen' : e.pointerType === 'touch' ? '👆 finger' : '🖱 mouse';
  const pr = e.pointerType === 'pen' ? `pressure ${p.toFixed(2)}` : state.settings.simPressure ? 'speed → pressure' : 'no pressure';
  const btn = e.pointerType === 'pen' && e.buttons > 1 ? ` · button ${e.buttons}` : '';
  hint.textContent = `${type} · ${pr}${btn}${erasing ? ' · erasing' : ''}${penSeen && state.settings.palm ? ' · palm rejection on' : ''}`;
}

function eventUnits(e) {
  const r = pad.getBoundingClientRect();
  return toUnits((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr);
}

function pressureOf(e, x, y) {
  if (e.pointerType === 'pen') return e.pressure > 0 ? e.pressure : 0.5;
  if (!state.settings.simPressure) return 0.5;
  const prev = live?.pts[live.pts.length - 1];
  const now = e.timeStamp;
  if (!prev) { lastT = now; lastP = 0.6; return lastP; }
  const dt = Math.max(1, now - lastT);
  const v = Math.hypot(x - prev[0], y - prev[1]) / dt; // units / ms
  const target = Math.min(1, Math.max(0.2, 1.05 - v * 0.3));
  lastT = now;
  lastP = lastP * 0.75 + target * 0.25;
  return lastP;
}

function addPoint(e) {
  let [x, y] = eventUnits(e);
  const p = pressureOf(e, x, y);
  const pts = live.pts;
  const prev = pts[pts.length - 1];
  if (prev) {
    const k = 1 - state.settings.smoothing;
    x = prev[0] + (x - prev[0]) * k;
    y = prev[1] + (y - prev[1]) * k;
    if (Math.hypot(x - prev[0], y - prev[1]) < 1.5) { prev[2] = Math.max(prev[2], p); return; }
  }
  pts.push([x, y, p]);
  setHint(e, p);
}

function eraseAt(e) {
  const [x, y] = eventUnits(e);
  const strokes = state.glyphs[state.current] || [];
  const keep = strokes.filter(st => strokeDistance(st, state.settings, x, y) > ERASER_R);
  if (keep.length !== strokes.length) {
    if (!eraseSnapshot) eraseSnapshot = strokes.slice();
    state.glyphs[state.current] = keep;
  }
  hover = [x, y];
}

// Eraser: the eraser tip (Wacom/Surface/Windows Ink report buttons 32 / button 5), or a
// side/barrel button (S Pen side button arrives as the secondary button: buttons 2 / button 2).
// Right-dragging with a mouse erases too. Checked on every move, so pressing the S Pen
// button mid-stroke switches to erasing right away.
const isEraserEvent = e => !!((e.buttons & 32) || e.button === 5 ||
  (e.pointerType !== 'touch' && ((e.buttons & 2) || e.button === 2)));

function startErasing(e) {
  live = null;
  erasing = true;
  eraseSnapshot = null;
  eraseAt(e);
  setHint(e, 0);
}

/* ---------------- palm guard ----------------
   While a pen is drawing or hovering nearby (and for a moment after), touches are palms:
   block them from scrolling the page, zooming, or tapping buttons. */
const PEN_GRACE_MS = 1500;
let lastPenAt = -Infinity, penNearTimer = 0;
const palmGuardOn = () => state.settings.palm && penSeen;
const penNear = () => activeId !== null || performance.now() - lastPenAt < PEN_GRACE_MS;
function notePen() {
  lastPenAt = performance.now();
  if (!penSeen) { penSeen = true; document.documentElement.classList.toggle('pen-mode', state.settings.palm); }
  if (!state.settings.palm) return;
  document.documentElement.classList.add('pen-near');
  clearTimeout(penNearTimer);
  penNearTimer = setTimeout(() => { if (activeId === null) document.documentElement.classList.remove('pen-near'); }, PEN_GRACE_MS);
}
for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
  document.addEventListener(type, e => { if (e.pointerType === 'pen') notePen(); }, { capture: true, passive: true });
}
const blockPalm = e => { if (palmGuardOn() && penNear() && e.cancelable) e.preventDefault(); };
document.addEventListener('touchstart', blockPalm, { passive: false });
document.addEventListener('touchmove', blockPalm, { passive: false });
document.addEventListener('contextmenu', e => { if (palmGuardOn() && penNear()) e.preventDefault(); });

pad.addEventListener('pointerdown', e => {
  if (e.pointerType === 'pen') notePen();
  if (e.pointerType === 'touch' && palmGuardOn()) { hint.textContent = '✋ ignored a finger/palm (palm rejection on)'; return; }
  if (activeId !== null) return;
  if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
  e.preventDefault();
  activeId = e.pointerId;
  try { pad.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
  if (state.tool === 'eraser' || isEraserEvent(e)) { startErasing(e); requestRender(); return; }
  erasing = false;
  live = { pts: [] };
  addPoint(e);
  requestRender();
});

pad.addEventListener('pointermove', e => {
  if (activeId === null) {
    if (e.pointerType !== 'touch') { hover = eventUnits(e); requestRender(); }
    return;
  }
  if (e.pointerId !== activeId) return;
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of (events.length ? events : [e])) {
    if (!erasing && isEraserEvent(ev)) startErasing(ev); // side button pressed mid-stroke
    else if (erasing) eraseAt(ev);
    else if (live) addPoint(ev);
  }
  requestRender();
});

function endStroke(e) {
  if (e.pointerId !== activeId) return;
  activeId = null;
  if (e.pointerType === 'pen') notePen(); // restart the palm grace timer from lift-off
  if (erasing) {
    erasing = false;
    if (eraseSnapshot) commit(eraseSnapshot);
    eraseSnapshot = null;
  } else if (live) {
    // land exactly where the pen lifted, so smoothing lag doesn't shorten strokes
    const [x, y] = eventUnits(e);
    const last = live.pts[live.pts.length - 1];
    if (last && e.type === 'pointerup' && Math.hypot(x - last[0], y - last[1]) > 1.5) live.pts.push([x, y, last[2]]);
    const stroke = { pts: simplify(live.pts, 1.2) };
    live = null;
    const before = state.glyphs[state.current] || [];
    state.glyphs[state.current] = [...before, stroke];
    commit(before);
  }
  requestRender();
}
pad.addEventListener('pointerup', endStroke);
pad.addEventListener('pointercancel', endStroke);
pad.addEventListener('pointerleave', e => { if (activeId === null) { hover = null; requestRender(); } });
pad.addEventListener('contextmenu', e => e.preventDefault());

/** Record that the current glyph changed from `before`. */
function commit(before) {
  const h = hist(state.current);
  h.undo.push(before);
  if (h.undo.length > 100) h.undo.shift();
  h.redo.length = 0;
  glyphChanged();
}
function glyphChanged() {
  updateThumb(state.current);
  if (state.settings.fallbackCase) {
    const o = state.current === state.current.toUpperCase() ? state.current.toLowerCase() : state.current.toUpperCase();
    if (o !== state.current) updateThumb(o);
  }
  updateProgress();
  updateUndoButtons();
  scheduleSave();
  schedulePreview();
}
function undo() {
  const h = hist(state.current);
  if (!h.undo.length) return;
  h.redo.push(state.glyphs[state.current] || []);
  state.glyphs[state.current] = h.undo.pop();
  glyphChanged(); requestRender();
}
function redo() {
  const h = hist(state.current);
  if (!h.redo.length) return;
  h.undo.push(state.glyphs[state.current] || []);
  state.glyphs[state.current] = h.redo.pop();
  glyphChanged(); requestRender();
}
function clearGlyph() {
  const before = state.glyphs[state.current] || [];
  if (!before.length) return;
  state.glyphs[state.current] = [];
  commit(before);
  requestRender();
  toast(`cleared "${state.current}" — undo brings it back`);
}
function updateUndoButtons() {
  const h = hist(state.current);
  $('#undoBtn').disabled = !h.undo.length;
  $('#redoBtn').disabled = !h.redo.length;
}

/* ---------------- glyph grid ---------------- */
const grid = $('#grid');
const cells = new Map();
const GROUP_NAMES = { upper: 'uppercase', lower: 'lowercase', digits: 'digit', punct: 'symbol' };

function buildGrid() {
  grid.innerHTML = '';
  for (const ch of CHARSET) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cell';
    b.dataset.char = ch;
    b.dataset.group = groupOf(ch);
    b.title = `draw "${ch}"`;
    b.setAttribute('aria-label', `draw ${ch}`);
    b.innerHTML = `<span class="cell-label"></span><svg viewBox="${BOX.left} ${-BOX.top} ${BOX.w} ${BOX.h}" aria-hidden="true"><line class="cell-base" x1="0" x2="${BOX.w}" y1="0" y2="0"/><path/></svg>`;
    b.querySelector('.cell-label').textContent = ch;
    b.addEventListener('click', () => {
      select(ch);
      const r = pad.getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight) pad.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    grid.appendChild(b);
    cells.set(ch, b);
  }
  CHARSET.forEach(updateThumb);
}
function updateThumb(ch) {
  const cell = cells.get(ch);
  if (!cell) return;
  const own = state.glyphs[ch];
  const has = !!(own && own.length);
  const { strokes, borrowed } = has ? { strokes: own, borrowed: false } : strokesFor(state.glyphs, ch, state.settings);
  cell.querySelector('path').setAttribute('d', strokes ? contoursToSvg(glyphContours(strokes, state.settings)) : '');
  cell.classList.toggle('done', has);
  cell.classList.toggle('borrowed', !has && borrowed);
}
function applyFilter() {
  for (const cell of cells.values()) cell.hidden = state.filter !== 'all' && cell.dataset.group !== state.filter;
  $$('.filters .chip').forEach(c => c.classList.toggle('active', c.dataset.filter === state.filter));
}
function updateProgress() {
  const n = CHARSET.filter(ch => state.glyphs[ch]?.length).length;
  $('#progressText').textContent = `${n} / ${CHARSET.length} drawn`;
  $('#progressFill').style.width = `${(n / CHARSET.length) * 100}%`;
  const cheer = n === 0 ? '' : n < 10 ? 'nice start!' : n < 26 ? 'keep going ✨' : n < 52 ? 'look at you go!' : n < CHARSET.length ? 'almost a whole font!' : 'all done!! 🎉';
  $('#progressCheer').textContent = cheer;
  $('#downloadHint').textContent = n ? `${n} glyph${n === 1 ? '' : 's'} ready${state.settings.fallbackCase ? ' (+ borrowed case swaps)' : ''}` : 'draw at least one letter first!';
  $('#downloadBtn').disabled = n === 0;
}

function select(ch) {
  if (live) return;
  state.current = ch;
  $('#currentChar').textContent = ch;
  const code = ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
  $('#currentMeta').textContent = `${GROUP_NAMES[groupOf(ch)]} · U+${code}`;
  for (const [c, cell] of cells) cell.classList.toggle('current', c === ch);
  const cell = cells.get(ch);
  if (cell && !cell.hidden) { // scroll only the grid, never the page
    const top = cell.offsetTop, bottom = top + cell.offsetHeight;
    if (top < grid.scrollTop) grid.scrollTop = top - 6;
    else if (bottom > grid.scrollTop + grid.clientHeight) grid.scrollTop = bottom - grid.clientHeight + 6;
    const left = cell.offsetLeft, right = left + cell.offsetWidth; // horizontal strip (portrait tablets)
    if (left < grid.scrollLeft) grid.scrollLeft = left - 6;
    else if (right > grid.scrollLeft + grid.clientWidth) grid.scrollLeft = right - grid.clientWidth + 6;
  }
  updateUndoButtons();
  requestRender();
}
function step(dir) {
  const list = state.filter === 'all' ? CHARSET : GROUPS[state.filter];
  let i = list.indexOf(state.current);
  if (i < 0) i = dir > 0 ? -1 : 0;
  select(list[(i + dir + list.length) % list.length]);
}
function nextEmpty() {
  const i = CHARSET.indexOf(state.current);
  for (let k = 1; k <= CHARSET.length; k++) {
    const ch = CHARSET[(i + k) % CHARSET.length];
    if (!state.glyphs[ch]?.length) return select(ch);
  }
  toast('every single character is drawn. legend. 🏆');
}

/* ---------------- live font preview ---------------- */
let previewTimer, previewSeq = 0, currentFace = null;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(refreshPreview, 350);
}
async function refreshPreview() {
  if (!window.opentype) return schedulePreview();
  const { font, count } = buildFont(state.glyphs, state.settings);
  const root = document.documentElement;
  if (!count) {
    if (currentFace) document.fonts.delete(currentFace);
    currentFace = null;
    root.style.removeProperty('--yours');
    return;
  }
  try {
    const fam = `hw-preview-${++previewSeq}`;
    const face = new FontFace(fam, font.toArrayBuffer());
    await face.load();
    if (fam !== `hw-preview-${previewSeq}`) return; // a newer build won
    document.fonts.add(face);
    if (currentFace) document.fonts.delete(currentFace);
    currentFace = face;
    root.style.setProperty('--yours', `"${fam}"`);
  } catch (err) {
    console.error('preview font failed', err);
  }
}

function download() {
  const { font, count, family } = buildFont(state.glyphs, state.settings);
  if (!count) return toast('draw a letter or two first ✏️');
  const blob = new Blob([font.toArrayBuffer()], { type: 'font/otf' });
  const fname = family.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'handwriting';
  saveBlob(blob, `${fname}.otf`);
  toast(`saved ${fname}.otf — double-click it to install 🎉`);
}
function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------------- settings & UI wiring ---------------- */
const fmt = {
  weight: v => `${v}`, pressure: v => `${Math.round(v * 100)}%`, smoothing: v => `${Math.round(v * 100)}%`,
  spacing: v => `${v}`, wordSpace: v => `${v}`, slant: v => `${v}°`,
};
function syncControls() {
  const s = state.settings;
  for (const k of Object.keys(fmt)) {
    $('#' + k).value = s[k];
    $('#' + k + 'Out').textContent = fmt[k](s[k]);
  }
  for (const k of ['simPressure', 'palm', 'ghost', 'fallbackCase']) $('#' + k).checked = !!s[k];
  $('#fontName').value = s.name;
}
function onSettingChange(key, { thumbs = false, preview = true } = {}) {
  if (thumbs) CHARSET.forEach(updateThumb);
  if (key === 'fallbackCase') updateProgress();
  requestRender();
  scheduleSave();
  if (preview) schedulePreview();
}
function wireSettings() {
  const affectsShape = new Set(['weight', 'pressure']);
  for (const k of Object.keys(fmt)) {
    $('#' + k).addEventListener('input', e => {
      state.settings[k] = parseFloat(e.target.value);
      $('#' + k + 'Out').textContent = fmt[k](state.settings[k]);
      onSettingChange(k, { thumbs: affectsShape.has(k), preview: k !== 'smoothing' });
    });
  }
  for (const k of ['simPressure', 'palm', 'ghost', 'fallbackCase']) {
    $('#' + k).addEventListener('change', e => {
      state.settings[k] = e.target.checked;
      if (k === 'palm') document.documentElement.classList.toggle('pen-mode', penSeen && e.target.checked);
      onSettingChange(k, { thumbs: k === 'fallbackCase', preview: k === 'fallbackCase' });
    });
  }
  $('#fontName').addEventListener('input', e => { state.settings.name = e.target.value; scheduleSave(); });
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

function setTheme(theme, persist = true) {
  document.documentElement.dataset.theme = theme;
  $('#themeToggle').textContent = theme === 'dark' ? '📄 notebook' : '🌙 chalkboard';
  $('meta[name="theme-color"]').content = theme === 'dark' ? '#23302a' : '#fbf6e9';
  if (persist) try { localStorage.setItem('handwrite:theme', theme); } catch { /* ignore */ }
  requestRender();
}
function currentTheme() {
  const t = document.documentElement.dataset.theme;
  if (t) return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function wireUI() {
  $('#prevBtn').addEventListener('click', () => step(-1));
  $('#nextBtn').addEventListener('click', () => step(1));
  $('#undoBtn').addEventListener('click', undo);
  $('#redoBtn').addEventListener('click', redo);
  $('#clearBtn').addEventListener('click', clearGlyph);
  $('#nextEmptyBtn').addEventListener('click', nextEmpty);
  $$('.tool').forEach(b => b.addEventListener('click', () => {
    state.tool = b.dataset.tool;
    $$('.tool').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', x === b); });
    pad.classList.toggle('erasing', state.tool === 'eraser');
  }));
  $$('.filters .chip').forEach(c => c.addEventListener('click', () => { state.filter = c.dataset.filter; applyFilter(); }));

  const tester = $('#tester');
  const size = $('#testSize');
  const applySize = () => { tester.style.fontSize = size.value + 'px'; $('#sizeOut').textContent = size.value + 'px'; };
  size.addEventListener('input', applySize); applySize();
  $$('[data-sample]').forEach(b => b.addEventListener('click', () => { tester.value = b.dataset.sample; }));

  $('#downloadBtn').addEventListener('click', download);
  $('#saveBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(serialize())], { type: 'application/json' });
    saveBlob(blob, `${(state.settings.name || 'handwriting').replace(/[^\w\-]+/g, '-')}.handwrite.json`);
    toast('project saved 💾');
  });
  $('#loadInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      hydrate(JSON.parse(await file.text()));
      history.clear();
      afterLoad();
      toast(`opened ${file.name} 📂`);
    } catch (err) {
      toast("hmm, that file doesn't look like a handwrite project 🤔");
    }
  });
  $('#resetBtn').addEventListener('click', () => {
    if (!confirm('erase every letter and start fresh? (save a project file first if you want to keep it)')) return;
    state.glyphs = {};
    state.settings = { ...DEFAULTS };
    history.clear();
    afterLoad();
    toast('fresh page! ✨');
  });

  $('#themeToggle').addEventListener('click', () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark'));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', requestRender);

  document.addEventListener('keydown', e => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod || e.altKey) return;
    if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); step(1); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); return; }
    if (e.key.length === 1 && CHARSET.includes(e.key)) { e.preventDefault(); select(e.key); }
  });

  new ResizeObserver(resizePad).observe(pad);
}

function afterLoad() {
  syncControls();
  CHARSET.forEach(updateThumb);
  updateProgress();
  select(state.current);
  scheduleSave();
  schedulePreview();
}

/* ---------------- boot ---------------- */
try { const t = localStorage.getItem('handwrite:theme'); if (t) document.documentElement.dataset.theme = t; } catch { /* ignore */ }
loadSaved();
buildGrid();
applyFilter();
wireSettings();
wireUI();
setTheme(currentTheme(), false);
resizePad();
afterLoad();
document.fonts.ready.then(requestRender);
window.addEventListener('load', schedulePreview);

// handy for debugging from the console
window.handwrite = { state, buildFont: () => buildFont(state.glyphs, state.settings) };
