// The 250,001st tree. One seeded 3D tree, drawn in ink and watercolour and exported as a printable STL.
// Units are millimetres in print space: z is up, the base disc sits under z = 0.
// Branches stay within 45° of vertical and at least 1.6 mm thick, so the tree prints upright without supports.

export type V3 = [number, number, number];
export type Seg = { a: V3; b: V3; ra: number; rb: number; order: number; dist: number; len: number };
export type Tip = { p: V3; dist: number; r: number };
export type Tree = { seed: number; segs: Seg[]; tips: Tip[]; height: number; baseR: number };

const MAX_TILT = (45 * Math.PI) / 180;
const MIN_R = 0.8;
const HEIGHT = 70;

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => mul(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));

function basis(d: V3): [V3, V3] {
  const ref: V3 = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norm(cross(ref, d));
  return [u, cross(d, u)];
}

/** Keep a direction printable: lean it back toward vertical if it passes 45°. */
function clampTilt(d: V3): V3 {
  const n = norm(d);
  if (Math.acos(Math.min(1, n[2])) <= MAX_TILT) return n;
  const h = norm([n[0], n[1], 0]);
  return [h[0] * Math.sin(MAX_TILT), h[1] * Math.sin(MAX_TILT), Math.cos(MAX_TILT)];
}

function turn(d: V3, tilt: number, az: number): V3 {
  const [u, v] = basis(d);
  const w = add(mul(u, Math.cos(az)), mul(v, Math.sin(az)));
  return add(mul(d, Math.cos(tilt)), mul(w, Math.sin(tilt)));
}

export function growTree(seed: number): Tree {
  const r = rng(seed);
  const segs: Seg[] = [];
  const tips: Tip[] = [];
  const habit = r(); // 0 = tall and narrow, 1 = broad and spreading
  const lateralTilt = 0.55 + habit * 0.2;
  const maxDepth = 7;
  let az = r() * Math.PI * 2;

  const branch = (p: V3, d: V3, len: number, rad: number, depth: number, order: number, dist: number) => {
    const b = add(p, mul(d, len));
    const rb = Math.max(MIN_R, rad * 0.88);
    segs.push({ a: p, b, ra: rad, rb, order, dist, len });
    const at = dist + len;
    if (depth >= maxDepth || segs.length > 900) {
      tips.push({ p: b, dist: at, r: rb });
      return;
    }
    // A leader that keeps climbing, plus one or two laterals around it on the golden angle.
    const lead = clampTilt(add(turn(d, 0.06 + r() * 0.14, r() * Math.PI * 2), [0, 0, 0.18]));
    branch(b, lead, len * (0.68 + r() * 0.08), rb, depth + 1, order, at);
    const n = depth < 1 ? 0 : r() < 0.3 + habit * 0.25 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      az += 2.39996 + (r() - 0.5) * 0.5;
      const dir = clampTilt(add(turn(d, lateralTilt + r() * 0.22, az), [0, 0, 0.04]));
      branch(b, dir, len * (0.78 + r() * 0.14 + habit * 0.08), Math.max(MIN_R, rb * (0.74 - i * 0.06)), depth + 1, order + 1, at);
    }
  };

  const lean = clampTilt([(r() - 0.5) * 0.12, (r() - 0.5) * 0.12, 1]);
  branch([0, 0, -1.5], lean, 14 + r() * 4, 4.2, 0, 0, 0);

  // Scale to a fixed printed height; thickness stays in real millimetres.
  const top = Math.max(...segs.map((s) => s.b[2]));
  const k = HEIGHT / top;
  for (const s of segs) {
    s.a = [s.a[0] * k, s.a[1] * k, s.a[2] * k];
    s.b = [s.b[0] * k, s.b[1] * k, s.b[2] * k];
    s.dist *= k;
    s.len *= k;
  }
  for (const t of tips) {
    t.p = [t.p[0] * k, t.p[1] * k, t.p[2] * k];
    t.dist *= k;
  }
  return { seed, segs, tips, height: HEIGHT, baseR: 16 };
}

/* ---------- STL ---------- */

