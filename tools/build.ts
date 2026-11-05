// Draws the profile's SVG cards from live GitHub and Hugging Face data.
// Run daily by .github/workflows/refresh.yml; locally: GITHUB_TOKEN=$(gh auth token) node tools/build.ts
// Every card is a paper specimen in the same ink and pigments as beckett-dillon.com, with fonts subset and embedded.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { growTree, rng, type V3 } from './tree.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'assets');
const USER = 'severian42';
const HF = 'Severian';
const TOKEN = process.env.GITHUB_TOKEN ?? '';

const C = {
  paper: '#f7f4ee',
  ink: '#1f1b16',
  ink2: '#4a433a',
  ink3: '#7a7268',
  hair: 'rgba(31,27,22,0.12)',
  moss: '#4f6b3a',
  lichen: '#a9c48c',
  sepia: '#7a5a3c',
  sienna: '#9b5a3a',
  indigo: '#2e3d57',
  payne: '#3b4552',
};

/* ---------- fonts: subset to the glyphs each card uses, then embed ---------- */

const FONTS = {
  serif: { file: 'newsreader.woff2', family: 'NR', weight: '200 800' },
  sans: { file: 'instrument-sans.woff2', family: 'IS', weight: '400 700' },
  mono: { file: 'plex-mono.woff2', family: 'PM', weight: '400' },
} as const;
type FontKey = keyof typeof FONTS;
const tmp = mkdtempSync(join(tmpdir(), 'gh-cards-'));

function fontFace(key: FontKey, text: string) {
  const f = FONTS[key];
  const out = join(tmp, `${key}-${Math.random().toString(36).slice(2)}.woff2`);
  const glyphs = [...new Set(text + ' ')].join('');
  execFileSync('pyftsubset', [join(HERE, 'fonts', f.file), `--text=${glyphs}`, '--flavor=woff2', `--output-file=${out}`, '--layout-features=kern,liga']);
  const b64 = readFileSync(out).toString('base64');
  return `@font-face{font-family:${f.family};src:url(data:font/woff2;base64,${b64}) format('woff2');font-weight:${f.weight}}`;
}

