// Quadros livres (como o Obsidian Canvas): a pessoa monta o raciocínio de um trabalho ou prova
// arrastando grifos, livros e textos como cartões e ligando com setas que têm rótulo ("explica",
// "contradiz"…). Cada quadro é um registro do depósito "boards" (sincroniza com a conta).
import { esc, plainText, norm } from '../util.js';
import { tr } from '../i18n.js';
import { uid } from '../db.js';
import * as Cloud from '../cloud.js';
import { planoDe } from '../../supabase/functions/_shared/planos.js';
import { state, $, toast, openModal, closeModal, persist, commit, remove, bookById, noteById, srcHref, empty } from '../app.js';

const CARD_W = 220;
const LABELS = ['explica', 'contradiz', 'é exemplo de', 'causa', 'complementa', 'depende de', 'leva a'];
// quantos quadros cada plano tem (no modo pessoal, sem limite)
const boardLimit = () => (Cloud.plan() === 'personal' ? Infinity : planoDe(Cloud.plan()).boards);

// ---------- lista ----------
export function mountQuadrosLista(body) {
  const boards = [...(state.boards || [])].sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  const lim = boardLimit();
  body.innerHTML = `<div class="row between wrap gap-s" style="margin-bottom:10px">
      <p class="small muted" style="margin:0;flex:1 1 240px">Monte o raciocínio de um trabalho ou prova: arraste grifos, livros e textos como cartões e ligue com setas.</p>
      <button class="btn primary" id="board-new">＋ Novo quadro</button></div>
    ${Number.isFinite(lim) ? `<p class="small muted">${boards.length} de ${lim} ${lim === 1 ? 'quadro' : 'quadros'} no seu plano · <a href="#/plus">ilimitados no Pro</a></p>` : ''}
    ${boards.length ? `<div class="boards-grid">${boards.map((b) => `<a class="card board-item" href="#/quadro/${b.id}"><b>${esc(b.title)}</b>
        <span class="small muted">${b.items.length} ${b.items.length === 1 ? 'cartão' : 'cartões'} · ${b.edges.length} ${b.edges.length === 1 ? 'seta' : 'setas'}</span></a>`).join('')}</div>`
      : empty('Crie um quadro para um trabalho, um capítulo ou uma prova e junte nele os grifos que importam.')}`;
  $('#board-new', body).onclick = newBoard;
}

function newBoard() {
  const lim = boardLimit();
  if ((state.boards || []).length >= lim) {
    toast(`⭐ Seu plano tem ${lim} ${lim === 1 ? 'quadro' : 'quadros'} · <u>ver planos</u>`, 'gold', () => { location.hash = '#/plus'; });
    return;
  }
  openModal(`<form class="form" id="board-form"><h3>🗂️ Novo quadro</h3>
    <label>Nome <input name="title" required placeholder="ex: TCC – capítulo 2" autocomplete="off"></label>
    <div class="actions"><button type="button" class="btn ghost" data-action="close">Cancelar</button><button class="btn primary">Criar</button></div></form>`, (root) => {
    const form = $('#board-form', root);
    form.title.focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const b = { id: uid(), createdAt: Date.now(), title: form.title.value.trim(), items: [], edges: [] };
      closeModal();
      await commit(() => persist('boards', b), { rerender: false, quiet: true });
      location.hash = `#/quadro/${b.id}`;
    };
  });
}

// ---------- quadro ----------
let B = null; // estado do quadro aberto

