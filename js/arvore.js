// Mapa em galhos (mapa mental clássico): os dados saem dos livros e notas, e os galhos se abrem a
// partir de um centro (a biblioteca, um tema, um livro ou uma ideia). Funções puras: o desenho e o
// toque ficam em telas/galhos.js.
import { norm, linksOf, plainText } from './util.js';

/**
 * Índice da biblioteca para montar os galhos.
 * @param {{ books: object[], notes: object[], resolve: (name: string) => { type: string } }} p
 *   books: livros e artigos à mostra (já filtrados); resolve: o que um [[nome]] é (livro, nota ou ideia)
 */
export function buildIndex({ books, notes, resolve }) {
  const byId = new Map(books.map((b) => [b.id, b]));
  const notesByBook = new Map();
  const loose = [];
  const ideas = new Map(); // chave → { key, label, tag, books: Set, notes: [] }
  const bookIdeas = new Map(); // livro → (ideia → nº de notas)
  for (const n of notes) {
    const b = byId.get(n.bookId);
    if (n.bookId && !b) continue; // livro fora do filtro (ou apagado)
    if (b) { if (!notesByBook.has(b.id)) notesByBook.set(b.id, []); notesByBook.get(b.id).push(n); } else loose.push(n);
    // ideias desta nota: as tags e os [[ ]] que não são livro nem nota (a ideia vale mais que a tag de mesmo nome)
    const keys = new Map();
    for (const t of n.tags || []) keys.set(norm(t), { label: `#${t}`, tag: true });
    for (const l of linksOf(n.text)) if (resolve(l).type === 'concept') keys.set(norm(l), { label: l, tag: false });
    for (const [k, v] of keys) {
      const idea = ideas.get(k) || { key: k, label: v.label, tag: v.tag, books: new Set(), notes: [] };
      if (!v.tag) { idea.label = v.label; idea.tag = false; }
      idea.notes.push(n);
      if (b) {
        idea.books.add(b.id);
        if (!bookIdeas.has(b.id)) bookIdeas.set(b.id, new Map());
        const m = bookIdeas.get(b.id);
        m.set(k, (m.get(k) || 0) + 1);
      }
      ideas.set(k, idea);
    }
  }
  const themes = new Map();
  const noGenre = [];
  for (const b of books) {
    if (!b.genre) { noGenre.push(b); continue; }
    const tk = norm(b.genre);
    if (!themes.has(tk)) themes.set(tk, { key: tk, label: b.genre, books: [], subs: new Map() });
    const t = themes.get(tk);
    t.books.push(b);
    const sk = norm(b.subtheme || '');
    if (sk && sk !== tk) {
      if (!t.subs.has(sk)) t.subs.set(sk, { key: sk, label: b.subtheme, books: [] });
      t.subs.get(sk).books.push(b);
    }
  }
  return { books, byId, notesByBook, loose, ideas, bookIdeas, themes, noGenre };
}