/** Collects text per font while a card is drawn, so the subset matches exactly. */
class Card {
  used: Record<FontKey, string> = { serif: '', sans: '', mono: '' };
  body = '';
  w: number;
  h: number;
  label: string;
  constructor(w: number, h: number, label: string) {
    this.w = w;
    this.h = h;
    this.label = label;
  }
  text(font: FontKey, x: number, y: number, s: string, size: number, fill = C.ink, extra = '') {
    this.used[font] += s;
    const fam = FONTS[font].family;
    this.body += `<text x="${x}" y="${y}" font-family="${fam}" font-size="${size}" fill="${fill}" ${extra}>${esc(s)}</text>`;
  }
  add(svg: string) {
    this.body += svg;
  }
  render(style = '') {
    const faces = (Object.keys(this.used) as FontKey[]).filter((k) => this.used[k]).map((k) => fontFace(k, this.used[k])).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.w} ${this.h}" width="${this.w}" height="${this.h}" role="img" aria-label="${esc(this.label)}">
<style>${faces}${style}</style>
<defs>
<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3"/><feColorMatrix values="0 0 0 0 0.12  0 0 0 0 0.1  0 0 0 0 0.08  0 0 0 0.05 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>
<filter id="wc" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="10" xChannelSelector="R" yChannelSelector="G" result="d"/><feGaussianBlur in="d" stdDeviation="0.6"/></filter>
<filter id="ink-edge" x="-2%" y="-20%" width="104%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="2"/></filter>
<clipPath id="frame"><rect x="0.5" y="0.5" width="${this.w - 1}" height="${this.h - 1}" rx="14"/></clipPath>
</defs>
<g clip-path="url(#frame)"><rect width="${this.w}" height="${this.h}" fill="${C.paper}"/><rect width="${this.w}" height="${this.h}" fill="${C.paper}" filter="url(#grain)"/>${this.body}</g>
<rect x="0.5" y="0.5" width="${this.w - 1}" height="${this.h - 1}" rx="14" fill="none" stroke="${C.hair}"/>
</svg>`;
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (n: number) => n.toLocaleString('en-US');
const f1 = (n: number) => n.toFixed(1);

function wrap(s: string, max: number) {
  const lines: string[] = [];
  let cur = '';
  for (const w of s.split(' ')) {
    if ((cur + ' ' + w).trim().length > max) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}

/* ---------- data ---------- */

async function gql(query: string) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { authorization: `bearer ${TOKEN}`, 'content-type': 'application/json', 'user-agent': 'severian42-profile' },
    body: JSON.stringify({ query }),
  });
  const j = await res.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

async function hf(path: string) {
  const res = await fetch(`https://huggingface.co/api/${path}`, { headers: { 'user-agent': 'severian42-profile' } });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

const PROJECTS = [
  { repo: 'GraphRAG-Local-UI', title: 'GraphRAG Local UI', motif: 'graph', blurb: 'Microsoft’s GraphRAG on local models via Ollama and LM Studio, with indexing, query and graph views.' },
  { repo: 'Vodalus-Expert-LLM-Forge', title: 'Vodalus', motif: 'rows', blurb: 'Builds fine-tuning datasets grounded in RAG and Wikipedia, then trains on them with MLX and Unsloth.' },
  { repo: 'MoA-Ollama-Chat', title: 'MoA Ollama Chat', motif: 'merge', blurb: 'Mixture-of-agents for local models: several small models draft and one aggregates.' },
  { repo: 'BDH-MLX', title: 'BDH-MLX', motif: 'neurons', blurb: 'Pathway’s Dragon Hatchling architecture ported from PyTorch to Apple MLX, at about twice the training throughput.' },
  { repo: 'Mycomind-Daemon-Ollama-Mixture-of-Memory-RAG-Agents', title: 'Mycomind Daemon', motif: 'mycelium', blurb: 'A local assistant that pairs several models with memory, retrieval and web search.' },
  { repo: 'Firewatch', title: 'Firewatch', motif: 'tower', blurb: 'A civil-rights companion app, available in 13 languages.' },
] as const;

const LANG: Record<string, string> = { Python: C.indigo, TypeScript: C.moss, 'Jupyter Notebook': C.sienna, JavaScript: C.sepia };

/* ---------- hero ---------- */

function hero() {
  const card = new Card(1200, 400, 'Beckett Dillon, applied AI engineer. One ink line changes character across soil and water, sound, wood and print, and models and code.');
  card.text('serif', 56, 104, 'Beckett Dillon', 64, C.ink, 'font-weight="400" letter-spacing="-0.5"');
  card.text('sans', 58, 148, 'Applied AI engineer. I learn how a system behaves, then build tools that work with it.', 23, C.ink2);
  card.text('mono', 58, 184, 'Senior Forward Deployed AI Engineer and AI Consultant · Adobe', 15, C.ink3);
  card.text('mono', 1144, 184, 'open to new roles', 15, C.moss, 'text-anchor="end"');
  const wave = readFileSync(join(HERE, 'wave.svg'), 'utf8');
  const inner = wave.slice(wave.indexOf('</defs>') + 7, wave.lastIndexOf('</svg>'));
  // Mark labels inside the wave carry their own font use.
  for (const m of inner.matchAll(/<text[^>]*>([^<]*)<\/text>/g)) card.used.mono += m[1];
  card.add(`<g transform="translate(56 200) scale(${1088 / 1200})">${inner.replace(/<text /g, '<text font-family="PM" ')}</g>`);
  const style = `
.axis{stroke:${C.ink};stroke-opacity:.18;stroke-dasharray:2 6}
.wash{opacity:0;animation:fade 1.2s ease .6s forwards}
.ink{fill:none;stroke:${C.ink};stroke-width:1.6;stroke-linejoin:round;stroke-linecap:round;stroke-dasharray:1;stroke-dashoffset:1;animation:draw 1.3s cubic-bezier(.22,1,.36,1) forwards}
.zone:nth-of-type(2) .ink{animation-delay:.3s}.zone:nth-of-type(3) .ink{animation-delay:.6s}.zone:nth-of-type(4) .ink{animation-delay:.9s}
.echo,.grain{fill:none;stroke:${C.ink};stroke-opacity:.16;stroke-width:1}
.tick{stroke:${C.ink};stroke-opacity:.25;stroke-dasharray:3 3}
.mark{font-size:14px;fill:${C.ink3}}
@keyframes draw{to{stroke-dashoffset:0}}@keyframes fade{to{opacity:.28}}
@media (prefers-reduced-motion:reduce){.ink{animation:none;stroke-dashoffset:0}.wash{animation:none;opacity:.28}}`;
  return card.render(style);
}

/* ---------- project cards ---------- */

function motif(kind: string, seed: number) {
  const r = rng(seed);
  const S = (w = 1.2, col: string = C.ink) => `stroke="${col}" stroke-width="${w}" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  const s = S();
  let g = '';
  if (kind === 'graph') {
    const pts = Array.from({ length: 9 }, () => [10 + r() * 76, 10 + r() * 76]);
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++)
        if (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) < 38) g += `<line x1="${f1(pts[i][0])}" y1="${f1(pts[i][1])}" x2="${f1(pts[j][0])}" y2="${f1(pts[j][1])}" ${s} stroke-opacity=".5"/>`;
    pts.forEach(([x, y], i) => (g += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${i === 0 ? 5 : 3}" fill="${i === 0 ? C.moss : C.paper}" stroke="${C.ink}" stroke-width="1.2"/>`));
  } else if (kind === 'rows') {
    for (let i = 0; i < 7; i++) {
      const w = 30 + r() * 50;
      g += `<line x1="12" y1="${14 + i * 11}" x2="${f1(12 + w)}" y2="${14 + i * 11}" ${s} stroke-opacity="${i === 3 ? 1 : 0.45}"/>`;
    }
    g += `<path d="M78 44l4 4 8-9" ${S(1.6, C.moss)}/>`;
  } else if (kind === 'merge') {
    for (let i = 0; i < 5; i++) {
      const y = 12 + i * 18;
      g += `<path d="M8 ${y} C 44 ${y}, 44 48, 74 48" ${s} stroke-opacity="${0.35 + i * 0.1}"/><circle cx="8" cy="${y}" r="2.6" fill="${C.ink}"/>`;
    }
    g += `<line x1="74" y1="48" x2="90" y2="48" ${S(2)}/><circle cx="90" cy="48" r="4.5" fill="${C.moss}"/>`;
  } else if (kind === 'neurons') {
    for (let x = 0; x < 6; x++)
      for (let y = 0; y < 6; y++) {
        const on = r() < 0.16;
        g += `<circle cx="${12 + x * 14.5}" cy="${12 + y * 14.5}" r="${on ? 3.6 : 1.6}" fill="${on ? C.sienna : C.ink}" fill-opacity="${on ? 1 : 0.35}"/>`;
      }
  } else if (kind === 'mycelium') {
    const walk = (x: number, y: number, a: number, n: number, w: number) => {
      let d = `M${f1(x)} ${f1(y)}`;
      for (let i = 0; i < n; i++) {
        a += (r() - 0.5) * 0.9;
        x += Math.cos(a) * 6;
        y += Math.sin(a) * 6;
        d += ` L${f1(x)} ${f1(y)}`;
        if (r() < 0.22 && w > 0.6) walk(x, y, a + (r() < 0.5 ? 0.9 : -0.9), n - i - 2, w * 0.7);
      }
      g += `<path d="${d}" ${S(+f1(w))} stroke-opacity=".8"/>`;
    };
    for (let k = 0; k < 4; k++) walk(48, 48, (k / 4) * Math.PI * 2 + r(), 8, 1.4);
    g += `<circle cx="48" cy="48" r="4" fill="${C.sepia}"/>`;
  } else if (kind === 'tower') {
    g += `<path d="M38 90 L46 34 L50 34 L58 90 M41 70 L55 70 M43 54 L53 54 M36 34 L60 34 L48 24 Z" ${s}/>`;
    for (let i = 1; i <= 3; i++) g += `<path d="M${48 - i * 12} ${28 - i * 3} A ${i * 13} ${i * 13} 0 0 1 ${48 + i * 12} ${28 - i * 3}" ${s} stroke-opacity="${0.7 - i * 0.15}" stroke-dasharray="2 4"/>`;
    g += `<circle cx="48" cy="24" r="3" fill="${C.sienna}"/>`;
  }
  return g;
}

