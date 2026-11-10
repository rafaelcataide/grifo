// Mapa em galhos (mapa mental clássico): o centro (biblioteca, tema, livro ou ideia) com galhos que
// abrem e fecham com um toque. Arrastar move, pinça ou roda do mouse dá zoom, toque duplo muda o centro.
// Os dados e as posições vêm de ../arvore.js; aqui ficam o desenho (SVG) e o toque.
import { esc } from '../util.js';
import { tr } from '../i18n.js';
import { buildIndex, nodeOf, childrenOf, layoutTree } from '../arvore.js';
import { groupColor } from '../graph.js';
import { state, $, sources, bookById, bookInScope, getScope, scopeActive, scopeFilters, resolveLink, conceptHref, srcHref, toast, render } from '../app.js';
import { themeIndex, connectModal } from './mapa.js';
import { downloadFile } from './artes.js';

const ROOT_KEY = 'grifo.galhosRoot';
const openKey = (r) => `grifo.galhosOpen:${r.kind}:${r.key}`;
const KIND_LABEL = { lib: 'Biblioteca', theme: 'Tema', subtheme: 'Subtema', book: 'Livro', idea: 'Ideia', ideaBook: 'Livro', notes: 'Grifos', related: 'Ideias próximas', nogenre: 'Sem tema', loose: 'Notas soltas', note: 'Grifo' };
const CENTERABLE = new Set(['theme', 'subtheme', 'book', 'idea', 'ideaBook']);
// textos do sistema no desenho (o SVG não passa pelo tradutor automático)
const SYS = new Set(['lib', 'nogenre', 'loose', 'related', 'more', 'notes']);

let M = null; // estado da tela

const ses = {
  get(k, d) { try { return JSON.parse(sessionStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } },
};

function palette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (k) => cs.getPropertyValue(k).trim();
  const bg = getComputedStyle(document.body).backgroundColor.match(/\d+/g)?.map(Number) || [255, 255, 255];
  return { dark: (bg[0] * 299 + bg[1] * 587 + bg[2] * 114) / 1000 < 128, accent: v('--accent') || '#6f7fe8', text: v('--text') || '#222', muted: v('--muted') || '#888', surface: v('--surface') || '#fff', border: v('--border') || '#ddd', tag: v('--c-tag') || '#8fbfe0', bg: getComputedStyle(document.body).backgroundColor };
}

// largura do galho (estimada pelo texto: o desenho precisa dela antes de existir)
const measure = (n) => (n.kind === 'note' ? Math.min(300, 30 + n.label.length * 6.4) : Math.min(240, 36 + labelOf(n).length * 7.6 + (n.count ? 24 : 0)));
const labelOf = (n) => (SYS.has(n.kind) ? tr(n.label) : n.label);
const fit = (s, w, px) => { const max = Math.max(4, Math.floor((w - 22) / px)); return s.length > max ? `${s.slice(0, max - 1)}…` : s; };

/** HTML da tela (o desenho é feito em mountGalhos). */
export function galhosHtml() {
  return `<input type="search" class="search" id="galhos-search" placeholder="Encontrar tema, livro ou ideia…" style="margin-bottom:8px">
  ${scopeFilters('mapScope')}
  <div class="map-trail" id="galhos-trail"></div>
  <section class="card graph-wrap galhos-wrap">
    <svg id="galhos" class="galhos" data-no-tr role="img" aria-label="Mapa em galhos"></svg>
    <div class="graph-tools">
      <button type="button" data-g="in" aria-label="Aproximar">＋</button>
      <button type="button" data-g="out" aria-label="Afastar">－</button>
      <button type="button" data-g="fit" aria-label="Enquadrar tudo">⤢</button>
      <button type="button" data-g="all" aria-label="Abrir os galhos" title="Abrir os galhos">⊞</button>
      <button type="button" data-g="none" aria-label="Fechar os galhos" title="Fechar os galhos">⊟</button>
      <button type="button" data-g="png" aria-label="Baixar como imagem" title="Baixar como imagem">📸</button>
    </div>
  </section>
  <section class="card" id="galhos-panel"><p class="small muted" style="margin:0">Toque num galho para abrir ou fechar. Toque duas vezes (ou em “Centralizar aqui”) para colocar o tema, livro ou ideia no centro.</p></section>`;
}