export function mountQuadro(el, id) {
  const board = (state.boards || []).find((x) => x.id === id);
  if (!board) { el.innerHTML = `<a href="#/mapa" class="back">← Quadros</a>${empty('Quadro não encontrado.')}`; return; }
  el.innerHTML = `<div class="row between wrap gap-s"><a href="#/mapa" class="back" style="margin:0">← Quadros</a>
      <button class="board-title link-btn" data-b="rename" title="Renomear">${esc(board.title)} ✏️</button></div>
    <div class="board-tools row gap-s wrap">
      <button class="btn small" data-b="note">＋ Grifo</button><button class="btn small" data-b="book">＋ Livro</button><button class="btn small" data-b="text">＋ Texto</button>
      <span class="grow"></span>
      <button class="btn small ghost" data-b="fit" aria-label="Enquadrar tudo">⤢</button><button class="btn small ghost" data-b="delete" aria-label="Excluir quadro">🗑️</button></div>
    <div class="board" id="board"><div class="board-inner" id="board-inner"><svg class="board-edges" id="board-edges" data-no-tr></svg></div>
      <div class="board-hint" id="board-hint" hidden></div></div>
    <p class="hint">Arraste os cartões. Toque em 🔗 num cartão e depois em outro para ligar com uma seta; toque no rótulo da seta para mudar ou apagar.</p>`;
  B = { board: structuredClone(board), el, view: { x: 40, y: 40, k: 1 }, selected: null, linking: null, saveTimer: 0 };
  drawCards();
  if (B.board.items.length) fitView(); else applyView();
  bindBoard();
  el.querySelectorAll('[data-b]').forEach((b) => { b.onclick = () => tool(b.dataset.b); });
}

const save = () => {
  clearTimeout(B.saveTimer);
  const snapshot = structuredClone(B.board);
  B.saveTimer = setTimeout(() => commit(() => persist('boards', snapshot), { rerender: false, quiet: true }), 400);
};

function cardHtml(it) {
  let body = '', foot = '';
  if (it.type === 'note') {
    const n = noteById(it.ref);
    if (!n) body = `<i class="muted">${tr('Grifo apagado')}</i>`;
    else {
      const t = plainText(n.text).replace(/\s+/g, ' ').trim();
      body = `“${esc(t.length > 220 ? `${t.slice(0, 219)}…` : t)}”`;
      const bk = bookById(n.bookId);
      foot = `${bk ? esc(bk.title) : tr('Nota solta')}${n.page ? ` · p. ${n.page}` : ''}`;
    }
  } else if (it.type === 'book') {
    const bk = bookById(it.ref);
    body = bk ? `<b>${esc(bk.title)}</b>` : `<i class="muted">${tr('Livro apagado')}</i>`;
    foot = bk?.author ? esc(bk.author) : '';
  } else body = esc(it.text || '').replace(/\n/g, '<br>');
  return `<div class="bcard bcard-${it.type}${B.selected === it.id ? ' selected' : ''}${B.linking === it.id ? ' linking' : ''}" data-card="${it.id}" style="left:${it.x}px;top:${it.y}px;width:${CARD_W}px">
    <div class="bcard-body">${body}</div>${foot ? `<div class="bcard-foot">${foot}</div>` : ''}
    <div class="bcard-act"><button data-c="link" aria-label="Ligar a outro cartão" title="Ligar">🔗</button>${it.type !== 'text' ? '<button data-c="open" aria-label="Abrir" title="Abrir">↗</button>' : '<button data-c="edit" aria-label="Editar texto" title="Editar">✏️</button>'}<button data-c="del" aria-label="Tirar do quadro" title="Tirar do quadro">✕</button></div></div>`;
}

function drawCards() {
  const inner = $('#board-inner', B.el);
  inner.querySelectorAll('.bcard').forEach((c) => c.remove());
  inner.insertAdjacentHTML('beforeend', B.board.items.map(cardHtml).join(''));
  drawEdges();
}

// a seta vai da borda de um cartão à borda do outro, com o rótulo no meio
function drawEdges() {
  const svg = $('#board-edges', B.el);
  const box = (id) => { const c = B.el.querySelector(`[data-card="${id}"]`); const it = B.board.items.find((x) => x.id === id); return c && it && { x: it.x, y: it.y, w: c.offsetWidth, h: c.offsetHeight }; };
  const clip = (r, tx, ty) => {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, dx = tx - cx, dy = ty - cy;
    const s = Math.min(Math.abs((r.w / 2 + 4) / (dx || 1e-9)), Math.abs((r.h / 2 + 4) / (dy || 1e-9)));
    return [cx + dx * s, cy + dy * s];
  };
  const parts = ['<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>'];
  for (const e of B.board.edges) {
    const a = box(e.a), b = box(e.b);
    if (!a || !b) continue;
    const [x1, y1] = clip(a, b.x + b.w / 2, b.y + b.h / 2);
    const [x2, y2] = clip(b, a.x + a.w / 2, a.y + a.h / 2);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    parts.push(`<g class="bedge" data-edge="${e.id}"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="transparent" stroke-width="14"/>
      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-width="1.6" marker-end="url(#arrow)"/>
      ${e.label ? `<text x="${mx}" y="${my - 6}" text-anchor="middle" class="bedge-label">${esc(e.label)}</text>` : `<circle cx="${mx}" cy="${my}" r="5" class="bedge-dot"/>`}</g>`);
  }
  svg.innerHTML = parts.join('');
}