const byCount = (a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR');
const snippet = (n) => { const t = plainText(n.text).replace(/\s+/g, ' ').trim(); return t.length > 70 ? `${t.slice(0, 69)}…` : t; };
const noteNode = (n) => ({ kind: 'note', key: n.id, label: snippet(n), count: 0, page: n.page || null });

export function bookNode(idx, b) {
  return { kind: 'book', key: b.id, label: b.title, count: (idx.notesByBook.get(b.id) || []).length, article: b.kind === 'article' || b.kind === 'pdf', theme: norm(b.genre || '') };
}

/** O nó de um centro escolhido (biblioteca, tema, subtema, livro ou ideia). */
export function nodeOf(idx, kind, key = '') {
  if (kind === 'theme') { const t = idx.themes.get(key); return t && { kind, key, label: t.label, count: t.books.length, theme: key }; }
  if (kind === 'subtheme') {
    const [tk, sk] = key.split('|');
    const s = idx.themes.get(tk)?.subs.get(sk);
    return s && { kind, key, label: s.label, count: s.books.length, theme: tk };
  }
  if (kind === 'book') { const b = idx.byId.get(key); return b && bookNode(idx, b); }
  if (kind === 'idea') { const i = idx.ideas.get(key); return i && { kind, key, label: i.label, count: i.notes.length, tag: i.tag }; }
  return { kind: 'lib', key: '', label: 'Minha biblioteca', count: idx.books.length };
}

/** Os galhos de um nó (na ordem em que aparecem). */
export function childrenOf(idx, node) {
  switch (node.kind) {
    case 'lib': {
      const out = [...idx.themes.values()].map((t) => ({ kind: 'theme', key: t.key, label: t.label, count: t.books.length, theme: t.key })).sort(byCount);
      if (idx.noGenre.length) out.push({ kind: 'nogenre', key: '', label: 'Sem tema', count: idx.noGenre.length });
      if (idx.loose.length) out.push({ kind: 'loose', key: '', label: 'Notas soltas', count: idx.loose.length });
      return out;
    }
    case 'theme': {
      const t = idx.themes.get(node.key);
      if (!t) return [];
      const subs = [...t.subs.values()].map((s) => ({ kind: 'subtheme', key: `${t.key}|${s.key}`, label: s.label, count: s.books.length, theme: t.key })).sort(byCount);
      const inSub = new Set([...t.subs.values()].flatMap((s) => s.books.map((b) => b.id)));
      return [...subs, ...t.books.filter((b) => !inSub.has(b.id)).map((b) => bookNode(idx, b)).sort(byCount)];
    }
    case 'subtheme': {
      const [tk, sk] = node.key.split('|');
      return (idx.themes.get(tk)?.subs.get(sk)?.books || []).map((b) => bookNode(idx, b)).sort(byCount);
    }
    case 'nogenre': return idx.noGenre.map((b) => bookNode(idx, b)).sort(byCount);
    case 'book': {
      const ideas = [...(idx.bookIdeas.get(node.key) || new Map())].map(([k, c]) => {
        const i = idx.ideas.get(k);
        return { kind: 'idea', key: k, label: i.label, count: c, tag: i.tag };
      }).sort(byCount);
      const notes = idx.notesByBook.get(node.key) || [];
      return notes.length ? [...ideas, { kind: 'notes', key: node.key, label: notes.length === 1 ? '1 grifo' : `${notes.length} grifos`, count: 0 }] : ideas; // o número já está no nome
    }
    case 'notes':
      return [...(idx.notesByBook.get(node.key) || [])]
        .sort((a, b) => (a.page || 0) - (b.page || 0) || (a.createdAt || 0) - (b.createdAt || 0)).map(noteNode);
    case 'idea': {
      const i = idx.ideas.get(node.key);
      if (!i) return [];
      const out = [...i.books].map((id) => {
        const b = idx.byId.get(id);
        const c = i.notes.filter((n) => n.bookId === id).length;
        return { kind: 'ideaBook', key: `${i.key}|${id}`, label: b.title, count: c, article: b.kind === 'article' || b.kind === 'pdf', theme: norm(b.genre || ''), bookId: id };
      }).sort(byCount);
      out.push(...i.notes.filter((n) => !idx.byId.has(n.bookId)).map(noteNode));
      const rel = relatedIdeas(idx, i.key);
      if (rel.length) out.push({ kind: 'related', key: i.key, label: 'Ideias próximas', count: rel.length });
      return out;
    }
    case 'ideaBook': {
      const [k, id] = [node.key.slice(0, node.key.lastIndexOf('|')), node.key.slice(node.key.lastIndexOf('|') + 1)];
      return (idx.ideas.get(k)?.notes || []).filter((n) => n.bookId === id).map(noteNode);
    }
    case 'related': return relatedIdeas(idx, node.key);
    case 'loose': return idx.loose.map(noteNode);
    default: return [];
  }
}

// ideias citadas nas mesmas notas que esta
function relatedIdeas(idx, key) {
  const i = idx.ideas.get(key);
  if (!i) return [];
  const count = new Map();
  const ids = new Set(i.notes.map((n) => n.id));
  for (const [k, other] of idx.ideas) {
    if (k === key) continue;
    const c = other.notes.filter((n) => ids.has(n.id)).length;
    if (c) count.set(k, c);
  }
  return [...count].map(([k, c]) => ({ kind: 'idea', key: k, label: idx.ideas.get(k).label, count: c, tag: idx.ideas.get(k).tag })).sort(byCount);
}

export const ROW = 40; // altura de cada galho-folha
const GAP = 46; // espaço entre colunas
export const MAX_KIDS = 25; // galhos por nó antes do "+ N mais"

/**
 * Posições dos galhos à mostra: o centro em (0,0), metade dos galhos para cada lado.
 * @param {object} root nó do centro
 * @param {{ children: (n) => object[], expanded: Set<string>, limits?: Map<string, number>, measure: (n) => number }} o
 * @returns {{ nodes: object[], edges: { from: object, to: object }[] }}
 */
export function layoutTree(root, { children, expanded, limits = new Map(), measure }) {
  const nodes = [];
  const edges = [];
  const grow = (n, path, depth) => {
    Object.assign(n, { path, depth, w: measure(n) });
    const kids = n.kind === 'more' || n.kind === 'note' ? [] : children(n);
    n.total = kids.length;
    n.open = depth === 0 || expanded.has(path);
    n.kids = [];
    if (!n.open || !kids.length) return;
    const lim = limits.get(path) || MAX_KIDS;
    n.kids = kids.slice(0, lim);
    if (kids.length > lim) n.kids.push({ kind: 'more', key: path, label: `+ ${kids.length - lim} mais`, count: 0 });
    for (const c of n.kids) grow(c, `${path}/${c.kind}:${c.key}`, depth + 1);
  };
  grow(root, 'root', 0);
  const leaves = (n) => (n.kids.length ? n.kids.reduce((s, k) => s + leaves(k), 0) : 1);
  // metade dos galhos (pelo tamanho) para a direita, o resto para a esquerda
  const total = root.kids.reduce((s, k) => s + leaves(k), 0);
  const right = [];
  const left = [];
  let acc = 0;
  for (const k of root.kids) {
    if (!right.length || acc + leaves(k) / 2 <= total / 2) { right.push(k); acc += leaves(k); } else left.push(k);
  }
  const place = (n, dir, x, cur) => {
    n.x = x;
    n.side = dir;
    if (!n.kids.length) { n.y = cur.y + ROW / 2; cur.y += ROW; return; }
    for (const c of n.kids) place(c, dir, x + dir * (n.w / 2 + GAP + c.w / 2), cur);
    n.y = (n.kids[0].y + n.kids.at(-1).y) / 2;
  };
  for (const [side, dir] of [[right, 1], [left, -1]]) {
    const cur = { y: 0 };
    for (const k of side) place(k, dir, dir * (root.w / 2 + GAP + k.w / 2), cur);
    // cada lado centrado na altura do centro
    const shift = cur.y / 2;
    const fix = (n) => { n.y -= shift; n.kids.forEach(fix); };
    side.forEach(fix);
  }
  Object.assign(root, { x: 0, y: 0, side: 0 });
  const walk = (n) => { nodes.push(n); for (const c of n.kids) { edges.push({ from: n, to: c }); walk(c); } };
  walk(root);
  return { nodes, edges };
}
