// Builds the city map data in index.html (the <script type="application/json" id="mapData"> line) from TEAMS.
// Run from this folder after changing a team's city, state or lonLat, or adding a team:
//   npm install && node build.mjs
// Two views, both 868x548 units: "us" (lower 48 states with Canada and Mexico) for US teams, and "lakes"
// (a close-up of the Great Lakes with a North America inset) for teams outside the USA (the Raptors).
// For each team it lays out every team's logo with that team's logo bigger, a city-name pill, and the
// state name (inside the state, or beside it with a line when it doesn't fit), then checks nothing overlaps.
import * as d3 from 'd3-geo';
import * as topojson from 'topojson-client';
import { presimplify, simplify, sphericalTriangleArea } from 'topojson-simplify';
import polylabel from 'polylabel';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.join(HERE, '..', '..', 'index.html');
const R = p => JSON.parse(fs.readFileSync(path.join(HERE, p), 'utf8'));
const W = 868, H = 548;

const html = fs.readFileSync(INDEX, 'utf8');
const app = html.slice(html.indexOf('var TEAMS = ['));
const TEAMS = (0, eval)(app.slice('var TEAMS = '.length, app.indexOf('];') + 1));

// drop outline points worth under ~half a pixel at this map's scale (1 px is about 5 km; area in steradians)
const us = simplify(presimplify(R('node_modules/us-atlas/states-10m.json'), sphericalTriangleArea), 3e-7);
const world = R('node_modules/world-atlas/countries-50m.json');
const world110 = R('node_modules/world-atlas/countries-110m.json');
const lakes = R('data/lakes.json').features;
const WID = R('data/widths.json');   // advance widths (em) of the app's fonts, measured from the font files

const SKIP = new Set(['02', '15', '60', '66', '69', '72', '78']);   // Alaska, Hawaii, territories
const states = topojson.feature(us, us.objects.states).features.filter(f => !SKIP.has(f.id));
const lower48 = { type: 'FeatureCollection', features: states };
const countries = topojson.feature(world, world.objects.countries).features;
const others = countries.filter(f => f.id !== '840');
const canada = countries.find(f => f.id === '124');
const GREAT = ['Lake Superior', 'Lake Michigan', 'Lake Huron', 'Lake Erie', 'Lake Ontario'];
const FC = features => ({ type: 'FeatureCollection', features });
const stateBy = n => states.find(f => f.properties.name === n);

// ---------- geometry and text helpers ----------
const r1 = v => Math.round(v * 10) / 10;
const ri = v => Math.round(v);
function textW(s, font, px, lsEm = 0) { const t = WID[font]; let w = 0; for (const c of s) w += (t[c] ?? t.M) * px + lsEm * px; return w; }
function block(text, font, px, lsEm, lh = 1.15) { const lines = text.split('\n'); return { w: Math.max(...lines.map(l => textW(l, font, px, lsEm))), h: lines.length * px * lh }; }
function ringArea(r) { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(a / 2); }
function projPolys(p, f) { const g = f.geometry; return (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map(poly => poly.map(ring => ring.map(c => p(c)))); }
function largest(polys) { return polys.reduce((b, q) => ringArea(q[0]) > ringArea(b[0]) ? q : b); }
const clipPoly = poly => poly.map(ring => ring.map(([x, y]) => [Math.min(W, Math.max(0, x)), Math.min(H, Math.max(0, y))]));
function spanAt(poly, x, y) {
  const xs = [];
  for (const ring of poly) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[j], [x2, y2] = ring[i];
    if ((y1 > y) !== (y2 > y)) xs.push(x1 + (y - y1) * (x2 - x1) / (y2 - y1));
  }
  xs.sort((a, b) => a - b);
  for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k] <= x && x <= xs[k + 1]) return [xs[k], xs[k + 1]];
  return [x, x];
}
function room(poly, x, y, h) { let half = Infinity; for (const dy of [-h / 2, -h / 4, 0, h / 4, h / 2]) { const [l, r] = spanAt(poly, x, y + dy); half = Math.min(half, x - l, r - x); } return 2 * half; }
const box = (x0, y0, w, h) => ({ x0, y0, x1: x0 + w, y1: y0 + h });
const hit = (a, b, pad = 2) => a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.y0 < b.y1 + pad && b.y0 < a.y1 + pad;
function overlap(a, b) { const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0); return w > 0 && h > 0 ? w * h : 0; }
const inMap = (b, m = 4) => b.x0 >= m && b.y0 >= m && b.x1 <= W - m && b.y1 <= H - m;