function project(p: (typeof PROJECTS)[number], info: { stars: number; forks: number; lang: string }, i: number) {
  const card = new Card(580, 200, `${p.title}: ${p.blurb} ${fmt(info.stars)} stars.`);
  card.text('serif', 28, 56, p.title, 32);
  wrap(p.blurb, 40).slice(0, 3).forEach((l, k) => card.text('sans', 28, 90 + k * 24, l, 18, C.ink2));
  card.add(`<g transform="translate(462 18)">${motif(p.motif, 1000 + i * 77)}</g>`);
  const dot = LANG[info.lang] ?? C.ink3;
  card.add(`<line x1="28" x2="552" y1="158" y2="158" stroke="${C.hair}"/><circle cx="34" cy="179" r="5" fill="${dot}"/>`);
  let meta = `${info.lang}`;
  card.text('mono', 46, 184, meta, 14, C.ink3);
  const right = info.stars ? `★ ${fmt(info.stars)}${info.forks ? ` · ${fmt(info.forks)} forks` : ''}` : 'new';
  card.text('mono', 552, 184, right, 14, C.ink2, 'text-anchor="end"');
  return card.render();
}

/* ---------- forest: one tree per released model ---------- */

const SEASON = (d: Date) => {
  const m = d.getUTCMonth();
  return m < 2 || m === 11 ? 'winter' : m < 5 ? 'spring' : m < 8 ? 'summer' : 'autumn';
};
const WASH: Record<string, string[]> = {
  spring: ['#a9c48c', '#8fae6e', '#c9b8a6', '#b7c99a'],
  summer: ['#4f6b3a', '#6d8a4f', '#3f5a2c', '#8fae6e'],
  autumn: ['#9b5a3a', '#c08a3e', '#b06f3c', '#6d7a5a'],
  winter: ['#3b4552', '#2e3d57', '#8a93a3'],
};