function frustum(tris: number[], a: V3, b: V3, ra: number, rb: number, sides: number) {
  const d = norm(sub(b, a));
  const [u, v] = basis(d);
  const ring = (c: V3, rad: number) =>
    Array.from({ length: sides }, (_, i) => {
      const t = (i / sides) * Math.PI * 2;
      return add(c, add(mul(u, Math.cos(t) * rad), mul(v, Math.sin(t) * rad)));
    });
  const A = ring(a, ra), B = ring(b, rb);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    tris.push(...A[i], ...A[j], ...B[j], ...A[i], ...B[j], ...B[i]);
    tris.push(...b, ...B[i], ...B[j]);
    tris.push(...a, ...A[j], ...A[i]);
  }
}

/** Binary STL: every branch is a closed hexagonal frustum, overlapping its parent; slicers union the shells. */
export function toSTL(tree: Tree): ArrayBuffer {
  const tris: number[] = [];
  frustum(tris, [0, 0, -3], [0, 0, 0], tree.baseR, tree.baseR - 0.6, 48);
  for (const s of tree.segs) {
    const d = norm(sub(s.b, s.a));
    // Reach back into the parent so joints close; the trunk starts inside the base and never below it.
    const start = s.dist === 0 ? s.a : sub(s.a, mul(d, s.ra * 0.9));
    frustum(tris, start, s.b, s.ra, s.rb, s.ra > 2 ? 10 : 6);
  }
  const n = tris.length / 9;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  const head = 'beckett-dillon.com tree no. 250,001';
  for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i));
  dv.setUint32(80, n, true);
  let o = 84;
  for (let t = 0; t < n; t++) {
    const p = tris.slice(t * 9, t * 9 + 9);
    const nn = norm(cross(sub([p[3], p[4], p[5]], [p[0], p[1], p[2]]), sub([p[6], p[7], p[8]], [p[0], p[1], p[2]])));
    for (const x of [...nn, ...p]) {
      dv.setFloat32(o, x, true);
      o += 4;
    }
    o += 2;
  }
  return buf;
}

/* ---------- Drawing ---------- */

type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export function seasonOf(d: Date): Season {
  const m = d.getMonth();
  return m < 2 || m === 11 ? 'winter' : m < 5 ? 'spring' : m < 8 ? 'summer' : 'autumn';
}

const WASH: Record<Season, string[]> = {
  spring: ['#a9c48c', '#8fae6e', '#c9b8a6', '#b7c99a'],
  summer: ['#4f6b3a', '#6d8a4f', '#3f5a2c', '#8fae6e'],
  autumn: ['#9b5a3a', '#c08a3e', '#b06f3c', '#6d7a5a'],
  winter: ['#3b4552', '#2e3d57', '#8a93a3'],
};

const lerp3 = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
const mix = (a: number[], b: number[], t: number) => `rgb(${lerp3(a, b, t).map(Math.round).join(' ')})`;