// where a name fits inside a shape (one line, then two), nearest the shape's visual centre, clear of boxes;
// `spill` lets it run that many units past the border (the app draws such names with an outline)
function placeInside(name, poly, { font, px, ls, sizes = [px], spill = 0 }, boxes) {
  const [cx, cy] = polylabel(poly, 0.5);
  const up = name.toUpperCase(), words = up.split(' '), opts = [up];
  if (words.length > 1) {
    let best = null;
    for (let k = 1; k < words.length; k++) { const t = words.slice(0, k).join(' ') + '\n' + words.slice(k).join(' '); const w = block(t, font, px, ls).w; if (!best || w < best.w) best = { t, w }; }
    opts.push(best.t);
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const ring of poly) for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  for (const t of opts) for (const s of sizes) {
    const b = block(t, font, s, ls); let best = null;
    for (let y = Math.max(y0, 4 + b.h / 2); y <= Math.min(y1, H - 4 - b.h / 2); y += 2)
      for (let x = Math.max(x0, 4 + b.w / 2); x <= Math.min(x1, W - 4 - b.w / 2); x += 2) {
        if (b.w + 6 > room(poly, x, y, b.h) + spill) continue;
        const bx = box(x - b.w / 2, y - b.h / 2, b.w, b.h);
        if (boxes.some(o => hit(o, bx, 3))) continue;
        const d = Math.hypot(x - cx, y - cy); if (!best || d < best.d) best = { d, x, y, bx };
      }
    if (best) return { t, s, x: r1(best.x), y: r1(best.y), box: best.bx };
  }
  return null;
}
// a free spot for a label of size w x h near (px, py), clear of boxes; with a region grid, open water
// counts as nearer than land, so such names go out to sea where they read best
function placeNear(px, py, w, h, boxes, minDist = 0, G = null, maxDist = Infinity) {
  let best = null;
  for (let y = 6 + h / 2; y <= H - 6 - h / 2; y += 3) for (let x = 6 + w / 2; x <= W - 6 - w / 2; x += 3) {
    const raw = Math.hypot(x - px, y - py); if (raw < minDist || raw > maxDist) continue;
    // every point of the label over land (centre, ends, corners) counts against the spot; sea and lakes don't
    const land = G ? [[x, y], [x - w / 2, y], [x + w / 2, y], [x - w / 2, y - h / 2], [x + w / 2, y - h / 2], [x - w / 2, y + h / 2], [x + w / 2, y + h / 2]]
      .filter(([qx, qy]) => { const v = G.at(qx, qy); return v !== 'w' && v !== 'L'; }).length : 0;
    const d = raw + land * 12; if (best && d >= best.d) continue;
    const bx = box(x - w / 2, y - h / 2, w, h); if (boxes.some(o => hit(o, bx, 4))) continue;
    best = { d, x, y, bx };
  }
  return best || (maxDist < Infinity ? placeNear(px, py, w, h, boxes, minDist, G) : null);
}
// what is under each point: 'w' water, 'L' lake, 's:<state>', 'c:<country id>'
function regionGrid(p, step = 6) {
  const cols = Math.ceil(W / step), rows = Math.ceil(H / step), g = new Array(cols * rows);
  const wrap = fs_ => fs_.map(f => ({ f, b: d3.geoBounds(f) }));
  const sb = wrap(states), ob = wrap(others), lb = wrap(lakes);
  const inB = (b, ll) => ll[0] >= b[0][0] - .01 && ll[0] <= b[1][0] + .01 && ll[1] >= b[0][1] - .01 && ll[1] <= b[1][1] + .01;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const ll = p.invert([c * step + step / 2, r * step + step / 2]); let v = 'w';
    if (ll) {
      if (lb.some(o => inB(o.b, ll) && d3.geoContains(o.f, ll))) v = 'L';
      else { const s = sb.find(o => inB(o.b, ll) && d3.geoContains(o.f, ll)); if (s) v = 's:' + s.f.properties.name;
        else { const o = ob.find(o => inB(o.b, ll) && d3.geoContains(o.f, ll)); if (o) v = 'c:' + o.f.id; } }
    }
    g[r * cols + c] = v;
  }
  return { at(x, y) { const c = Math.floor(x / step), r = Math.floor(y / step); return c < 0 || r < 0 || c >= cols || r >= rows ? 'x' : g[r * cols + c]; } };
}
// the spot deepest inside a region where a w x h label fits, clear of boxes, nudged towards `prefer`
function placeInRegion(G, ok, w, h, boxes, prefer) {
  let best = null;
  for (let y = h / 2 + 6; y < H - h / 2 - 6; y += 3) for (let x = w / 2 + 6; x < W - w / 2 - 6; x += 3) {
    const b = box(x - w / 2, y - h / 2, w, h);
    if (boxes.some(a => hit(a, b, 4))) continue;
    let fits = true;
    for (let yy = b.y0; yy <= b.y1 && fits; yy += 3) for (let xx = b.x0; xx <= b.x1 && fits; xx += 3) if (!ok(G.at(xx, yy))) fits = false;
    if (!fits) continue;
    let clear = 0;
    for (let m = 3; m < 60; m += 3) {
      const e = [[b.x0 - m, y], [b.x1 + m, y], [x, b.y0 - m], [x, b.y1 + m]];
      if (e.some(([ex, ey]) => !ok(G.at(ex, ey)))) break; clear = m;
    }
    const score = clear - Math.hypot(x - prefer[0], y - prefer[1]) * 0.15;
    if (!best || score > best.score) best = { x, y, score, b };
  }
  return best;
}
// logos: every team's bubble on its city, pushed apart until none overlap; `focus` is bigger and moves least.
// No logo may sit on a box in `blocks`; the focus logo also keeps off `focusBlocks` (a small state it would hide).
const R_SMALL = 17, R_BIG = 27;
function pushOut(a, k) {
  if (!(a.x + a.r > k.x0 && a.x - a.r < k.x1 && a.y + a.r > k.y0 && a.y - a.r < k.y1)) return;
  const moves = [[k.x1 + a.r - a.x, 0], [k.x0 - a.r - a.x, 0], [0, k.y1 + a.r - a.y], [0, k.y0 - a.r - a.y]];
  const [dx, dy] = moves.reduce((b, m) => Math.hypot(...m) < Math.hypot(...b) ? m : b);
  a.x += dx; a.y += dy;
}
function layoutLogos(anchors, focus, blocks = [], focusBlocks = []) {
  const items = anchors.map(a => ({ ...a, x: a.x, y: a.y, r: a.nick === focus ? R_BIG : R_SMALL }));
  const groups = {};
  for (const it of items) (groups[it.x + ',' + it.y] = groups[it.x + ',' + it.y] || []).push(it);
  for (const g of Object.values(groups)) g.forEach((it, k) => { it.x += (k - (g.length - 1) / 2) * 28; });
  for (let n = 0; n < 800; n++) {
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j]; let dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy) || .01, min = a.r + b.r + 4;
      if (d < min) {
        const push = (min - d) / 2; dx /= d; dy /= d;
        const wa = a.nick === focus ? .2 : 1, wb = b.nick === focus ? .2 : 1;
        a.x -= dx * push * wa; a.y -= dy * push * wa; b.x += dx * push * wb; b.y += dy * push * wb;
      }
    }
    for (const a of items) {
      a.x += (a.ax - a.x) * .02; a.y += (a.ay - a.y) * .02;
      for (const k of blocks) pushOut(a, k);
      if (a.nick === focus) for (const k of focusBlocks) pushOut(a, k);
      a.x = Math.min(W - a.r - 6, Math.max(a.r + 6, a.x)); a.y = Math.min(H - a.r - 6, Math.max(a.r + 6, a.y));
    }
  }
  return items;
}
const logoBox = it => box(it.x - it.r, it.y - it.r, it.r * 2, it.r * 2);
// the city-name pill beside the big logo, on the side with least overlap: `boxes` it must avoid (logos,
// names), `soft` ones it should avoid if it can (the highlighted state)
const PILL = { font: 'graduate', px: 17, ls: .04, h: 30 };
function placePill(f, name, boxes, soft = []) {
  const w = ri(textW(name, PILL.font, PILL.px, PILL.ls) + 26), h = PILL.h;
  let best = null, k = 0;
  for (const g of [8, 26]) {   // right beside the logo first, then a little farther out
    const d = f.r * .72 + g;
    const c = [[f.x, f.y - f.r - g - h / 2], [f.x + f.r + g + w / 2, f.y], [f.x - f.r - g - w / 2, f.y], [f.x, f.y + f.r + g + h / 2],
      [f.x + d + w / 2, f.y - d - h / 2], [f.x - d - w / 2, f.y - d - h / 2], [f.x + d + w / 2, f.y + d + h / 2], [f.x - d - w / 2, f.y + d + h / 2]];
    for (const [x, y] of c) {
      const b = box(x - w / 2, y - h / 2, w, h);
      const cost = (inMap(b, 6) ? 0 : 1e6) + boxes.reduce((a, o) => a + overlap(b, o), 0) * 50 +
        soft.reduce((a, o) => a + overlap(b, o), 0) * 2 + k++ * 5;
      if (!best || cost < best.cost) best = { cost, b, x, y, w };
    }
  }
  return best;
}