type Model = { name: string; downloads: number; created: string };

function forest(list: Model[], datasets: number) {
  const W = 1200, H = 684, GROUND = 360, L = 64, R = 1136;
  const total = list.reduce((s, m) => s + m.downloads, 0);
  const card = new Card(W, H, `A forest of ${list.length} trees, one for each model Beckett has released on Hugging Face, sized by downloads. ${fmt(total)} downloads in all.`);
  card.text('serif', 56, 64, 'A tree for every model', 34);
  card.text('sans', 56, 98, 'One for each model I have released on Hugging Face, in release order. Height follows', 19, C.ink2);
  card.text('sans', 56, 124, 'all-time downloads; the leaves take the season it shipped in. Redrawn daily.', 19, C.ink2);
  card.text('mono', R + 8, 62, 'huggingface.co/Severian', 14, C.ink3, 'text-anchor="end"');

  const models = [...list].sort((a, b) => a.created.localeCompare(b.created));
  const max = Math.max(1, ...models.map((m) => m.downloads));
  const step = (R - L) / models.length;
  let back = '', wood = '', front = '';
  let lastYear = '';
  card.add(`<ellipse cx="${W / 2}" cy="${GROUND + 14}" rx="${(R - L) / 2 + 24}" ry="22" fill="${C.sepia}" opacity=".12" filter="url(#wc)"/>`);

  models.forEach((m, i) => {
    const d = new Date((m.created || '2024-01-01') + 'T00:00:00Z');
    const x0 = L + step * (i + 0.5);
    const year = m.created.slice(0, 4);
    if (year && year !== lastYear) {
      card.add(`<line x1="${f1(x0 - step / 2)}" x2="${f1(x0 - step / 2)}" y1="${GROUND + 26}" y2="${GROUND + 36}" stroke="${C.ink}" stroke-opacity=".3"/>`);
      card.text('mono', x0 - step / 2 + 6, GROUND + 37, year, 14, C.ink3);
      lastYear = year;
    }
    const delay = (i * 0.05).toFixed(2);
    let seed = 2166136261;
    for (const ch of m.name) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0;
    const tree = growTree(seed);
    const h = 28 + 168 * Math.sqrt(m.downloads / max);
    const k = h / tree.height;
    const r = rng(seed ^ 0x51ed);
    const view = r() * Math.PI * 2, c = Math.cos(view), s = Math.sin(view);
    const P = (p: V3) => ({ x: x0 + (p[0] * c + p[1] * s) * k * 0.6, y: GROUND - p[2] * k });
    const season = SEASON(d);
    const pal = WASH[season];
    // Branches grouped by width and tone into a handful of paths per tree, to keep the file small.
    const buckets = new Map<string, string>();
    for (const sg of tree.segs) {
      const a = P(sg.a), b = P(sg.b);
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1.4 && sg.ra < 1.2) continue;
      const w = Math.max(0.4, Math.round(((sg.ra + sg.rb) / 2) * k * 0.55 * 4) / 4);
      const bark = sg.ra > 2.6 ? 2 : sg.ra > 1.6 ? 1 : 0;
      const key = `${w}|${bark}`;
      buckets.set(key, (buckets.get(key) ?? '') + `M${f1(a.x)} ${f1(a.y)}L${f1(b.x)} ${f1(b.y)}`);
    }
    let g = '';
    for (const [key, d] of buckets) {
      const [w, bark] = key.split('|').map(Number);
      g += `<path d="${d}" stroke="${bark === 2 ? '#3a2e22' : C.ink}" stroke-opacity="${[0.6, 0.78, 0.95][bark]}" stroke-width="${w}"/>`;
    }
    wood += `<g class="t" style="animation-delay:${delay}s">${g}</g>`;
    let leaves = '';
    const keep = (14 + 60 * Math.sqrt(m.downloads / max)) / tree.tips.length;
    for (const t of tree.tips) {
      if (r() > keep) continue;
      const p = P(t.p);
      const rad = (season === 'winter' ? 1.6 : 3) + r() * (season === 'winter' ? 2.4 : 5.5) * Math.min(1.3, k * 2.2);
      leaves += `<circle cx="${Math.round(p.x + (r() - 0.5) * 5)}" cy="${Math.round(p.y + (r() - 0.5) * 5)}" r="${Math.round(rad + 1)}" fill="${pal[Math.floor(r() * pal.length)]}" opacity="${(season === 'winter' ? 0.3 : 0.34 + r() * 0.2).toFixed(1)}"/>`;
    }
    const lg = `<g class="l" style="animation-delay:${(i * 0.05 + 0.5).toFixed(2)}s">${leaves}</g>`;
    if (i % 2) front += lg;
    else back += lg;
  });

  card.add(`<g filter="url(#wc)" style="mix-blend-mode:multiply">${back}</g>`);
  card.add(`<g stroke-linecap="round" fill="none">${wood}</g>`);
  card.add(`<g filter="url(#wc)" style="mix-blend-mode:multiply">${front}</g>`);
  card.add(`<path d="M${L - 12} ${GROUND} C 300 ${GROUND - 3}, 500 ${GROUND + 3}, 600 ${GROUND} S 900 ${GROUND - 2}, ${R + 12} ${GROUND + 1}" stroke="${C.ink}" stroke-width="1.2" fill="none" opacity=".7"/>`);

  // The key: total, then the most downloaded trees.
  const Y0 = 428;
  card.add(`<line x1="56" x2="1144" y1="${Y0}" y2="${Y0}" stroke="${C.hair}"/>`);
  card.text('serif', 56, Y0 + 90, fmt(Math.round(total / 1000) * 1000), 72, C.ink, 'font-weight="400" letter-spacing="-1"');
  card.text('sans', 58, Y0 + 126, `downloads across ${models.length} models and ${datasets} datasets:`, 19, C.ink2);
  card.text('sans', 58, Y0 + 152, 'fine-tunes, MoE merges and quantized builds', 19, C.ink2);
  const top = [...list].sort((a, b) => b.downloads - a.downloads).slice(0, 5);
  const x = 560, w = 584;
  card.text('mono', x, Y0 + 40, 'Tallest trees', 14, C.ink3);
  top.forEach((m, i) => {
    const y = Y0 + 70 + i * 29;
    const bw = Math.max(3, (w - 150) * (m.downloads / max));
    card.text('mono', x, y, m.name.length > 40 ? m.name.slice(0, 39) + '…' : m.name, 14, C.ink);
    card.text('mono', x + w, y, fmt(m.downloads), 14, C.ink2, 'text-anchor="end"');
    card.add(`<rect x="${x}" y="${y + 6}" width="${f1(bw)}" height="3.5" rx="1.75" fill="${i === 0 ? C.moss : C.ink}" fill-opacity="${i === 0 ? 0.9 : 0.22}"/>`);
  });
  card.text('mono', 56, H - 24, `updated ${new Date().toISOString().slice(0, 10)}`, 13, C.ink3);
  card.text('mono', 1144, H - 24, 'There is one more seed in the soil at beckett-dillon.com', 13, C.moss, 'text-anchor="end"');

  const style = `.t{transform-box:fill-box;transform-origin:50% 100%;animation:rise 1.1s cubic-bezier(.22,1,.36,1) both}.l{animation:bloom 1s ease both}
@keyframes rise{from{transform:scaleY(0);opacity:0}}@keyframes bloom{from{opacity:0}}
@media (prefers-reduced-motion:reduce){.t,.l{animation:none}}`;
  return card.render(style);
}

/* ---------- run ---------- */

const repoQ = PROJECTS.map((p, i) => `r${i}: repository(owner:"${USER}", name:"${p.repo}") { stargazerCount forkCount primaryLanguage { name } }`).join('\n');
const data = await gql(`{ ${repoQ} }`);

const mine = await hf(`models?author=${HF}&limit=200&expand[]=downloadsAllTime&expand[]=createdAt`);
const ds = await hf(`datasets?author=${HF}&limit=100`);
const modelList: Model[] = mine.map((m: any) => ({ name: m.id.split('/')[1], downloads: m.downloadsAllTime ?? 0, created: (m.createdAt ?? '').slice(0, 10) }));

writeFileSync(join(OUT, 'hero.svg'), hero());
PROJECTS.forEach((p, i) => {
  const r = data[`r${i}`];
  writeFileSync(join(OUT, `project-${i + 1}.svg`), project(p, { stars: r.stargazerCount, forks: r.forkCount, lang: r.primaryLanguage?.name ?? '' }, i));
});
writeFileSync(join(OUT, 'forest.svg'), forest(modelList, ds.length));
console.log(`cards written: ${modelList.length} models, ${fmt(modelList.reduce((s, m) => s + m.downloads, 0))} downloads`);
