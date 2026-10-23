// Mapa mental estilo Obsidian: grafo de forças em <canvas>, com zoom, arrasto e toque.

const RADIUS = { theme: 9, subtheme: 7, book: 8, concept: 6, tag: 5, note: 4 };

function palette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (k) => cs.getPropertyValue(k).trim();
  return {
    hobby: v('--c-hobby'), professional: v('--c-pro'), academic: v('--c-acad'),
    theme: v('--c-theme'), subtheme: v('--c-sub'), tag: v('--c-tag'), note: v('--c-note'), concept: v('--c-concept'),
    line: v('--graph-line'), text: v('--text'), surface: v('--surface'), accent: v('--accent'),
  };
}

export function createGraph(canvas, data, { onSelect = () => {} } = {}) {
  const ctx = canvas.getContext('2d');
  const nodes = data.nodes.map((n, i) => {
    const a = i * 2.4;
    return { ...n, x: Math.cos(a) * (40 + i * 3), y: Math.sin(a) * (40 + i * 3), vx: 0, vy: 0 };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = data.links.map((l) => ({ s: byId.get(l.source), t: byId.get(l.target) })).filter((l) => l.s && l.t);
  const adj = new Map(nodes.map((n) => [n, new Set()]));
  for (const l of links) { adj.get(l.s).add(l.t); adj.get(l.t).add(l.s); }
  for (const n of nodes) n.r = (RADIUS[n.type] || 5) + Math.min(8, Math.sqrt(adj.get(n).size) * 1.4);

  let view = { x: 0, y: 0, k: 1 };
  let alpha = 1;
  let selected = null;
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
        if (d2 > 250000) continue;
        const d = Math.sqrt(d2);
        const f = (2800 / d2) * alpha;
        a.vx -= (dx / d) * f; a.vy -= (dy / d) * f;
        b.vx += (dx / d) * f; b.vy += (dy / d) * f;
      }
    }
    for (const { s, t } of links) {
      const dx = t.x - s.x, dy = t.y - s.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - (60 + s.r + t.r)) * 0.05 * alpha;
      s.vx += (dx / d) * f; s.vy += (dy / d) * f;
      t.vx -= (dx / d) * f; t.vy -= (dy / d) * f;
    }
    for (const a of nodes) {
      a.vx -= a.x * 0.003 * alpha;
      a.vy -= a.y * 0.003 * alpha;
      if (a.fixed) { a.vx = a.vy = 0; continue; }
      a.vx *= 0.55; a.vy *= 0.55;
      a.x += a.vx; a.y += a.vy;
    }
    alpha = Math.max(0, alpha * 0.985);
    dirty = true;
  }

  function color(n) {
    if (n.type === 'book') return colors[n.purpose] || colors.hobby;
    return colors[n.type] || colors.note;
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * view.k, 0, 0, dpr * view.k, (cssW / 2 + view.x) * dpr, (cssH / 2 + view.y) * dpr);
    const near = selected ? adj.get(selected) : null;
    const lit = (n) => !selected || n === selected || near.has(n);

    ctx.lineWidth = 1.2 / view.k;
    for (const { s, t } of links) {
      const on = selected && (s === selected || t === selected);
      ctx.globalAlpha = !selected ? 0.7 : on ? 1 : 0.12;
      ctx.strokeStyle = on ? colors.accent : colors.line;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(t.x, t.y); ctx.stroke();
    }
    for (const n of nodes) {
      ctx.globalAlpha = lit(n) ? 1 : 0.18;
      ctx.fillStyle = color(n);
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
      if (n === selected) {
        ctx.lineWidth = 3 / view.k;
        ctx.strokeStyle = colors.accent;
        ctx.stroke();
        ctx.lineWidth = 1.2 / view.k;
      }
    }
    const fs = 11 / view.k;
    ctx.font = `600 ${fs}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const n of nodes) {
      const show = n === selected || (near && near.has(n)) ||
        (!selected && (view.k > 1.4 || n.type === 'theme' || n.type === 'subtheme' || (n.type === 'book' && view.k > 0.7) || adj.get(n).size >= 4));
      if (!show) continue;
      const label = n.label.length > 30 ? `${n.label.slice(0, 29)}…` : n.label;
      ctx.globalAlpha = lit(n) ? 1 : 0.3;
      ctx.lineWidth = 3 / view.k;
      ctx.strokeStyle = colors.surface;
      ctx.strokeText(label, n.x, n.y + n.r + 3 / view.k);
      ctx.fillStyle = colors.text;
      ctx.fillText(label, n.x, n.y + n.r + 3 / view.k);
    }
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
  function hit(sx, sy) {
    const p = toWorld(sx, sy);
    let best = null, bestD = Infinity;
    for (const n of nodes) {
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < n.r + 8 / view.k && d < bestD) { best = n; bestD = d; }
    }
    return best;
  }
  function zoomAt(sx, sy, factor) {
    const p = toWorld(sx, sy);
    view.k = Math.min(4, Math.max(0.2, view.k * factor));
    view.x = sx - cssW / 2 - p.x * view.k;
    view.y = sy - cssH / 2 - p.y * view.k;
    dirty = true;
  }

  function select(n, notify = true) {
    selected = n;
    dirty = true;
    if (notify) onSelect(n, n ? [...adj.get(n)] : []);
  }

  function fit() {
    if (!nodes.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
    view.k = Math.min(2, cssW / (x1 - x0 + 80), cssH / (y1 - y0 + 80));
    view.x = -((x0 + x1) / 2) * view.k;
    view.y = -((y0 + y1) / 2) * view.k;
    dirty = true;
  }

  function focus(n) {
    view.k = Math.max(view.k, 1.2);
    view.x = -n.x * view.k;
    view.y = -n.y * view.k;
    select(n);
  }

  // ---- interação (mouse e toque) ----
  const pointers = new Map();
  let drag = null, pinch = null;
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  canvas.addEventListener('pointerdown', (e) => {
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
    const node = hit(p.x, p.y);
    drag = { node, start: p, last: p, moved: false };
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
    if (drag.node) {
      const w = toWorld(p.x, p.y);
      drag.node.x = w.x; drag.node.y = w.y;
      alpha = Math.max(alpha, 0.3);
    } else {
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
    if (!drag.moved) select(drag.node && drag.node === selected ? null : drag.node);
    drag = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = pos(e);
    zoomAt(p.x, p.y, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const recolor = () => { colors = palette(); dirty = true; };
  mq.addEventListener('change', recolor);
  function cleanup() { ro.disconnect(); mq.removeEventListener('change', recolor); }

  resize();
  for (let i = 0; i < 220; i++) tick();
  alpha = 0.15;
  fit();
  requestAnimationFrame(frame);

  // Imagem do mapa para compartilhar (sempre em fundo escuro, que realça as cores)
  function snapshot({ width = 1080, height = 1350, title = '', subtitle = '', handle = '' } = {}) {
    const DARK = {
      hobby: '#f0aa86', professional: '#98a5fb', academic: '#79c8b0', theme: '#c3a6ef',
      subtheme: '#9f8ad0', tag: '#7fb0d4', note: '#8c909c', concept: '#e9c870',
    };
    const SANS = '"Inter", system-ui, sans-serif';
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

    const top = 300, bottom = height - 170, side = 70;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
    const s = Math.min(3, (width - side * 2) / (x1 - x0 || 1), (bottom - top) / (y1 - y0 || 1));
    const P = (n) => [width / 2 + (n.x - (x0 + x1) / 2) * s, (top + bottom) / 2 + (n.y - (y0 + y1) / 2) * s];
    const nodeColor = (n) => (n.type === 'book' ? DARK[n.purpose] || DARK.hobby : DARK[n.type] || DARK.note);
    const r = (n) => n.r * Math.min(2.2, Math.max(1.3, s));

    x.strokeStyle = 'rgba(200,205,255,.22)';
    x.lineWidth = 2;
    for (const { s: a, t: b } of links) {
      const [ax, ay] = P(a), [bx, by] = P(b);
      x.beginPath(); x.moveTo(ax, ay); x.lineTo(bx, by); x.stroke();
    }
    for (const n of nodes) {
      const [nx, ny] = P(n);
      x.save();
      x.shadowColor = nodeColor(n);
      x.shadowBlur = 22;
      x.fillStyle = nodeColor(n);
      x.beginPath(); x.arc(nx, ny, r(n), 0, Math.PI * 2); x.fill();
      x.restore();
    }
    x.textAlign = 'center';
    x.textBaseline = 'top';
    for (const n of nodes) {
      if (!(n.type === 'book' || n.type === 'theme' || n.type === 'subtheme' || n.type === 'concept' || adj.get(n).size >= 4)) continue;
      const [nx, ny] = P(n);
      const label = n.label.length > 26 ? `${n.label.slice(0, 25)}…` : n.label;
      x.font = `600 ${n.type === 'theme' ? 26 : 21}px ${SANS}`;
      x.lineWidth = 6;
      x.strokeStyle = 'rgba(20,21,27,.85)';
      x.strokeText(label, nx, ny + r(n) + 6);
      x.fillStyle = 'rgba(255,255,255,.92)';
      x.fillText(label, nx, ny + r(n) + 6);
    }
    x.textBaseline = 'alphabetic';
    x.fillStyle = '#ffffff';
    x.font = '600 66px "Fraunces", Georgia, serif';
    x.fillText(title, width / 2, 160);
    x.fillStyle = 'rgba(255,255,255,.68)';
    x.font = `400 34px ${SANS}`;
    x.fillText(subtitle, width / 2, 225);
    x.fillStyle = 'rgba(255,255,255,.6)';
    x.font = `600 30px ${SANS}`;
    x.fillText(`Grifo${handle ? `  ·  ${handle}` : ''}`, width / 2, height - 70);
    return c;
  }

  return {
    fit,
    recolor,
    snapshot,
    stats: () => ({ nodes: nodes.length, links: links.length, books: nodes.filter((n) => n.type === 'book').length }),
    zoom: (f) => zoomAt(cssW / 2, cssH / 2, f),
    selectById(id) { const n = byId.get(id); if (n) focus(n); },
    find(q) {
      const k = q.trim().toLowerCase();
      const n = k && nodes.find((x) => x.label.toLowerCase().includes(k));
      if (n) focus(n);
      return !!n;
    },
  };
}