/** Monta os galhos dentro de body. */
export function mountGalhos(body) {
  body.innerHTML = galhosHtml();
  const scope = getScope('mapScope');
  const books = sources().filter((b) => bookInScope(b, scope));
  const ids = new Set(books.map((b) => b.id));
  // notas soltas (sem livro) só aparecem sem filtro
  const notes = state.notes.filter((n) => (n.bookId ? ids.has(n.bookId) : !scopeActive(scope)));
  const idx = buildIndex({ books, notes, resolve: resolveLink });
  const svg = $('#galhos', body);
  const saved = ses.get(ROOT_KEY, null);
  const root = (saved && nodeOf(idx, saved.kind, saved.key)) || nodeOf(idx, 'lib');
  M = {
    idx, svg, body, root,
    trail: saved && nodeOf(idx, saved.kind, saved.key) ? saved.trail || [] : [],
    open: new Set(ses.get(openKey(root), [])),
    limits: new Map(),
    view: { x: 0, y: 0, k: 1 },
    selected: null,
    byPath: new Map(),
    colors: palette(),
  };
  draw(true);
  bindPointer();
  // enquadra de novo quando o tamanho muda, até a pessoa mexer no mapa (no celular a tela ainda se ajusta)
  const ro = new ResizeObserver(() => { if (!svg.isConnected) { ro.disconnect(); return; } if (M.touched) applyView(); else fitView(); });
  ro.observe(svg);
  body.querySelectorAll('[data-g]').forEach((b) => { b.onclick = () => tool(b.dataset.g); });
  const search = $('#galhos-search', body);
  search.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); find(search.value); } };
  $('#galhos-panel', body).onclick = panelClick;
  $('#galhos-trail', body).onclick = (e) => {
    const b = e.target.closest('[data-trail]');
    if (!b) return;
    const i = Number(b.dataset.trail);
    const t = i < 0 ? { kind: 'lib', key: '' } : M.trail[i];
    M.trail = i < 0 ? [] : M.trail.slice(0, i);
    setRoot(t.kind, t.key, false);
  };
}

// ---- desenho ----
function colorOf(n) {
  const c = M.colors;
  const ti = n.theme ? themeIndex(n.theme) : -1;
  // sem cor de tema: o fundo do cartão e a borda neutra (nunca vazio, que o SVG pinta de preto)
  const tone = (a) => (ti >= 0 ? groupColor(ti, c.dark, a) : a < 0.5 ? c.surface : c.border);
  switch (n.kind) {
    case 'lib': return { fill: c.accent, stroke: c.accent, text: '#fff' };
    case 'theme': return { fill: tone(0.22), stroke: tone(1), text: c.text };
    case 'subtheme': return { fill: tone(0.1), stroke: tone(0.8), text: c.text, dash: true };
    case 'book': case 'ideaBook': return { fill: c.surface, stroke: tone(1) || c.border, text: c.text };
    case 'idea': return n.tag ? { fill: c.surface, stroke: c.tag, text: c.text } : { fill: c.dark ? 'rgba(233,200,112,.16)' : 'rgba(201,154,46,.12)', stroke: c.dark ? '#e9c870' : '#c99a2e', text: c.text };
    case 'note': return { fill: c.surface, stroke: c.border, text: c.muted };
    case 'more': return { fill: 'none', stroke: 'none', text: c.accent };
    default: return { fill: c.surface, stroke: c.border, text: c.text, dash: true };
  }
}