const out = { us: {}, lakes: {} };
const report = [];
// logos are round: two logos clash when their circles touch; anything else when the boxes overlap
function checkOverlaps(name, boxes) {
  const bad = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const clash = a.c && b.c ? Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1]) < a.c[2] + b.c[2] + 1 : overlap(a.b, b.b) > 1;
    if (clash) bad.push(a.n + ' x ' + b.n);
  }
  for (const o of boxes) if (!inMap(o.b, 2)) bad.push(o.n + ' off the map');
  if (bad.length) report.push(name + ': ' + bad.join(', '));
}

// ---------- the US view ----------
{
  const p = d3.geoConicConformal().parallels([30, 46]).rotate([97, 0]).fitExtent([[18, 40], [W - 118, H - 44]], lower48).clipExtent([[0, 0], [W, H]]);
  const P = d3.geoPath(p).digits(1), G = regionGrid(p);
  const V = out.us;
  V.w = W; V.h = H;
  V.other = P(FC(others));
  V.states = {}; for (const f of states) V.states[f.properties.name] = P(f);
  V.lakes = P(FC(lakes.filter(f => P.area(f) > 40)));
  const anchors = TEAMS.filter(t => t.lonLat).map(t => { const [x, y] = p(t.lonLat); return { nick: t.nick, x: r1(x), y: r1(y), ax: r1(x), ay: r1(y) }; });
  V.anchors = Object.fromEntries(anchors.map(a => [a.nick, [a.x, a.y]]));
  // country and ocean names, clear of the logos (with room to spare, as layouts shift a little per team)
  const base = layoutLogos(anchors, null).map(it => { const b = logoBox(it); return box(b.x0 - 12, b.y0 - 12, b.x1 - b.x0 + 24, b.y1 - b.y0 + 24); });
  V.labels = []; const staticBoxes = [];
  const named = [['CANADA', 'country', v => v === 'c:124', [W * .45, 22], 'fredoka700', 16, .14],
                 ['MEXICO', 'country', v => v === 'c:484', [W * .33, H - 30], 'fredoka700', 16, .14],
                 ['PACIFIC OCEAN', 'ocean', v => v === 'w', [50, H * .62], 'fredoka600', 11, .12],
                 ['ATLANTIC OCEAN', 'ocean', v => v === 'w', [W - 70, H * .62], 'fredoka600', 11, .12],
                 ['GULF OF MEXICO', 'ocean', v => v === 'w', [W * .52, H - 40], 'fredoka600', 11, .12]];
  for (const [t, k, ok, pref, font, px, ls] of named) {
    const w = textW(t, font, px, ls) + 6, h = px * 1.4;
    const pl = placeInRegion(G, ok, w, h, base.concat(staticBoxes), pref);
    if (!pl || Math.hypot(pl.x - pref[0], pl.y - pref[1]) > 220) continue;
    staticBoxes.push(pl.b); V.labels.push({ t, k, x: r1(pl.x), y: r1(pl.y) });
  }
  V.focus = {};
  for (const t of TEAMS.filter(t => t.state && t.lonLat)) {
    // a small state would vanish under the big logo, so that logo moves off it (a line joins it to the city)
    const sp = largest(projPolys(p, stateBy(t.state)));
    const xs = sp[0].map(q => q[0]), ys = sp[0].map(q => q[1]);
    const sb = box(Math.min(...xs) - 3, Math.min(...ys) - 3, Math.max(...xs) - Math.min(...xs) + 6, Math.max(...ys) - Math.min(...ys) + 6);
    const small = sb.x1 - sb.x0 < 75 || sb.y1 - sb.y0 < 75;
    const lay = layoutLogos(anchors, t.nick, [], small ? [sb] : []), f = lay.find(it => it.nick === t.nick);
    const logoBoxes = lay.map(logoBox);
    const others_ = lay.filter(it => it !== f).map(logoBox);
    const pill = placePill(f, t.city.toUpperCase(), others_.concat(staticBoxes, small ? [sb] : []), [sb]);
    const avoid = logoBoxes.concat([pill.b], staticBoxes);
    const poly = largest(projPolys(p, stateBy(t.state)));
    const SL = { font: 'fredoka700', px: 13, ls: .06, sizes: [13, 12, 11, 10], spill: 10 };
    let label = null, labelBox;
    const inside = placeInside(t.state, poly, SL, avoid);
    if (inside) { label = { t: inside.t, x: inside.x, y: inside.y, s: inside.s, in: 1 }; labelBox = inside.box; }
    else {
      // too small or crowded: put the name nearby with a line to the state
      const [cx, cy] = polylabel(poly, .3), up = t.state.toUpperCase(), b = block(up, 'fredoka700', 12, .06);
      const pl = placeNear(cx, cy, b.w + 8, b.h + 4, small ? avoid.concat([sb]) : avoid, 24, G, 130);
      const ex = Math.min(Math.max(cx, pl.bx.x0), pl.bx.x1), ey = Math.min(Math.max(cy, pl.bx.y0), pl.bx.y1);
      label = { t: up, x: r1(pl.x), y: r1(pl.y), s: 12, line: [r1(cx), r1(cy), r1(ex), r1(ey)] }; labelBox = pl.bx;
    }
    V.focus[t.nick] = { logos: Object.fromEntries(lay.map(it => [it.nick, [r1(it.x), r1(it.y)]])), pill: [r1(pill.x), r1(pill.y), pill.w], label };
    checkOverlaps('us/' + t.nick, lay.map(it => ({ n: it.nick, b: logoBox(it), c: [it.x, it.y, it.r] }))
      .concat([{ n: 'pill', b: pill.b }, { n: 'state name', b: labelBox }], staticBoxes.map((b, k) => ({ n: V.labels[k].t, b }))));
  }
}