export function drawTree(tree: Tree, when: Date, animate: boolean) {
  const r = rng(tree.seed ^ 0x9e3779b9);
  const season = seasonOf(when);
  const view = r() * Math.PI * 2;
  const c = Math.cos(view), s = Math.sin(view);
  const proj = (p: V3) => ({ x: p[0] * c + p[1] * s, z: -p[0] * s + p[1] * c, y: p[2] });

  const W = 600, GROUND = 600;
  const xs = tree.tips.map((t) => proj(t.p).x);
  const spread = Math.max(30, ...xs.map(Math.abs)) + 10;
  const k = Math.min(500 / (tree.height + 16), 260 / spread);
  const X = (x: number) => W / 2 + x * k;
  const Y = (y: number) => GROUND - y * k;
  const zs = tree.segs.map((sg) => proj(sg.b).z);
  const zMin = Math.min(...zs), zMax = Math.max(...zs);
  const depth = (z: number) => (z - zMin) / (zMax - zMin || 1); // 0 = far, 1 = near
  const speed = 0.02; // mm of growth per ms
  const total = Math.max(...tree.tips.map((t) => t.dist)) / speed;

  let out = '';
  // Soil wash and a few roots, drawn as a mirror below the ground line.
  out += `<g class="soil"><ellipse cx="${W / 2}" cy="${GROUND + 26}" rx="230" ry="34" fill="#7a5a3c" opacity=".16" filter="url(#tree-wc)"/><ellipse cx="${W / 2 + 30}" cy="${GROUND + 18}" rx="140" ry="18" fill="#4f3e30" opacity=".1" filter="url(#tree-wc)"/>`;
  for (let i = 0; i < 7; i++) {
    let x = W / 2 + (r() - 0.5) * 16, y = GROUND + 2, a = Math.PI / 2 + (r() - 0.5) * 2.2, w = 3.2 - i * 0.25, d = '';
    d = `M${x.toFixed(1)} ${y.toFixed(1)}`;
    for (let j = 0; j < 9; j++) {
      a += (r() - 0.5) * 0.5;
      x += Math.cos(a) * 11;
      y += Math.sin(a) * 6 + 1.5;
      d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    out += `<path class="root" d="${d}" stroke="#4f3e30" stroke-width="${w.toFixed(2)}" stroke-linecap="round" fill="none" opacity=".45" style="--l:120;--t:0ms;--d:${(total * 0.25).toFixed(0)}ms"/>`;
  }
  out += `<path d="M8 ${GROUND} C 120 ${GROUND - 3}, 210 ${GROUND + 4}, 300 ${GROUND} S 500 ${GROUND - 2}, 592 ${GROUND + 1}" stroke="#1f1b16" stroke-width="1.2" fill="none" opacity=".7"/></g>`;

  // Washes behind the far branches, ink in front: the near half of the canopy sits over the wood.
  const washes = (near: boolean) =>
    season === 'winter' && !near
      ? ''
      : tree.tips
          .filter((t) => (depth(proj(t.p).z) > 0.5) === near)
          .map((t) => {
            const p = proj(t.p);
            const pal = WASH[season];
            const col = pal[Math.floor(r() * pal.length)];
            const rad = (season === 'winter' ? 5 : 11) + r() * (season === 'winter' ? 6 : 14);
            const op = season === 'winter' ? 0.12 : 0.2 + r() * 0.16;
            return `<circle class="leaf" cx="${(X(p.x) + (r() - 0.5) * 14).toFixed(1)}" cy="${(Y(p.y) + (r() - 0.5) * 12).toFixed(1)}" r="${rad.toFixed(1)}" fill="${col}" opacity="${op.toFixed(2)}" style="--t:${(t.dist / speed).toFixed(0)}ms"/>`;
          })
          .join('');

  out += `<g filter="url(#tree-wc)" style="mix-blend-mode:multiply">${washes(false)}</g>`;
  const order = tree.segs.map((sg, i) => ({ sg, i, z: depth(proj(sg.b).z) })).sort((a, b) => a.z - b.z);
  out += '<g class="wood" stroke-linecap="round" fill="none">';
  for (const { sg, z } of order) {
    const a = proj(sg.a), b = proj(sg.b);
    const len = Math.hypot(X(b.x) - X(a.x), Y(b.y) - Y(a.y));
    // Twigs are drawn finer than they print; the STL keeps every branch at 1.6 mm or more.
    const w = Math.max(0.6, ((sg.ra + sg.rb) / 2 - 0.62) * k * 1.05);
    const f = Math.min(1, 0.35 + z * 0.55 + Math.min(1, sg.ra / 3) * 0.3);
    const bark = Math.min(1, Math.max(0, (sg.ra - 1.4) / 2.4));
    const ink = mix(lerp3([31, 27, 22], [92, 70, 50], bark), [176, 166, 152], 1 - f);
    out += `<path d="M${X(a.x).toFixed(1)} ${Y(a.y).toFixed(1)} L${X(b.x).toFixed(1)} ${Y(b.y).toFixed(1)}" stroke="${ink}" stroke-width="${w.toFixed(2)}" style="--l:${(len + w).toFixed(1)};--t:${(sg.dist / speed).toFixed(0)}ms;--d:${Math.max(60, sg.len / speed).toFixed(0)}ms"/>`;
  }
  out += '</g>';
  out += `<g filter="url(#tree-wc)" style="mix-blend-mode:multiply">${washes(true)}</g>`;

  const svg = `<svg viewBox="0 0 ${W} 720" class="tree-svg${animate ? ' grow' : ''}" role="img" aria-label="An ink and watercolour tree">
  <defs>
    <filter id="tree-wc" x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="${tree.seed % 97}" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="16" xChannelSelector="R" yChannelSelector="G" result="d"/>
      <feGaussianBlur in="d" stdDeviation="0.8"/>
    </filter>
  </defs>${out}</svg>`;
  return { svg, season, duration: total, branches: tree.segs.length };
}