function draw(fitAfter = false, keep = null) {
  const before = keep && M.byPath.get(keep);
  const old = before && { x: before.x, y: before.y };
  M.root.label = M.root.kind === 'lib' ? 'Minha biblioteca' : M.root.label;
  const { nodes, edges } = layoutTree(M.root, { children: (n) => childrenOf(M.idx, n), expanded: M.open, limits: M.limits, measure });
  M.nodes = nodes;
  M.byPath = new Map(nodes.map((n) => [n.path, n]));
  // o galho tocado fica no mesmo lugar da tela depois de abrir/fechar
  const after = keep && M.byPath.get(keep);
  if (old && after) { M.view.x -= (after.x - old.x) * M.view.k; M.view.y -= (after.y - old.y) * M.view.k; }
  const H = 30;
  const curve = (a, b) => {
    const x1 = a.x + (b.side || 1) * (a.w / 2), x2 = b.x - (b.side || 1) * (b.w / 2);
    const mx = (x1 + x2) / 2;
    return `M${x1} ${a.y} C${mx} ${a.y} ${mx} ${b.y} ${x2} ${b.y}`;
  };
  const edgeColor = (n) => (n.theme && themeIndex(n.theme) >= 0 ? groupColor(themeIndex(n.theme), M.colors.dark, 0.55) : M.colors.border);
  const parts = edges.map(({ from, to }) => `<path d="${curve(from, to)}" fill="none" stroke="${edgeColor(to.theme ? to : from)}" stroke-width="${from.depth === 0 ? 2.2 : 1.5}"/>`);
  for (const n of nodes) {
    const c = colorOf(n);
    const x = n.x - n.w / 2, y = n.y - H / 2;
    const isRoot = n.depth === 0;
    const h = isRoot ? 40 : H;
    const yy = isRoot ? n.y - 20 : y;
    const label = fit(labelOf(n), n.w - (n.count ? 22 : 0), n.kind === 'note' ? 6.4 : 7.4);
    const sel = M.selected === n.path;
    parts.push(`<g class="mm-node${n.kind === 'note' || n.kind === 'more' ? ' leaf' : ''}" data-path="${esc(n.path)}">
      <rect x="${x}" y="${yy}" width="${n.w}" height="${h}" rx="${n.kind === 'note' ? 6 : h / 2}" fill="${c.fill}" stroke="${sel ? M.colors.accent : c.stroke}" stroke-width="${sel ? 2.6 : 1.4}"${c.dash ? ' stroke-dasharray="4 3"' : ''}/>
      <text x="${n.x - (n.count ? 10 : 0)}" y="${n.y + 4.5}" text-anchor="middle" fill="${c.text}" font-size="${isRoot ? 15 : n.kind === 'note' ? 12 : 13}" font-weight="${isRoot || n.kind === 'theme' ? 700 : n.kind === 'note' ? 400 : 600}" font-family="${isRoot || n.kind === 'theme' ? 'Fraunces, Georgia, serif' : 'Inter, system-ui, sans-serif'}">${esc(label)}</text>
      ${n.count ? `<text x="${n.x + n.w / 2 - 14}" y="${n.y + 4}" text-anchor="middle" fill="${isRoot ? '#fff' : M.colors.muted}" font-size="11" font-family="Inter, system-ui, sans-serif">${n.count}</text>` : ''}
      ${!isRoot && n.total && !n.open ? `<g class="mm-badge"><circle cx="${n.x + n.side * (n.w / 2 + 11)}" cy="${n.y}" r="9" fill="${M.colors.surface}" stroke="${c.stroke}" stroke-width="1.2"/><text x="${n.x + n.side * (n.w / 2 + 11)}" y="${n.y + 3.6}" text-anchor="middle" font-size="10" fill="${M.colors.muted}" font-family="Inter, system-ui, sans-serif">${n.total > 99 ? '99' : n.total}</text></g>` : ''}
    </g>`);
  }
  M.svg.innerHTML = `<g id="galhos-view">${parts.join('')}</g>`;
  if (fitAfter) fitView(); else applyView();
  renderTrail();
}