function applyView() {
  const inner = $('#board-inner', B.el);
  inner.style.transform = `translate(${B.view.x}px, ${B.view.y}px) scale(${B.view.k})`;
}
function fitView() {
  const r = $('#board', B.el).getBoundingClientRect();
  if (!B.board.items.length) { B.view = { x: 40, y: 40, k: 1 }; applyView(); return; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const it of B.board.items) {
    const c = B.el.querySelector(`[data-card="${it.id}"]`);
    x0 = Math.min(x0, it.x); y0 = Math.min(y0, it.y);
    x1 = Math.max(x1, it.x + (c?.offsetWidth || CARD_W)); y1 = Math.max(y1, it.y + (c?.offsetHeight || 100));
  }
  const k = Math.max(0.3, Math.min(1.2, (r.width - 40) / (x1 - x0), (r.height - 40) / (y1 - y0)));
  B.view = { k, x: (r.width - (x1 - x0) * k) / 2 - x0 * k, y: (r.height - (y1 - y0) * k) / 2 - y0 * k };
  applyView();
}
function zoomAt(sx, sy, f) {
  const k = Math.min(2.5, Math.max(0.25, B.view.k * f));
  B.view.x = sx - ((sx - B.view.x) / B.view.k) * k;
  B.view.y = sy - ((sy - B.view.y) / B.view.k) * k;
  B.view.k = k;
  applyView();
}
// onde entra um cartão novo: o lugar livre mais perto do meio da tela (sem cobrir outro cartão)
function centerPoint() {
  const r = $('#board', B.el).getBoundingClientRect();
  const cx = (r.width / 2 - B.view.x) / B.view.k - CARD_W / 2;
  const cy = (r.height / 2 - B.view.y) / B.view.k - 50;
  const boxes = B.board.items.map((it) => {
    const c = B.el.querySelector(`[data-card="${it.id}"]`);
    return { x: it.x, y: it.y, w: c?.offsetWidth || CARD_W, h: c?.offsetHeight || 100 };
  });
  const free = (x, y) => boxes.every((b) => x + CARD_W + 16 <= b.x || b.x + b.w + 16 <= x || y + 110 <= b.y || b.y + b.h + 16 <= y);
  // anéis ao redor do meio: direita, baixo, esquerda, cima…
  for (let ring = 0; ring < 6; ring++) {
    for (let i = -ring; i <= ring; i++) {
      for (const [dx, dy] of [[ring, i], [i, ring], [-ring, i], [i, -ring]]) {
        const x = cx + dx * (CARD_W + 30), y = cy + dy * 140;
        if (free(x, y)) return { x, y };
      }
    }
  }
  return { x: cx, y: cy + boxes.length * 20 };
}

function hint(text) {
  const h = $('#board-hint', B.el);
  h.hidden = !text;
  h.innerHTML = text ? `${esc(text)} <button class="link-btn" data-hint-cancel>${tr('Cancelar')}</button>` : '';
}