// ---------- the Great Lakes view, for teams outside the USA ----------
{
  const view = { type: 'MultiPoint', coordinates: [[-92, 39], [-69.5, 39], [-92, 49.2], [-69.5, 49.2], [-81, 49.8], [-81, 38.4]] };
  const p = d3.geoConicConformal().parallels([40, 47]).rotate([81, 0]).fitExtent([[0, 0], [W, H]], view).clipExtent([[0, 0], [W, H]]);
  const P = d3.geoPath(p).digits(1), G = regionGrid(p);
  const V = out.lakes;
  V.w = W; V.h = H;
  V.other = P(FC(others.filter(f => f.id !== '124')));
  V.canada = P(canada);
  V.us = P(lower48);
  V.lakes = P(FC(lakes.filter(f => P.area(f) > 10)));
  const inset = { x0: 12, y0: H - 12 - 132, x1: 12 + 196, y1: H - 12 };
  const anchors = TEAMS.filter(t => t.lonLat).map(t => { const [x, y] = p(t.lonLat); return { nick: t.nick, x: r1(x), y: r1(y), ax: r1(x), ay: r1(y) }; })
    .filter(a => a.x > 10 && a.x < W - 10 && a.y > 10 && a.y < H - 10);
  V.anchors = Object.fromEntries(anchors.map(a => [a.nick, [a.x, a.y]]));
  V.focus = {};
  const abroad = TEAMS.filter(t => !t.state && t.lonLat);
  for (const t of abroad) {
    const lay = layoutLogos(anchors, t.nick, [inset]), f = lay.find(it => it.nick === t.nick);
    const pill = placePill(f, t.city.toUpperCase(), lay.filter(it => it !== f).map(logoBox).concat([inset]));
    V.focus[t.nick] = { logos: Object.fromEntries(lay.map(it => [it.nick, [r1(it.x), r1(it.y)]])), pill: [r1(pill.x), r1(pill.y), pill.w] };
    // names on this map: lakes, then states, then CANADA and USA, all clear of the logos, pill and inset
    const boxes = lay.map(logoBox).concat([pill.b, inset]), named = [];
    V.labels = [];
    for (const n of GREAT) {
      const poly = clipPoly(largest(projPolys(p, lakes.find(l => l.properties.name === n))));
      const pl = placeInside(n, poly, { font: 'fredoka600', px: 11.5, ls: .06, sizes: [11.5, 10.5, 9.5], spill: 10 }, boxes);
      if (!pl) continue;
      boxes.push(pl.box); named.push({ n, b: pl.box }); V.labels.push({ t: pl.t, k: 'lake', x: pl.x, y: pl.y, s: pl.s });
    }
    for (const f_ of states) {
      const name = f_.properties.name; if (name === 'District of Columbia') continue;
      const poly = clipPoly(largest(projPolys(p, f_))); if (ringArea(poly[0]) < 400) continue;
      const pl = placeInside(name, poly, { font: 'fredoka600', px: 12, ls: .05, sizes: [12, 11] }, boxes);
      if (!pl) continue;
      boxes.push(pl.box); named.push({ n: name, b: pl.box }); V.labels.push({ t: pl.t, k: 'state', x: pl.x, y: pl.y, s: pl.s });
    }
    for (const [txt, k, ok, pref] of [['CANADA', 'big', v => v === 'c:124', [W * .5, 60]], ['USA', 'big2', v => v.startsWith('s:'), [W * .42, H * .82]]]) {
      const w = textW(txt, 'fredoka700', 24, .14) + 8;
      const pl = placeInRegion(G, ok, w, 32, boxes, pref); if (!pl) continue;
      boxes.push(pl.b); named.push({ n: txt, b: pl.b }); V.labels.push({ t: txt, k, x: r1(pl.x), y: r1(pl.y) });
    }
    checkOverlaps('lakes/' + t.nick, lay.map(it => ({ n: it.nick, b: logoBox(it), c: [it.x, it.y, it.r] })).concat([{ n: 'pill', b: pill.b }, { n: 'inset', b: inset }], named));
  }
  // inset: all of North America, with the close-up's area boxed
  const IW = 196, IH = 132, naF = topojson.feature(world110, world110.objects.countries).features;
  const ip = d3.geoConicConformal().parallels([30, 55]).rotate([100, 0])
    .fitExtent([[6, 6], [IW - 6, IH - 6]], { type: 'MultiPoint', coordinates: [[-128, 22], [-62, 22], [-128, 58], [-62, 58], [-98, 61]] }).clipExtent([[0, 0], [IW, IH]]);
  const IP = d3.geoPath(ip).digits(1);
  const frame = [[0, 0], [W, 0], [W, H], [0, H]].map(q => ip(p.invert(q)).map(r1));
  V.inset = { x: inset.x0, y: inset.y0, w: IW, h: IH,
    other: IP(FC(naF.filter(f => !['840', '124'].includes(f.id)))), canada: IP(naF.find(f => f.id === '124')), us: IP(naF.find(f => f.id === '840')),
    box: 'M' + frame.map(q => q.join(' ')).join('L') + 'Z' };
}

// ---------- write it into index.html ----------
const json = JSON.stringify(out);
if (json.includes('</')) throw new Error('map data must not contain </');
const line = '<script type="application/json" id="mapData">' + json + '</script>';
const lines = html.split('\n');
const at = lines.findIndex(l => l.includes('id="mapData"'));
if (at >= 0) lines[at] = line;
else lines.splice(lines.findIndex(l => l.includes('id="voiceData"')), 0, line);
fs.writeFileSync(INDEX, lines.join('\n'));
console.log('mapData:', json.length, 'bytes |', 'us views:', Object.keys(out.us.focus).length, '| lakes views:', Object.keys(out.lakes.focus).length);
for (const [n, f] of Object.entries(out.us.focus)) console.log('  ' + n.padEnd(10), f.label.in ? 'name inside  ' : 'name + line  ', f.label.t.replace('\n', ' '), f.label.s + 'px');
console.log(report.length ? 'OVERLAPS:\n  ' + report.join('\n  ') : 'no overlaps');