function applyView() {
  const g = M.svg.querySelector('#galhos-view');
  const r = M.svg.getBoundingClientRect();
  g?.setAttribute('transform', `translate(${r.width / 2 + M.view.x} ${r.height / 2 + M.view.y}) scale(${M.view.k})`);
}
function bounds() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of M.nodes) { x0 = Math.min(x0, n.x - n.w / 2 - 14); x1 = Math.max(x1, n.x + n.w / 2 + 24); y0 = Math.min(y0, n.y - 22); y1 = Math.max(y1, n.y + 22); }
  return { x0, y0, x1, y1 };
}
function fitView() {
  const r = M.svg.getBoundingClientRect();
  const { x0, y0, x1, y1 } = bounds();
  if (!r.width) return; // ainda sem tamanho: o ResizeObserver enquadra quando tiver
  const k = Math.max(0.2, Math.min(1.25, (r.width - 24) / (x1 - x0), (r.height - 24) / (y1 - y0)));
  M.view = { k, x: -((x0 + x1) / 2) * k, y: -((y0 + y1) / 2) * k };
  applyView();
}
function zoomAt(sx, sy, f) {
  const r = M.svg.getBoundingClientRect();
  const k = Math.min(3, Math.max(0.25, M.view.k * f));
  const cx = sx - r.width / 2, cy = sy - r.height / 2;
  M.view.x = cx - ((cx - M.view.x) / M.view.k) * k;
  M.view.y = cy - ((cy - M.view.y) / M.view.k) * k;
  M.view.k = k;
  applyView();
}