function bindBoard() {
  const area = $('#board', B.el);
  const pts = new Map();
  let drag = null, pinch = null;
  const pos = (e) => { const r = area.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  area.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return; // os botões do cartão têm o próprio clique
    area.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, pos(e));
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) }; drag = null; return; }
    const card = e.target.closest('[data-card]');
    const edge = e.target.closest('[data-edge]');
    drag = { start: pos(e), last: pos(e), moved: false, card: card?.dataset.card || null, edge: edge?.dataset.edge || null };
  });
  area.addEventListener('pointermove', (e) => {
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
    if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) > 5) drag.moved = true;
    if (drag.moved) {
      const dx = p.x - drag.last.x, dy = p.y - drag.last.y;
      if (drag.card) {
        const it = B.board.items.find((x) => x.id === drag.card);
        it.x += dx / B.view.k; it.y += dy / B.view.k;
        const c = B.el.querySelector(`[data-card="${it.id}"]`);
        c.style.left = `${it.x}px`; c.style.top = `${it.y}px`;
        drawEdges();
      } else { B.view.x += dx; B.view.y += dy; applyView(); }
    }
    drag.last = p;
  });
  const end = (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (!drag) return;
    if (drag.moved && drag.card) save();
    if (!drag.moved) {
      if (drag.edge) editEdge(drag.edge);
      else if (drag.card) tapCard(drag.card);
      else { B.selected = null; B.linking = null; hint(''); drawCards(); }
    }
    drag = null;
  };
  area.addEventListener('pointerup', end);
  area.addEventListener('pointercancel', end);
  area.addEventListener('wheel', (e) => { e.preventDefault(); const p = pos(e); zoomAt(p.x, p.y, e.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });
  area.addEventListener('dblclick', (e) => { const c = e.target.closest('.bcard-text'); if (c) editText(c.dataset.card); });
  // botões do cartão
  area.addEventListener('click', (e) => {
    if (e.target.closest('[data-hint-cancel]')) { B.linking = null; hint(''); drawCards(); return; }
    const b = e.target.closest('[data-c]');
    if (!b) return;
    const id = b.closest('[data-card]').dataset.card;
    const it = B.board.items.find((x) => x.id === id);
    if (b.dataset.c === 'link') { B.linking = id; B.selected = id; hint(tr('Toque no cartão de destino')); drawCards(); }
    else if (b.dataset.c === 'open') location.hash = it.type === 'note' ? `#/nota/${it.ref}` : bookById(it.ref) ? srcHref(bookById(it.ref)) : '#/livros';
    else if (b.dataset.c === 'edit') editText(id);
    else if (b.dataset.c === 'del') {
      B.board.items = B.board.items.filter((x) => x.id !== id);
      B.board.edges = B.board.edges.filter((x) => x.a !== id && x.b !== id);
      B.selected = null;
      drawCards();
      save();
    }
  });
}

function tapCard(id) {
  if (B.linking && B.linking !== id) {
    const from = B.linking;
    B.linking = null;
    hint('');
    if (!B.board.edges.some((x) => (x.a === from && x.b === id) || (x.a === id && x.b === from))) {
      const edge = { id: uid(), a: from, b: id, label: '' };
      B.board.edges.push(edge);
      drawCards();
      save();
      editEdge(edge.id, true);
      return;
    }
  }
  B.selected = B.selected === id ? null : id;
  drawCards();
}

// rótulo da seta (ou apagar)
function editEdge(id, isNew = false) {
  const e = B.board.edges.find((x) => x.id === id);
  if (!e) return;
  openModal(`<form class="form" id="edge-form"><h3>${isNew ? '➝ Nova seta' : '➝ Seta'}</h3>
    <label>Como se ligam? <input name="label" list="edge-labels" value="${esc(e.label)}" placeholder="ex: explica, contradiz…" autocomplete="off"></label>
    <datalist id="edge-labels">${LABELS.map((l) => `<option value="${esc(tr(l))}">`).join('')}</datalist>
    <div class="actions"><button type="button" class="btn ghost" id="edge-del">Apagar seta</button><button class="btn primary">Salvar</button></div></form>`, (root) => {
    const form = $('#edge-form', root);
    form.label.focus();
    $('#edge-del', root).onclick = () => { B.board.edges = B.board.edges.filter((x) => x.id !== id); closeModal(); drawEdges(); save(); };
    form.onsubmit = (ev) => { ev.preventDefault(); e.label = form.label.value.trim(); closeModal(); drawEdges(); save(); };
  });
}

