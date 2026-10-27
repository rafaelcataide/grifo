// Mapa de ideias por temas, em <canvas>: cada tema vira uma ilha com seus livros e subtemas;
// ideias que ligam livros de temas diferentes ficam entre as ilhas. Tocar num ponto abre o modo foco:
// só ele e os vizinhos (1 ou 2 passos), em anéis. Arrastar um ponto sobre outro liga os dois.
// Zoom, arrasto e toque; os nomes nunca se sobrepõem.

const RADIUS = { subtheme: 6, book: 8, concept: 6, tag: 5, note: 5 };
const HUES = [22, 232, 158, 282, 340, 44, 196, 110, 0, 260];
const SANS = '"Inter", system-ui, sans-serif';
const SERIF = '"Fraunces", Georgia, serif';

export const groupColor = (i, dark, a = 1) => `hsl(${HUES[i % HUES.length]} ${dark ? 62 : 52}% ${dark ? 68 : 58}% / ${a})`;

function palette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (k) => cs.getPropertyValue(k).trim();
  const bg = getComputedStyle(document.body).backgroundColor.match(/\d+/g)?.map(Number) || [255, 255, 255];
  return {
    dark: (bg[0] * 299 + bg[1] * 587 + bg[2] * 114) / 1000 < 128,
    tag: v('--c-tag'), note: v('--c-note'), concept: v('--c-concept'),
    line: v('--graph-line'), text: v('--text'), muted: v('--muted'), surface: v('--surface'), accent: v('--accent'),
  };
}

const trunc = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// Esconde tipos de ponto; os pontos que se ligavam por um ponto escondido passam a se ligar entre si
export function applyShow(d, show) {
  const hidden = (n) => (n.type === 'book' && !show.books) || (n.type === 'tag' && !show.tags) || (n.type === 'concept' && !show.ideas)
    || (n.type === 'subtheme' && !show.subthemes) || (n.parent && !show.books);
  const keep = new Set(d.nodes.filter((n) => !hidden(n)).map((n) => n.id));
  const adj = new Map();
  for (const l of d.links) {
    for (const [a, b] of [[l.source, l.target], [l.target, l.source]]) { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b); }
  }
  const links = new Map();
  const add = (a, b) => { if (a !== b && keep.has(a) && keep.has(b)) links.set(a < b ? `${a}|${b}` : `${b}|${a}`, { source: a, target: b }); };
  for (const l of d.links) add(l.source, l.target);
  for (const n of d.nodes) {
    if (keep.has(n.id)) continue;
    const near = [...(adj.get(n.id) || [])].filter((x) => keep.has(x)).slice(0, 8);
    for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) add(near[i], near[j]);
  }
  const nodes = d.nodes.filter((n) => keep.has(n.id) || n.parent).filter((n) => !n.parent || show.books)
    .map((n) => (show.areas ? n : { ...n, group: '' }));
  return { nodes, links: [...links.values()], groups: show.areas ? d.groups : [] };
}