// ---- toque, arrasto, pinça e roda ----
function bindPointer() {
  const svg = M.svg;
  const pts = new Map();
  let drag = null, pinch = null, lastTap = { path: '', t: 0 };
  const pos = (e) => { const r = svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  svg.addEventListener('pointerdown', (e) => {
    M.touched = true;
    svg.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, pos(e));
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) }; drag = null; return; }
    drag = { start: pos(e), last: pos(e), moved: false, path: e.target.closest('[data-path]')?.dataset.path || '' };
  });
  svg.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    const p = pos(e);
    pts.set(e.pointerId, p);
    if (pinch && pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch.d);
      pinch.d = d;
      return;
    }
    if (!drag) return;
    if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) > 6) drag.moved = true;
    if (drag.moved) { M.view.x += p.x - drag.last.x; M.view.y += p.y - drag.last.y; applyView(); }
    drag.last = p;
  });
  const end = (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (!drag) return;
    if (!drag.moved && drag.path) {
      const now = Date.now();
      // toque duplo no mesmo galho: muda o centro
      if (lastTap.path === drag.path && now - lastTap.t < 350) { lastTap = { path: '', t: 0 }; centerOn(drag.path); } else { lastTap = { path: drag.path, t: now }; tap(drag.path); }
    }
    drag = null;
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener('wheel', (e) => { e.preventDefault(); const p = pos(e); zoomAt(p.x, p.y, e.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });
}

function tap(path) {
  const n = M.byPath.get(path);
  if (!n) return;
  if (n.kind === 'note') { location.hash = `#/nota/${n.key}`; return; }
  if (n.kind === 'more') { M.limits.set(n.key, (M.limits.get(n.key) || 25) + 50); draw(false, path); return; }
  if (n.depth > 0 && n.total) {
    if (M.open.has(path)) [...M.open].filter((p) => p === path || p.startsWith(`${path}/`)).forEach((p) => M.open.delete(p));
    else M.open.add(path);
    ses.set(openKey(M.root), [...M.open]);
  }
  M.selected = path;
  draw(false, path);
  showPanel(M.byPath.get(path));
}

// ---- centro ----
function centerOn(path) {
  const n = M.byPath.get(path);
  if (!n || !CENTERABLE.has(n.kind)) return;
  const [kind, key] = n.kind === 'ideaBook' ? ['book', n.bookId] : [n.kind, n.key];
  if (M.root.kind !== kind || M.root.key !== key) M.trail = [...M.trail, { kind: M.root.kind, key: M.root.key, label: M.root.label }].slice(-5);
  setRoot(kind, key, true);
}
function setRoot(kind, key, keepTrail) {
  const node = nodeOf(M.idx, kind, key);
  if (!node) return;
  if (!keepTrail && kind === 'lib') M.trail = [];
  M.root = node;
  M.open = new Set(ses.get(openKey(node), []));
  M.selected = null;
  ses.set(ROOT_KEY, { kind, key, trail: M.trail });
  draw(true);
  showPanel(null);
}
function renderTrail() {
  const el = $('#galhos-trail', M.body);
  if (!el) return;
  el.hidden = M.root.kind === 'lib';
  if (el.hidden) { el.innerHTML = ''; return; }
  el.innerHTML = `<nav class="trail"><button class="link-btn" data-trail="-1">← ${esc(tr('Minha biblioteca'))}</button>${M.trail.filter((t) => t.kind !== 'lib').map((t) => ` <span class="muted">›</span> <button class="link-btn" data-trail="${M.trail.indexOf(t)}">${esc(t.label.length > 24 ? `${t.label.slice(0, 23)}…` : t.label)}</button>`).join('')} <span class="muted">›</span> <b>${esc(M.root.label)}</b></nav>`;
}

// ---- painel do galho escolhido ----
function showPanel(n) {
  const panel = $('#galhos-panel', M.body);
  if (!panel) return;
  if (!n || n.depth === 0) {
    panel.innerHTML = `<p class="small muted" style="margin:0">Toque num galho para abrir ou fechar. Toque duas vezes (ou em “Centralizar aqui”) para colocar o tema, livro ou ideia no centro.</p>`;
    return;
  }
  const kind = n.kind === 'idea' && n.tag ? 'Tag' : n.article ? 'Artigo' : KIND_LABEL[n.kind] || '';
  const book = n.kind === 'book' ? bookById(n.key) : n.kind === 'ideaBook' ? bookById(n.bookId) : null;
  const href = book ? srcHref(book) : ['theme', 'subtheme'].includes(n.kind) ? conceptHref(n.label) : n.kind === 'idea' ? conceptHref(n.label.replace(/^#/, '')) : '';
  const counts = n.kind === 'theme' || n.kind === 'subtheme' ? `${n.count} ${n.count === 1 ? 'livro' : 'livros'}` : n.count ? `${n.count} ${n.count === 1 ? 'nota' : 'notas'}` : '';
  panel.innerHTML = `<div class="row between gap"><div class="grow"><span class="chip">${esc(tr(kind))}</span><h3 style="margin:4px 0 0">${esc(labelOf(n))}</h3>${counts ? `<div class="small muted">${counts}</div>` : ''}</div>
    ${href ? `<a class="btn small" href="${href}">Abrir</a>` : ''}</div>
    <div class="row gap-s wrap" style="margin-top:10px">
      ${CENTERABLE.has(n.kind) ? `<button class="btn small primary" data-p="center">🎯 Centralizar aqui</button>` : ''}
      ${['book', 'ideaBook', 'idea'].includes(n.kind) ? '<button class="btn small" data-p="link">🔗 Ligar com…</button><button class="btn small ghost" data-p="rede">🕸️ Ver na rede</button>' : ''}
    </div>`;
  panel.dataset.path = n.path;
}
function panelClick(e) {
  const b = e.target.closest('[data-p]');
  const n = b && M.byPath.get(e.currentTarget.dataset.path);
  if (!n) return;
  const id = n.kind === 'idea' ? `c:${n.key}` : `b:${n.kind === 'ideaBook' ? n.bookId : n.key}`;
  const { label } = n;
  if (b.dataset.p === 'center') centerOn(n.path);
  else if (b.dataset.p === 'link') connectModal({ id, label, type: n.kind === 'idea' ? 'concept' : 'book' });
  else if (b.dataset.p === 'rede') {
    // abre a rede já focada neste ponto
    ses.set('grifo.mapFocus', { id, depth: 1, trail: [{ id, label, type: n.kind === 'idea' ? 'concept' : 'book' }] });
    try { localStorage.setItem('grifo.mapMode', 'rede'); } catch { /* sem armazenamento */ }
    render();
  }
}

// ---- busca: o que for encontrado vai para o centro ----
function find(q) {
  const k = q.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  if (!k) return;
  const has = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').includes(k);
  const idx = M.idx;
  const t = [...idx.themes.values()].find((x) => has(x.label));
  if (t) return go('theme', t.key);
  for (const th of idx.themes.values()) { const s = [...th.subs.values()].find((x) => has(x.label)); if (s) return go('subtheme', `${th.key}|${s.key}`); }
  const b = idx.books.find((x) => has(x.title));
  if (b) return go('book', b.id);
  const i = [...idx.ideas.values()].find((x) => has(x.label));
  if (i) return go('idea', i.key);
  toast('Nada encontrado no mapa.');
  function go(kind, key) {
    M.trail = M.root.kind === 'lib' ? [] : [...M.trail, { kind: M.root.kind, key: M.root.key, label: M.root.label }].slice(-5);
    setRoot(kind, key, true);
  }
}

// ---- ferramentas ----
function tool(t) {
  const r = M.svg.getBoundingClientRect();
  if (t === 'in') zoomAt(r.width / 2, r.height / 2, 1.25);
  else if (t === 'out') zoomAt(r.width / 2, r.height / 2, 1 / 1.25);
  else if (t === 'fit') fitView();
  else if (t === 'none') { M.open.clear(); ses.set(openKey(M.root), []); draw(true); }
  else if (t === 'all') {
    // abre até 2 níveis abaixo do centro (sem passar de ~250 galhos)
    let count = 0;
    const walk = (n, depth) => {
      if (depth >= 2 || count > 250) return;
      for (const c of childrenOf(M.idx, n).slice(0, 25)) {
        const path = `${n.path || 'root'}/${c.kind}:${c.key}`;
        c.path = path;
        if (c.kind !== 'note' && childrenOf(M.idx, c).length) { M.open.add(path); count++; walk(c, depth + 1); }
      }
    };
    M.root.path = 'root';
    walk(M.root, 0);
    ses.set(openKey(M.root), [...M.open]);
    draw(true);
  } else if (t === 'png') exportPng();
}

// imagem do mapa (o que está aberto), em alta resolução
function exportPng() {
  const { x0, y0, x1, y1 } = bounds();
  const w = x1 - x0 + 40, h = y1 - y0 + 40;
  const s = Math.min(3, 4000 / Math.max(w, h));
  const clone = M.svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('viewBox', `${x0 - 20} ${y0 - 20} ${w} ${h}`);
  clone.setAttribute('width', String(Math.round(w * s)));
  clone.setAttribute('height', String(Math.round(h * s)));
  clone.querySelector('#galhos-view')?.removeAttribute('transform');
  clone.insertAdjacentHTML('afterbegin', `<rect x="${x0 - 20}" y="${y0 - 20}" width="${w}" height="${h}" fill="${M.colors.bg}"/>`);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = Math.round(w * s); c.height = Math.round(h * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    c.toBlob((blob) => { if (blob) downloadFile(new File([blob], `mapa-grifo-${M.root.label.replace(/[^\p{L}\d]+/gu, '-').toLowerCase()}.png`, { type: 'image/png' })); }, 'image/png');
  };
  img.onerror = () => toast('Não consegui gerar a imagem.', 'err');
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
}