function editText(id) {
  const it = id ? B.board.items.find((x) => x.id === id) : null;
  openModal(`<form class="form" id="btext-form"><h3>${it ? '✏️ Texto do cartão' : '＋ Texto'}</h3>
    <textarea name="text" rows="4" required placeholder="ex: Minha tese: decisões rápidas parecem certas porque…">${esc(it?.text || '')}</textarea>
    <div class="actions"><button type="button" class="btn ghost" data-action="close">Cancelar</button><button class="btn primary">${it ? 'Salvar' : 'Adicionar'}</button></div></form>`, (root) => {
    const form = $('#btext-form', root);
    form.text.focus();
    form.onsubmit = (ev) => {
      ev.preventDefault();
      const text = form.text.value.trim();
      if (!text) return;
      if (it) it.text = text; else B.board.items.push({ id: uid(), type: 'text', text, ...centerPoint() });
      closeModal();
      drawCards();
      save();
    };
  });
}

// escolher um grifo ou um livro para pôr no quadro
function pick(kind) {
  const all = kind === 'note'
    ? [...state.notes].sort((a, b) => b.createdAt - a.createdAt).map((n) => ({ id: n.id, title: plainText(n.text).replace(/\s+/g, ' ').trim(), sub: bookById(n.bookId)?.title || tr('Nota solta') }))
    : [...state.books, ...state.articles].map((b) => ({ id: b.id, title: b.title, sub: b.author || '' }));
  const onBoard = new Set(B.board.items.filter((x) => x.type === kind).map((x) => x.ref));
  const list = (q) => {
    const k = norm(q);
    return all.filter((x) => !k || norm(`${x.title} ${x.sub}`).includes(k)).slice(0, 40)
      .map((x) => `<button type="button" class="pick-row${onBoard.has(x.id) ? ' on' : ''}" data-pick="${x.id}"><span class="grow">${esc(x.title.length > 140 ? `${x.title.slice(0, 139)}…` : x.title)}<br><small class="muted">${esc(x.sub)}</small></span>${onBoard.has(x.id) ? '<small class="muted">no quadro</small>' : ''}</button>`).join('')
      || `<p class="small muted">${tr('Nada encontrado.')}</p>`;
  };
  openModal(`<div class="form"><h3>${kind === 'note' ? '＋ Grifo no quadro' : '＋ Livro no quadro'}</h3>
    <input type="search" class="search" id="pick-q" placeholder="${kind === 'note' ? 'Buscar nos grifos…' : 'Buscar livro ou artigo…'}" autocomplete="off" style="margin:0">
    <div class="pick-list" id="pick-list">${list('')}</div>
    <div class="actions"><button type="button" class="btn ghost" data-action="close">Fechar</button></div></div>`, (root) => {
    const q = $('#pick-q', root);
    q.oninput = () => { $('#pick-list', root).innerHTML = list(q.value); };
    q.focus();
    $('#pick-list', root).onclick = (e) => {
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      B.board.items.push({ id: uid(), type: kind, ref: b.dataset.pick, ...centerPoint() });
      closeModal();
      drawCards();
      save();
    };
  });
}

function tool(t) {
  if (t === 'note' || t === 'book') pick(t);
  else if (t === 'text') editText(null);
  else if (t === 'fit') fitView();
  else if (t === 'rename') {
    openModal(`<form class="form" id="bname-form"><h3>Renomear quadro</h3><label>Nome <input name="title" required value="${esc(B.board.title)}" autocomplete="off"></label>
      <div class="actions"><button type="button" class="btn ghost" data-action="close">Cancelar</button><button class="btn primary">Salvar</button></div></form>`, (root) => {
      const form = $('#bname-form', root);
      form.title.select();
      form.onsubmit = (e) => {
        e.preventDefault();
        B.board.title = form.title.value.trim() || B.board.title;
        closeModal();
        B.el.querySelector('.board-title').innerHTML = `${esc(B.board.title)} ✏️`;
        save();
      };
    });
  } else if (t === 'delete') {
    if (!confirm(`Excluir o quadro “${B.board.title}”? Os grifos e livros continuam no app.`)) return;
    clearTimeout(B.saveTimer);
    commit(() => remove('boards', B.board.id), { rerender: false }).then(() => { toast('🗑️ Quadro excluído'); location.hash = '#/mapa'; });
  }
}