export function createGraph(canvas, data, { onSelect = () => {}, onFocus = () => {}, onConnect = () => {} } = {}) {
  const ctx = canvas.getContext('2d');
  // g.i escolhe a cor da ilha; vem pronto do app (fixo por tema) ou segue a ordem
  const groups = data.groups.map((g, i) => ({ ...g, i: g.color >= 0 ? g.color : i }));
  const gByKey = new Map(groups.map((g) => [g.key, g]));
  const all = data.nodes.map((n) => ({ ...n, x: 0, y: 0, vx: 0, vy: 0 }));
  const byId = new Map(all.map((n) => [n.id, n]));
  const nodes = all.filter((n) => !n.parent);
  const satsOf = new Map(); // livro -> notas (aparecem ao tocar no livro)
  for (const s of all.filter((n) => n.parent)) {
    s.p = byId.get(s.parent);
    if (!s.p) continue;
    s.r = RADIUS.note;
    if (!satsOf.has(s.p)) satsOf.set(s.p, []);
    satsOf.get(s.p).push(s);
  }
  const links = data.links.map((l) => ({ s: byId.get(l.source), t: byId.get(l.target) })).filter((l) => l.s && l.t && !l.s.p && !l.t.p);
  const adj = new Map(nodes.map((n) => [n, new Set()]));
  for (const l of links) { adj.get(l.s).add(l.t); adj.get(l.t).add(l.s); }
  for (const n of nodes) n.r = (RADIUS[n.type] || 5) + Math.min(8, Math.sqrt(n.weight ?? adj.get(n).size) * 1.5);

  // Ideia sem tema próprio: fica na ilha dos vizinhos se todos forem de um tema; senão, entre as ilhas.
  for (const n of nodes) {
    if (n.group) continue;
    const homes = new Set([...adj.get(n)].map((m) => m.group).filter(Boolean));
    if (homes.size === 1) n.group = [...homes][0];
    else n.homes = [...homes].map((k) => gByKey.get(k));
  }

  // Centros das ilhas: espiral inicial e depois afastadas até não se encostarem
  const count = new Map();
  for (const n of nodes) if (n.group) count.set(n.group, (count.get(n.group) || 0) + 1);
  groups.forEach((g, i) => {
    g.ra = 34 + 22 * Math.sqrt(count.get(g.key) || 1);
    const a = i * 2.4, d = 140 * Math.sqrt(i);
    g.cx = Math.cos(a) * d; g.cy = Math.sin(a) * d;
  });
  for (let it = 0; it < 300; it++) {
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i], b = groups[j];
        const dx = b.cx - a.cx, dy = b.cy - a.cy;
        const d = Math.hypot(dx, dy) || 1;
        const min = a.ra + b.ra + 46;
        if (d >= min) continue;
        const push = (min - d) / 2;
        a.cx -= (dx / d) * push; a.cy -= (dy / d) * push;
        b.cx += (dx / d) * push; b.cy += (dy / d) * push;
      }
    }
    for (const g of groups) { g.cx *= 0.995; g.cy *= 0.995; }
  }
  const target = (n) => {
    if (n.group) { const g = gByKey.get(n.group); return g && [g.cx, g.cy]; }
    if (n.homes?.length) return [n.homes.reduce((s, g) => s + g.cx, 0) / n.homes.length, n.homes.reduce((s, g) => s + g.cy, 0) / n.homes.length];
    return null;
  };
  nodes.forEach((n, i) => {
    const t = target(n) || [0, 0];
    const a = i * 2.4;
    n.x = t[0] + Math.cos(a) * 20; n.y = t[1] + Math.sin(a) * 20;
  });

  let view = { x: 0, y: 0, k: 1 };
  let alpha = 1;
  let selected = null; // nó selecionado (livro, nota, ideia…)
  let selGroup = null; // ilha selecionada
  // modo foco: ponto central, passos (1 ou 2), caminho percorrido, pontos à mostra (com o nível) e sugestões
  let focusN = null, depth = 1, trail = [], shown = null, sugg = [], home = null, dropTarget = null;
  const inView = (n) => !shown || shown.has(n);
  let dirty = true;
  let colors = palette();
  const dpr = window.devicePixelRatio || 1;
  let cssW = 0, cssH = 0;

  function resize() {
    const r = canvas.getBoundingClientRect();
    cssW = r.width; cssH = r.height;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    dirty = true;
  }

  function tick() {
    const n = nodes.length;
    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy || 0.01;
        if (d2 > 90000) continue;
        const d = Math.sqrt(d2);
        // repulsão, e um empurrão firme quando dois pontos se encostam (com espaço para o nome)
        const min = a.r + b.r + 22;
        const f = (1600 / d2) * alpha + (d < min ? (min - d) * 0.25 : 0);
        a.vx -= (dx / d) * f; a.vy -= (dy / d) * f;
        b.vx += (dx / d) * f; b.vy += (dy / d) * f;
      }
    }
    for (const { s, t } of links) {
      const dx = t.x - s.x, dy = t.y - s.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      // ligações entre ilhas puxam pouco, para as ilhas não se misturarem
      const same = s.group && s.group === t.group;
      const f = (d - (34 + s.r + t.r)) * (same ? 0.04 : 0.008) * alpha;
      s.vx += (dx / d) * f; s.vy += (dy / d) * f;
      t.vx -= (dx / d) * f; t.vy -= (dy / d) * f;
    }
    for (const a of nodes) {
      const t = target(a);
      const k = a.group ? 0.02 : 0.015;
      if (t) { a.vx += (t[0] - a.x) * k * alpha; a.vy += (t[1] - a.y) * k * alpha; } else { a.vx -= a.x * 0.003 * alpha; a.vy -= a.y * 0.003 * alpha; }
      if (a.fixed) { a.vx = a.vy = 0; continue; }
      a.vx *= 0.55; a.vy *= 0.55;
      a.x += a.vx; a.y += a.vy;
    }
    alpha = Math.max(0, alpha * 0.985);
    dirty = true;
  }

  // Ilhas: círculo que envolve os nós de cada tema (recalculado a cada quadro)
  function islands() {
    const out = [];
    for (const g of groups) {
      const m = nodes.filter((n) => n.group === g.key);
      if (!m.length) continue;
      const cx = m.reduce((s, n) => s + n.x, 0) / m.length;
      const cy = m.reduce((s, n) => s + n.y, 0) / m.length;
      const r = Math.max(46, ...m.map((n) => Math.hypot(n.x - cx, n.y - cy) + n.r + 26));
      out.push({ g, cx, cy, r, members: m });
    }
    return out;
  }

  const host = () => (selected?.p || selected);
  const visibleSats = () => {
    const h = host();
    return (h && satsOf.get(h)) || [];
  };
  // notas em anel em volta do livro selecionado
  function placeSats() {
    const h = host();
    const list = visibleSats();
    const R = h ? h.r + 40 + Math.min(50, list.length * 3) : 0;
    list.forEach((s, i) => {
      const a = -Math.PI / 2 + (i / list.length) * Math.PI * 2;
      s.x = h.x + Math.cos(a) * R; s.y = h.y + Math.sin(a) * R;
    });
    return list;
  }

  function nodeColor(n, dark = colors.dark) {
    if (n.type === 'concept') return dark ? '#e9c870' : '#c99a2e';
    if (n.type === 'tag') return colors.tag;
    const g = gByKey.get(n.group || n.p?.group);
    if (n.type === 'note') return g ? groupColor(g.i, dark, 0.75) : colors.note;
    return g ? groupColor(g.i, dark) : colors.note;
  }

  function shape(c, n, x, y, r, fill, surface) {
    c.beginPath();
    if (n.type === 'concept' || n.type === 'tag') {
      c.moveTo(x, y - r * 1.25); c.lineTo(x + r * 1.25, y); c.lineTo(x, y + r * 1.25); c.lineTo(x - r * 1.25, y); c.closePath();
      c.fillStyle = fill; c.fill();
    } else if (n.type === 'subtheme') {
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fillStyle = surface; c.fill();
      c.lineWidth = r * 0.45; c.strokeStyle = fill; c.stroke();
    } else {
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fillStyle = fill; c.fill();
    }
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const k = view.k;
    ctx.setTransform(dpr * k, 0, 0, dpr * k, (cssW / 2 + view.x) * dpr, (cssH / 2 + view.y) * dpr);
    const h = host();
    const sats = placeSats();
    const near = h ? adj.get(h) : null;
    const lit = (n) => {
      if (selGroup) return n.group === selGroup.key;
      if (!h) return true;
      return n === h || near.has(n) || n.p === h;
    };

    const isl = shown ? [] : islands();
    for (const I of isl) {
      const on = selGroup ? I.g === selGroup : !h || h.group === I.g.key || [...near].some((n) => n.group === I.g.key);
      ctx.globalAlpha = on ? 1 : 0.4;
      ctx.beginPath(); ctx.arc(I.cx, I.cy, I.r, 0, Math.PI * 2);
      ctx.fillStyle = groupColor(I.g.i, colors.dark, colors.dark ? 0.09 : 0.11);
      ctx.fill();
      ctx.lineWidth = (I.g === selGroup ? 2 : 1.2) / k;
      ctx.setLineDash([5 / k, 5 / k]);
      ctx.strokeStyle = groupColor(I.g.i, colors.dark, 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.lineWidth = 1.2 / k;
    for (const { s, t } of links) {
      if (!inView(s) || !inView(t)) continue;
      const on = h && (s === h || t === h);
      ctx.globalAlpha = shown ? (on ? 1 : 0.45) : !h && !selGroup ? 0.55 : on ? 1 : 0.1;
      ctx.strokeStyle = on ? colors.accent : colors.line;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(t.x, t.y); ctx.stroke();
    }
    // sugestões de ligação: tracejadas, a partir do ponto em foco
    if (focusN && sugg.length) {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = colors.accent;
      ctx.setLineDash([5 / k, 5 / k]);
      for (const t of sugg) { ctx.beginPath(); ctx.moveTo(focusN.x, focusN.y); ctx.lineTo(t.x, t.y); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    if (sats.length) {
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = nodeColor(h);
      ctx.setLineDash([3 / k, 3 / k]);
      for (const s of sats) { ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(s.x, s.y); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    for (const n of [...nodes, ...sats]) {
      if (!inView(n)) continue;
      ctx.globalAlpha = shown ? (shown.get(n) === 2 ? 0.7 : 1) : lit(n) ? 1 : 0.18;
      shape(ctx, n, n.x, n.y, n.r, nodeColor(n), colors.surface);
      if (n === selected || n === dropTarget) {
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r + (n === dropTarget ? 7 : 3) / k, 0, Math.PI * 2);
        ctx.lineWidth = 2.5 / k; ctx.strokeStyle = colors.accent;
        if (n === dropTarget) ctx.setLineDash([4 / k, 3 / k]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // nomes: primeiro os das ilhas, depois por importância; um nome que encostaria em outro não aparece
    const placed = [];
    const free = (r) => !placed.some((p) => r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    const write = (text, r, color, alpha, font) => {
      ctx.font = font;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 3.5 / k;
      ctx.strokeStyle = colors.surface;
      ctx.strokeText(text, r.x + 2 / k, r.y + 1 / k);
      ctx.fillStyle = color;
      ctx.fillText(text, r.x + 2 / k, r.y + 1 / k);
    };
    const gfs = 15 / k;
    for (const I of isl) {
      const font = `600 ${gfs}px ${SERIF}`;
      ctx.font = font;
      const text = trunc(I.g.label, 28);
      const w = ctx.measureText(text).width + 4 / k;
      const r = { x: I.cx - w / 2, y: I.cy - I.r - gfs * 1.35, w, h: gfs * 1.3 };
      placed.push(r);
      const on = selGroup ? I.g === selGroup : !h || h.group === I.g.key;
      write(text, r, groupColor(I.g.i, colors.dark), on ? 1 : 0.45, font);
    }
    const fs = 11.5 / k;
    const font = `600 ${fs}px ${SANS}`;
    const noteFont = `500 ${fs}px ${SANS}`;
    const tryLabel = (n, force) => {
      const f = n.type === 'note' ? noteFont : font;
      ctx.font = f;
      const text = trunc(n.label, n.type === 'note' ? 26 : 30);
      const w = ctx.measureText(text).width + 4 / k, hh = fs * 1.3, gap = 3 / k;
      const spots = [
        { x: n.x - w / 2, y: n.y + n.r + gap }, { x: n.x - w / 2, y: n.y - n.r - hh - gap },
        { x: n.x + n.r + gap, y: n.y - hh / 2 }, { x: n.x - n.r - gap - w, y: n.y - hh / 2 },
      ].map((p) => ({ ...p, w, h: hh }));
      const spot = spots.find(free) || (force ? spots[0] : null);
      if (!spot) return;
      placed.push(spot);
      write(text, spot, n.type === 'note' ? colors.muted : colors.text, shown || lit(n) ? 1 : 0.35, f);
    };
    const done = new Set();
    if (shown) {
      // no foco, todos os nomes do primeiro anel aparecem; os do segundo, se couberem
      for (const [n, l] of [...shown].sort((a, b) => a[1] - b[1])) tryLabel(n, l <= 1);
      ctx.globalAlpha = 1;
      dirty = false;
      return;
    }
    if (h) {
      for (const n of [selected, h, ...sats]) if (!done.has(n)) { done.add(n); tryLabel(n, n === selected || n === h); }
      for (const n of near) { done.add(n); tryLabel(n, false); }
    }
    const score = (n) => (n.type === 'book' ? 100 : n.type === 'subtheme' ? 60 : 30) + adj.get(n).size;
    const showAlone = (n) => (n.type === 'book' ? k > 0.5 : n.type === 'subtheme' ? k > 0.75 : adj.get(n).size >= 2 || k > 1.2);
    for (const n of nodes.filter((x) => !done.has(x) && showAlone(x)).sort((a, b) => score(b) - score(a))) tryLabel(n, false);
    ctx.globalAlpha = 1;
    dirty = false;
  }

  function frame() {
    if (!canvas.isConnected) { cleanup(); return; }
    if (alpha > 0.005) tick();
    if (dirty) draw();
    requestAnimationFrame(frame);
  }

  const toWorld = (sx, sy) => ({ x: (sx - cssW / 2 - view.x) / view.k, y: (sy - cssH / 2 - view.y) / view.k });
  function hitNode(sx, sy, skip = null) {
    const p = toWorld(sx, sy);
    let best = null, bestD = Infinity;
    for (const n of [...visibleSats(), ...nodes]) {
      if (!inView(n) || n === skip) continue;
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < n.r + 10 / view.k && d < bestD) { best = n; bestD = d; }
    }
    return best;
  }
  function hitIsland(sx, sy) {
    const p = toWorld(sx, sy);
    return islands().find((I) => Math.hypot(I.cx - p.x, I.cy - p.y) < I.r)?.g || null;
  }
  function zoomAt(sx, sy, factor) {
    const p = toWorld(sx, sy);
    view.k = Math.min(4, Math.max(0.2, view.k * factor));
    view.x = sx - cssW / 2 - p.x * view.k;
    view.y = sy - cssH / 2 - p.y * view.k;
    dirty = true;
  }

  // aproxima suavemente até um ponto (usado ao abrir as notas de um livro)
  let anim = 0;
  function animateTo(cx, cy, k) {
    const from = { ...view }, to = { x: -cx * k, y: -cy * k, k };
    const t0 = performance.now(), id = ++anim;
    const step = (now) => {
      if (id !== anim) return;
      const t = Math.min(1, (now - t0) / 280), e = 1 - (1 - t) ** 3;
      view = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: from.k + (to.k - from.k) * e };
      dirty = true;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function select(n, notify = true) {
    selected = n;
    selGroup = null;
    dirty = true;
    const h = n?.p || n;
    if (h && n === h && satsOf.get(h)?.length && view.k < 1.3) animateTo(h.x, h.y, 1.4);
    if (!notify) return;
    if (!n) { onSelect(null, []); return; }
    onSelect(n, n.p ? [n.p] : [...adj.get(h), ...(satsOf.get(h) || [])]);
  }
  function selectGroup(g) {
    selected = null;
    selGroup = g;
    dirty = true;
    const members = nodes.filter((n) => n.group === g.key);
    onSelect({ id: `g:${g.key}`, type: 'theme', label: g.label, href: g.href }, members);
  }

  function bounds() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const I of islands()) { x0 = Math.min(x0, I.cx - I.r); y0 = Math.min(y0, I.cy - I.r - 24); x1 = Math.max(x1, I.cx + I.r); y1 = Math.max(y1, I.cy + I.r); }
    for (const n of nodes) { x0 = Math.min(x0, n.x - 20); y0 = Math.min(y0, n.y - 20); x1 = Math.max(x1, n.x + 20); y1 = Math.max(y1, n.y + 20); }
    return { x0, y0, x1, y1 };
  }
  function fit() {
    if (!nodes.length) return;
    const { x0, y0, x1, y1 } = bounds();
    view.k = Math.min(1.8, cssW / (x1 - x0 + 40), cssH / (y1 - y0 + 40));
    view.x = -((x0 + x1) / 2) * view.k;
    view.y = -((y0 + y1) / 2) * view.k;
    dirty = true;
  }

  // ---- modo foco ----
  function neighborhood(c, d) {
    const lv = new Map([[c, 0]]);
    let frontier = [c];
    for (let l = 1; l <= d; l++) {
      const next = [];
      for (const n of frontier) for (const m of adj.get(n)) if (!lv.has(m)) { lv.set(m, l); next.push(m); }
      frontier = next;
    }
    return lv;
  }
  // anima os pontos até as posições dadas
  let moveAnim = 0;
  function moveTo(to) {
    const from = new Map([...to.keys()].map((n) => [n, [n.x, n.y]]));
    const t0 = performance.now(), id = ++moveAnim;
    const step = (now) => {
      if (id !== moveAnim) return;
      const t = Math.min(1, (now - t0) / 320), e = 1 - (1 - t) ** 3;
      for (const [n, [x, y]] of to) { const [fx, fy] = from.get(n); n.x = fx + (x - fx) * e; n.y = fy + (y - fy) * e; }
      dirty = true;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  const ORDER = { book: 0, subtheme: 1, concept: 2, tag: 3 };
  // o ponto no centro, os vizinhos num anel e os do segundo passo num anel de fora, perto de quem os liga
  function layoutFocus(moveView = true) {
    const lv = neighborhood(focusN, depth);
    for (const t of sugg) if (!lv.has(t)) lv.set(t, 1);
    shown = lv;
    const ring1 = [...lv].filter(([, l]) => l === 1).map(([n]) => n)
      .sort((a, b) => sugg.includes(a) - sugg.includes(b) || (ORDER[a.type] ?? 9) - (ORDER[b.type] ?? 9) || a.label.localeCompare(b.label));
    const R1 = Math.max(120, ring1.length * 24);
    const to = new Map([[focusN, [0, 0]]]);
    const ang = new Map();
    ring1.forEach((n, i) => {
      const a = -Math.PI / 2 + (i / ring1.length) * Math.PI * 2;
      ang.set(n, a);
      to.set(n, [Math.cos(a) * R1, Math.sin(a) * R1]);
    });
    const kids = new Map();
    for (const [n, l] of lv) {
      if (l !== 2) continue;
      const p = [...adj.get(n)].find((m) => lv.get(m) === 1) || ring1[0];
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(n);
    }
    const slice = (Math.PI * 2) / Math.max(1, ring1.length);
    for (const [p, list] of kids) {
      const R2 = R1 + 110 + Math.min(90, list.length * 8);
      list.forEach((n, i) => {
        const a = ang.get(p) + (list.length === 1 ? 0 : (i / (list.length - 1) - 0.5) * slice * 0.9);
        to.set(n, [Math.cos(a) * R2, Math.sin(a) * R2]);
      });
    }
    moveTo(to);
    if (moveView) {
      const ext = Math.max(60, ...[...to.values()].map(([x, y]) => Math.hypot(x, y))) + 70;
      animateTo(0, 0, Math.min(1.6, Math.min(cssW, cssH) / (ext * 2)));
    }
  }
  const focusState = () => (focusN ? { id: focusN.id, depth, trail: trail.map((t) => ({ id: t.id, label: t.label, type: t.type })) } : null);
  function focusOn(n, { trailIds = null } = {}) {
    if (!focusN) home = new Map(nodes.map((m) => [m, [m.x, m.y]]));
    focusN = n; selected = n; selGroup = null; alpha = 0; sugg = [];
    if (trailIds) trail = trailIds.map((id) => byId.get(id)).filter(Boolean);
    else { const i = trail.indexOf(n); trail = i >= 0 ? trail.slice(0, i + 1) : [...trail, n].slice(-5); }
    if (trail.at(-1) !== n) trail.push(n);
    layoutFocus();
    onSelect(n, [...adj.get(n)]);
    onFocus(focusState());
  }
  function exitFocus() {
    if (!focusN) return;
    focusN = null; shown = null; sugg = []; trail = []; selected = null;
    if (home) moveTo(home);
    home = null;
    setTimeout(fit, 340);
    onSelect(null, []);
    onFocus(null);
  }

  // ---- interação (mouse e toque) ----
  const pointers = new Map();
  let drag = null, pinch = null;
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  canvas.addEventListener('pointerdown', (e) => {
    touched = true;
    anim++; // um toque interrompe a animação
    canvas.setPointerCapture(e.pointerId);
    const p = pos(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) };
      if (drag?.node) drag.node.fixed = false;
      drag = null;
      return;
    }
    const hit = hitNode(p.x, p.y);
    const node = hit && !hit.p ? hit : null; // notas não se arrastam
    drag = { hit, node, start: p, last: p, moved: false };
    if (node) node.fixed = true;
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const p = pos(e);
    pointers.set(e.pointerId, p);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch.d);
      pinch.d = d;
      return;
    }
    if (!drag) return;
    if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) > 5) drag.moved = true;
    if (drag.node && drag.moved) {
      const w = toWorld(p.x, p.y);
      drag.node.x = w.x; drag.node.y = w.y;
      dropTarget = hitNode(p.x, p.y, drag.node); // soltar em cima de outro ponto liga os dois
      if (!focusN) alpha = Math.max(alpha, 0.3);
    } else if (!drag.node) {
      view.x += p.x - drag.last.x;
      view.y += p.y - drag.last.y;
    }
    drag.last = p;
    dirty = true;
  });

  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!drag) return;
    if (drag.node) drag.node.fixed = false;
    if (drag.node && drag.moved) {
      const target = dropTarget;
      dropTarget = null;
      if (target) onConnect(drag.node, target);
      if (focusN) layoutFocus(false); // volta para o lugar no anel
      dirty = true;
    }
    if (!drag.moved) {
      if (drag.hit) { if (drag.hit !== focusN) focusOn(drag.hit); }
      else if (!focusN) {
        const g = hitIsland(drag.start.x, drag.start.y);
        if (g && g !== selGroup) selectGroup(g);
        else select(null);
      }
    }
    drag = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    touched = true;
    const p = pos(e);
    zoomAt(p.x, p.y, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });

  // enquadra de novo ao mudar de tamanho só enquanto a pessoa não mexeu no mapa
  let touched = false;
  const ro = new ResizeObserver(() => { resize(); if (!touched && !focusN) fit(); });
  ro.observe(canvas);
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const recolor = () => { colors = palette(); dirty = true; };
  mq.addEventListener('change', recolor);
  function cleanup() { ro.disconnect(); mq.removeEventListener('change', recolor); }

  resize();
  // o mapa já aparece arrumado: a simulação roda antes do primeiro quadro
  for (let i = 0; i < 450; i++) tick();
  alpha = 0.02;
  fit();
  requestAnimationFrame(frame);

  // Imagem do mapa para compartilhar (sempre em fundo escuro, que realça as cores)
  function snapshot({ width = 1080, height = 1350, title = '', subtitle = '', handle = '', site = '' } = {}) {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const x = c.getContext('2d');
    const bg = x.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, '#14151b');
    bg.addColorStop(0.55, '#1f2233');
    bg.addColorStop(1, '#2a2436');
    x.fillStyle = bg;
    x.fillRect(0, 0, width, height);

    const top = 320, bottom = height - 170, side = 70;
    const { x0, y0, x1, y1 } = bounds();
    const s = Math.min(3, (width - side * 2) / (x1 - x0 || 1), (bottom - top) / (y1 - y0 || 1));
    const P = (px, py) => [width / 2 + (px - (x0 + x1) / 2) * s, (top + bottom) / 2 + (py - (y0 + y1) / 2) * s];
    const rs = Math.min(2.2, Math.max(1.3, s));

    const isl = islands();
    for (const I of isl) {
      const [cx, cy] = P(I.cx, I.cy);
      x.beginPath(); x.arc(cx, cy, I.r * s, 0, Math.PI * 2);
      x.fillStyle = groupColor(I.g.i, true, 0.12); x.fill();
      x.setLineDash([10, 10]); x.lineWidth = 2; x.strokeStyle = groupColor(I.g.i, true, 0.55); x.stroke(); x.setLineDash([]);
    }
    x.strokeStyle = 'rgba(200,205,255,.22)';
    x.lineWidth = 2;
    for (const { s: a, t: b } of links) {
      const [ax, ay] = P(a.x, a.y), [bx, by] = P(b.x, b.y);
      x.beginPath(); x.moveTo(ax, ay); x.lineTo(bx, by); x.stroke();
    }
    for (const n of nodes) {
      const [nx, ny] = P(n.x, n.y);
      x.save();
      x.shadowColor = nodeColor(n, true);
      x.shadowBlur = 20;
      shape(x, n, nx, ny, n.r * rs, nodeColor(n, true), '#1d1f2b');
      x.restore();
    }
    x.textAlign = 'center';
    x.textBaseline = 'top';
    for (const I of isl) {
      const [cx, cy] = P(I.cx, I.cy);
      x.font = `600 30px ${SERIF}`;
      x.fillStyle = groupColor(I.g.i, true);
      x.fillText(trunc(I.g.label, 24), cx, cy - I.r * s - 40);
    }
    const placed = [];
    for (const n of [...nodes].sort((a, b) => (b.type === 'book') - (a.type === 'book') || adj.get(b).size - adj.get(a).size)) {
      if (n.type !== 'book' && adj.get(n).size < 2) continue;
      const [nx, ny] = P(n.x, n.y);
      const label = trunc(n.label, 24);
      x.font = `600 21px ${SANS}`;
      const w = x.measureText(label).width;
      const r = { x: nx - w / 2, y: ny + n.r * rs + 6, w, h: 26 };
      if (placed.some((p) => r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y)) continue;
      placed.push(r);
      x.lineWidth = 6;
      x.strokeStyle = 'rgba(20,21,27,.85)';
      x.strokeText(label, nx, r.y);
      x.fillStyle = 'rgba(255,255,255,.92)';
      x.fillText(label, nx, r.y);
    }
    x.textBaseline = 'alphabetic';
    x.fillStyle = '#ffffff';
    x.font = `600 66px ${SERIF}`;
    x.fillText(title, width / 2, 160);
    x.fillStyle = 'rgba(255,255,255,.68)';
    x.font = `400 34px ${SANS}`;
    x.fillText(subtitle, width / 2, 225);
    x.fillStyle = 'rgba(255,255,255,.6)';
    x.font = `600 30px ${SANS}`;
    x.fillText(`Grifo${handle ? `  ·  ${handle}` : ''}`, width / 2, height - (site ? 84 : 70));
    if (site) {
      x.font = `500 22px ${SANS}`;
      x.fillStyle = 'rgba(255,255,255,.5)';
      x.fillText(site, width / 2, height - 50);
    }
    return c;
  }

  const findable = () => [...nodes, ...[...satsOf.values()].flat()];
  return {
    fit,
    recolor,
    snapshot,
    // temas presentes no mapa, com a cor de cada ilha (para a legenda)
    groups: () => groups.filter((g) => count.get(g.key)).map((g) => ({ key: g.key, label: g.label, color: groupColor(g.i, colors.dark) })),
    stats: () => ({ nodes: nodes.length, links: links.length, books: nodes.filter((n) => n.type === 'book').length, themes: groups.length }),
    zoom: (f) => zoomAt(cssW / 2, cssH / 2, f),
    focusOn(id, opts) { const n = byId.get(id); if (n) focusOn(n, opts); return !!n; },
    exitFocus,
    setDepth(d) { depth = d; if (focusN) { layoutFocus(); onFocus(focusState()); } },
    // sugestões de ligação (ids de pontos do mapa), em tracejado a partir do ponto em foco
    setSuggestions(ids) { if (!focusN) return; sugg = ids.map((id) => byId.get(id)).filter((n) => n && n !== focusN && !adj.get(focusN).has(n)); layoutFocus(false); },
    has: (id) => byId.has(id),
    selectById(id) {
      const n = byId.get(id);
      if (n) { focusOn(n); return; }
      const g = gByKey.get(id.replace(/^[cg]:/, ''));
      if (g) selectGroup(g);
    },
    find(q) {
      const k = q.trim().toLowerCase();
      if (!k) return false;
      const n = findable().find((x) => x.label.toLowerCase().includes(k));
      if (n) { focusOn(n); return true; }
      const g = groups.find((x) => x.label.toLowerCase().includes(k));
      if (g) { selectGroup(g); return true; }
      return false;
    },
  };
}
