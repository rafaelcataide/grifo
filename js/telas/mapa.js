// Mapa de ideias: dados, modo foco, ligar pontos, sugestões e notas sem ligação.
// Parte do app.js separada por tela: usa o estado e os utilitários do app (importados de ../app.js).
// o desenho do mapa (graph.js, ~30 KB) só é baixado ao abrir o mapa
import { esc, norm, linksOf, plainText, splitTags } from '../util.js';
import { uid } from '../db.js';
import { LOCALE } from '../i18n.js';
import { state, $, view, srcHref, sources, bookById, noteById, empty, conceptHref, seg, resolveLink, renderText, noteLabel, persist, commit, toast, openModal, closeModal, IDEAS_SEG, getScope, scopeActive, bookInScope, scopeFilters, aiRun, datalist, linkCandidates, actions } from '../app.js';

// ---------- mapa mental ----------
export let graphApi = null;

// Dados do mapa: cada tema é uma ilha (grupo) com seus livros e subtemas; as ligações das notas
// vão do livro para a ideia citada; as próprias notas ficam guardadas para aparecer ao tocar no livro.
// cor de cada tema: posição na lista de todos os temas da biblioteca, para não mudar com os filtros
export const themeIndex = (key) => [...new Set(state.books.map((b) => norm(b.genre || '')).filter(Boolean))].sort().indexOf(key);

// Pontos que uma nota liga: o livro dela, as tags e os [[ ]] (livro, nota com título ou ideia)
export function noteEnds(n) {
  const ends = [];
  if (bookById(n.bookId)) ends.push(`b:${n.bookId}`);
  for (const t of n.tags || []) ends.push(`c:${norm(t)}`);
  for (const l of linksOf(n.text)) {
    const r = resolveLink(l);
    if (r.type === 'note') { const bk = noteById(r.node.slice(2))?.bookId; if (bk) ends.push(`b:${bk}`); } else ends.push(r.node);
  }
  return [...new Set(ends)];
}
// notas de um ponto do mapa: as do livro, ou as que citam a ideia / usam a tag
export const notesForNode = (id) => state.notes.filter((n) => (id.startsWith('b:') && n.bookId === id.slice(2)) || noteEnds(n).includes(id))
  .sort((a, b) => b.createdAt - a.createdAt);

export function graphData(scope = {}) {
  const nodes = new Map();
  const links = new Map();
  const groups = new Map();
  // tag e ideia com o mesmo nome ("umbanda" e [[Umbanda]]) viram um ponto só, que fica como ideia
  // (senão a ideia virava tag e sumia ao esconder as tags)
  const node = (id, label, type, extra = {}) => {
    const cur = nodes.get(id);
    if (!cur) nodes.set(id, { id, label, type, ...extra });
    else if (cur.type === 'tag' && type === 'concept') nodes.set(id, { ...cur, label, type, ...extra });
    return id;
  };
  const link = (a, b) => { if (a && b && a !== b) links.set(a < b ? `${a}|${b}` : `${b}|${a}`, { source: a, target: b }); };
  const weight = new Map();
  const bump = (id) => weight.set(id, (weight.get(id) || 0) + 1);
  const books = sources().filter((b) => bookInScope(b, scope));
  const ids = new Set(books.map((b) => b.id));

  for (const b of books) {
    const group = b.genre ? norm(b.genre) : '';
    if (group && !groups.has(group)) groups.set(group, { key: group, label: b.genre, href: conceptHref(b.genre), color: themeIndex(group) });
    const art = b.kind === 'article';
    const bid = node(`b:${b.id}`, b.title, 'book', { purpose: b.purpose || 'hobby', href: srcHref(b), group, article: art || b.kind === 'pdf' });
    if (b.subtheme && norm(b.subtheme) !== group) link(bid, node(`c:${norm(b.subtheme)}`, b.subtheme, 'subtheme', { href: conceptHref(b.subtheme), group }));
  }
  // as notas ficam no painel (não viram pontos); cada uma liga o livro dela ao que ela cita.
  // Nota solta (sem livro, ex.: criada no "Ligar com…") liga entre si as ideias que cita.
  const loose = !scopeActive(scope);
  for (const n of state.notes) {
    const bid = ids.has(n.bookId) ? `b:${n.bookId}` : null;
    if (!bid && (bookById(n.bookId) || !loose)) continue; // livro fora do filtro
    const ends = [];
    for (const t of n.tags || []) ends.push(node(`c:${norm(t)}`, `#${t}`, 'tag', { href: conceptHref(t) }));
    for (const l of linksOf(n.text)) {
      const r = resolveLink(l);
      if (r.type === 'book') { if (nodes.has(r.node)) ends.push(r.node); continue; } // livro filtrado fica de fora
      if (r.type === 'note') { const o = `b:${noteById(r.node.slice(2))?.bookId}`; if (nodes.has(o)) ends.push(o); continue; }
      if (groups.has(norm(l))) continue; // [[Tema]]: o livro já está na ilha do tema
      ends.push(node(r.node, l, 'concept', { href: r.href }));
    }
    const uniq = [...new Set(ends)].filter((e) => e !== bid);
    if (bid) bump(bid);
    uniq.forEach(bump);
    if (bid) for (const e of uniq) link(bid, e);
    else for (let i = 0; i < Math.min(6, uniq.length); i++) for (let j = i + 1; j < Math.min(6, uniq.length); j++) link(uniq[i], uniq[j]);
  }
  for (const [id, w] of weight) if (nodes.has(id)) nodes.get(id).weight = w;
  return { nodes: [...nodes.values()], groups: [...groups.values()], links: [...links.values()].filter((l) => nodes.has(l.source) && nodes.has(l.target)) };
}

// O que aparece no mapa (escolha de cada pessoa, guardada no aparelho)
export const MAP_SHOW = [['books', 'Livros'], ['areas', 'Áreas'], ['subthemes', 'Subtemas'], ['ideas', 'Ideias'], ['tags', 'Tags']];
export function mapShow() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('grifo.mapShow')) || {}; } catch { /* sem armazenamento */ }
  return Object.fromEntries(MAP_SHOW.map(([k]) => [k, saved[k] !== false]));
}
export const TYPE_LABEL = { book: 'Livro', theme: 'Tema', subtheme: 'Subtema', tag: 'Tag', note: 'Nota', concept: 'Ideia' };

// notas que ainda não ligam nada: sem [[ ]] e sem tags
export const looseNotes = () => state.notes.filter((n) => !linksOf(n.text).length && !(n.tags || []).length).sort((a, b) => b.createdAt - a.createdAt);
// sugestões ignoradas ("✕"), guardadas no aparelho
export const MAP_IGNORE = 'grifo.mapIgnore';
export const ignoredPairs = () => { try { return new Set(JSON.parse(localStorage.getItem(MAP_IGNORE)) || []); } catch { return new Set(); } };
export const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
export function ignorePair(a, b) {
  const s = ignoredPairs();
  s.add(pairKey(a, b));
  try { localStorage.setItem(MAP_IGNORE, JSON.stringify([...s].slice(-500))); } catch { /* sem armazenamento */ }
}

// Sugestões grátis: pontos cujas notas usam as mesmas palavras (e ainda não estão ligados)
export const MAP_STOP = new Set('para pela pelo pelos pelas como mais quando sobre entre porque também ainda muito muita sendo essa esse isso esta este isto cada pode podem seus suas dele dela deles delas eles elas tudo todo toda todos todas fazer estar estão temos depois antes sempre nunca outra outro outras outros mesmo mesma qual quais onde assim apenas coisa coisas grande forma parte vida tempo'.split(' '));
export const fold = (t) => norm(t).normalize('NFD').replace(/\p{M}/gu, '');
export function wordBag(id, label) {
  const text = `${label} ${notesForNode(id).slice(0, 40).map((n) => `${n.title || ''} ${plainText(n.text)}`).join(' ')}`;
  return new Set((fold(text).match(/\p{L}{5,}/gu) || []).filter((w) => !MAP_STOP.has(w)));
}
export function freeSuggestions(center, nodes, linked) {
  const bags = new Map();
  const bag = (n) => { if (!bags.has(n.id)) bags.set(n.id, wordBag(n.id, n.label.replace(/^#/, ''))); return bags.get(n.id); };
  const a = bag(center);
  if (a.size < 3) return [];
  const ignored = ignoredPairs();
  return nodes.filter((n) => n.id !== center.id && !linked.has(n.id) && !ignored.has(pairKey(center.id, n.id)))
    .map((n) => {
      const b = bag(n);
      let common = 0;
      for (const w of b) if (a.has(w)) common++;
      return { n, common, score: common / Math.sqrt(a.size * b.size || 1) };
    })
    .filter((x) => x.common >= 3)
    .sort((x, y) => y.score - x.score)
    .slice(0, 3)
    .map((x) => ({ id: x.n.id, label: x.n.label, type: x.n.type, reason: `${x.common} palavras em comum nas notas` }));
}

export let mapCtx = null; // dados do mapa na tela: pontos, ponto em foco, sugestões

export function mapView() {
  const scope = getScope('mapScope');
  const show = mapShow();
  const d = graphData(scope); // só para saber se há algo a mostrar; o que fica escondido é decidido ao desenhar
  const orphans = looseNotes();
  return `${seg(IDEAS_SEG, 'map')}
  <input type="search" class="search" id="graph-search" placeholder="Encontrar no mapa…" style="margin-bottom:8px">
  ${scopeFilters('mapScope')}
  <div class="map-show"><span class="small muted">Mostrar:</span>${MAP_SHOW.map(([k, label]) => `<label class="chip-toggle"><input type="checkbox" data-map-show="${k}" ${show[k] ? 'checked' : ''}> ${label}</label>`).join('')}</div>
  ${d.nodes.length ? `<div class="map-trail" id="map-trail" hidden></div>
  <section class="card graph-wrap">
    <canvas id="graph" aria-label="Mapa de ideias: cada tema é uma ilha com seus livros"></canvas>
    <div class="graph-tools">
      <button type="button" data-graph="in" aria-label="Aproximar">＋</button>
      <button type="button" data-graph="out" aria-label="Afastar">－</button>
      <button type="button" data-graph="fit" aria-label="Enquadrar tudo">⤢</button>
      <button type="button" data-graph="photo" aria-label="Compartilhar mapa como imagem" title="Compartilhar como imagem">📸</button>
    </div>
    <div class="legend-row" id="graph-legend"></div>
    <div class="legend-row legend-shapes">
      <span><i class="dot"></i>Livro</span>
      <span><i class="dot ring"></i>Subtema</span>
      <span><i class="dot diamond"></i>Ideia ou tag</span>
      <span>Tamanho = nº de notas</span>
    </div>
  </section>
  <section class="card" id="graph-panel"><p class="small muted" style="margin:0">Toque num ponto para focar nele: ficam só ele e as ligações. No computador, arraste um ponto até outro para ligar os dois.</p></section>`
    : scopeActive(scope) ? empty('Nenhum livro com esses filtros.') : empty('O mapa aparece quando você cadastrar livros com tema e criar notas com [[ligações]].', '<button class="btn primary" data-action="newBook">Adicionar livro</button>')}
  ${orphans.length ? `<details class="card orphans"${d.nodes.length ? '' : ' open'}><summary><b>🧩 Notas sem ligação (${orphans.length})</b> <span class="small muted">ligue cada uma a uma ideia ou livro</span></summary>
    ${orphans.slice(0, 8).map((n) => `<div class="row between gap-s li orphan-row"><a class="grow small" href="#/nota/${n.id}">${esc(noteLabel(n))}<br><span class="muted">${esc(bookById(n.bookId)?.title || 'Nota solta')}</span></a>
      <button class="btn small" data-orphan="${n.id}">🔗 Ligar</button></div>`).join('')}
    ${orphans.length > 8 ? `<p class="small muted" style="margin:6px 0 0">+ ${orphans.length - 8} outras em <a href="#/notas">Notas</a></p>` : ''}</details>` : ''}`;
}

export function mapPanelHtml(n, near) {
  if (n.type === 'theme') {
    return `<div class="row between gap"><div><span class="chip">Tema</span><h3 style="margin:4px 0 0">${esc(n.label)}</h3></div><a class="btn small" href="${n.href}">Abrir</a></div>
      <div class="small muted" style="margin:10px 0 4px">${near.length} na ilha · toque para focar</div>
      <div class="chips">${near.map((x) => `<button class="chip chip-btn" data-focus="${esc(x.id)}">${esc(trunc(x.label, 40))}</button>`).join('')}</div>`;
  }
  const notes = notesForNode(n.id);
  const order = ['book', 'subtheme', 'concept', 'tag'];
  const others = [...near].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.label.localeCompare(b.label));
  const kind = n.article ? 'Artigo' : TYPE_LABEL[n.type];
  return `<div class="row between gap"><div class="grow"><span class="chip">${kind}</span><h3 style="margin:4px 0 0">${esc(n.label)}</h3>
      <div class="small muted">${notes.length} ${notes.length === 1 ? 'nota' : 'notas'} · ${others.length} ${others.length === 1 ? 'ligação' : 'ligações'}</div></div>
    <a class="btn small" href="${n.href}">Abrir</a></div>
  <div class="row gap-s wrap" style="margin-top:10px"><button class="btn small primary" data-map="connect">🔗 Ligar com…</button><button class="btn small" data-map="ai">✨ Sugerir com IA</button></div>
  <div id="map-sugg"></div>
  ${others.length ? `<div class="small muted" style="margin:12px 0 4px">Ligado a</div><div class="chips">${others.map((x) => `<button class="chip chip-btn" data-focus="${esc(x.id)}">${esc(x.article ? 'Artigo' : TYPE_LABEL[x.type])}: ${esc(trunc(x.label, 36))}</button>`).join('')}</div>` : ''}
  ${notes.length ? `<div class="small muted" style="margin:12px 0 4px">Notas</div>
    <div class="map-notes">${notes.slice(0, 6).map((x) => `<a class="map-note" href="#/nota/${x.id}"><span>${renderText(trunc(plainText(x.text), 180))}</span><small class="muted">${esc(bookById(x.bookId)?.title || 'Nota solta')}${x.page ? ` · p. ${x.page}` : ''}</small></a>`).join('')}</div>
    ${notes.length > 6 ? `<a class="small" href="${n.href}">Ver todas as ${notes.length} notas</a>` : ''}` : ''}`;
}
export const trunc = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function mapSuggHtml(list, ai = false) {
  if (!list.length) return '';
  return `<div class="map-sugg"><div class="small muted" style="margin:12px 0 4px">${ai ? '✨ Sugestões da IA' : 'Talvez se ligue a'} <span class="muted">(tracejado no mapa)</span></div>
    ${list.map((s, i) => `<div class="row between gap-s li"><span class="grow small"><b>${esc(s.label)}</b>${s.isNew ? ' <span class="chip">ideia nova</span>' : ''}<br><span class="muted">${esc(s.reason || '')}</span></span>
      <span class="row gap-s"><button class="btn small" data-sugg-link="${i}">Ligar</button><button class="icon-btn" data-sugg-ignore="${i}" aria-label="Ignorar ${esc(s.label)}">✕</button></span></div>`).join('')}</div>`;
}

export function renderTrail(st) {
  const bar = $('#map-trail');
  if (!bar) return;
  bar.hidden = !st;
  if (!st) return;
  bar.innerHTML = `<nav class="trail" aria-label="Caminho no mapa"><button class="link-btn" data-trail="home">← Mapa geral</button>${st.trail.map((t, i) => ` <span class="muted">›</span> ${i === st.trail.length - 1 ? `<b>${esc(trunc(t.label, 28))}</b>` : `<button class="link-btn" data-trail="${esc(t.id)}">${esc(trunc(t.label, 22))}</button>`}`).join('')}</nav>
    <div class="seg-mini" role="group" aria-label="Quantos passos mostrar">${[1, 2].map((dp) => `<button class="${st.depth === dp ? 'active' : ''}" data-depth="${dp}">${dp} ${dp === 1 ? 'passo' : 'passos'}</button>`).join('')}</div>`;
}

// Liga dois pontos (ou uma nota a um ponto), com o "por quê" escrito pela pessoa
export function connectModal(from, preset = '') {
  const own = from.note ? '' : from.label;
  const cands = new Map();
  for (const c of linkCandidates()) cands.set(norm(c.label), c.label);
  for (const n of mapCtx?.nodes || []) if (n.type !== 'theme') cands.set(norm(n.label), n.label);
  for (const a of state.articles) cands.set(norm(a.title), a.title);
  cands.delete(norm(own));
  const title = from.note ? noteLabel(from.note) : from.label;
  openModal(`<form class="form" id="connect-form">
    <h3>🔗 Ligar “${esc(trunc(title, 60))}”</h3>
    <label>Com <input name="to" list="connect-list" required autocomplete="off" value="${esc(preset)}" placeholder="Livro, ideia, #tag ou um conceito novo"></label>
    <datalist id="connect-list">${[...cands.values()].sort((a, b) => a.localeCompare(b, LOCALE)).map((l) => `<option value="${esc(l)}">`).join('')}</datalist>
    <label>Por que se ligam? <textarea name="why" rows="3" placeholder="ex: os dois falam de decisões rápidas que parecem certas"></textarea>
      <span class="hint">Escrever o porquê é o que fixa a ligação na memória. Vira uma nota com as duas ideias.</span></label>
    <div class="actions"><button type="button" class="btn ghost" data-action="close">Cancelar</button><button class="btn primary">Ligar</button></div>
  </form>`, (root) => {
    const form = $('#connect-form', root);
    (preset ? form.why : form.to).focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const to = form.to.value.trim();
      if (!to || norm(to) === norm(own)) return;
      closeModal();
      await connectItems(from, to, form.why.value.trim());
    };
  });
}

export async function connectItems(from, toRaw, why) {
  const isTag = (l) => l.startsWith('#');
  const ref = (l) => (isTag(l) ? '' : `[[${l}]]`);
  const tagsOf = (...ls) => ls.filter(isTag).map((l) => l.slice(1));
  const srcOf = (l) => sources().find((b) => norm(b.title) === norm(l));
  const to = toRaw.trim();
  if (from.note) {
    const n = from.note;
    const text = isTag(to) ? n.text : `${n.text.trim()}\n\n→ ${ref(to)}${why ? ` — ${why}` : ''}`;
    await commit(() => persist('notes', { ...n, text, tags: splitTags([...(n.tags || []), ...tagsOf(to)]) }));
    toast(`🔗 Nota ligada a ${esc(to)}`);
    return;
  }
  const a = from.label;
  // um dos lados é livro ou artigo: a nota fica nele e cita o outro; senão, nota solta citando os dois
  const bookA = from.id?.startsWith('b:') ? bookById(from.id.slice(2)) : null;
  const bookB = srcOf(to);
  const book = bookA || bookB;
  // quem é o livro da nota não precisa ser citado nela
  const refs = [bookA ? '' : ref(a), bookB && !bookA ? '' : ref(to)].filter(Boolean);
  const text = `${refs.join(' ↔ ') || `[[${to}]]`}${why ? ` — ${why}` : ''}`;
  const note = { id: uid(), createdAt: Date.now(), bookId: book?.id || null, title: '', text, kind: 'thought', source: 'map', tags: tagsOf(a, to), page: null };
  await commit(() => persist('notes', note));
  toast(`🔗 ${esc(a)} ↔ ${esc(to)} · <u>ver nota</u>`, '', () => { location.hash = `#/nota/${note.id}`; });
}

mapView.mount = async (arg) => {
  const canvas = $('#graph');
  const orphansBox = view.querySelector('.orphans');
  if (orphansBox) orphansBox.onclick = (e) => { const b = e.target.closest('[data-orphan]'); if (b) connectModal({ note: noteById(b.dataset.orphan) }); };
  if (!canvas) return;
  const panel = $('#graph-panel');
  const { createGraph, applyShow } = await import('../graph.js');
  if (!canvas.isConnected) return; // saiu do mapa enquanto carregava
  const data = applyShow(graphData(getScope('mapScope')), mapShow());
  mapCtx = { nodes: data.nodes, focus: null, sugg: [] };
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const linkedTo = (id) => new Set(data.links.flatMap((l) => (l.source === id ? [l.target] : l.target === id ? [l.source] : [])));
  const showSugg = (list, ai) => {
    mapCtx.sugg = list;
    const box = $('#map-sugg');
    if (box) box.innerHTML = mapSuggHtml(list, ai);
    graphApi.setSuggestions(list.filter((s) => !s.isNew).map((s) => s.id));
  };
  graphApi = createGraph(canvas, data, {
    onSelect(n, near) {
      mapCtx.focus = n;
      if (!n) { panel.innerHTML = '<p class="small muted" style="margin:0">Toque num ponto para focar nele: ficam só ele e as ligações. No computador, arraste um ponto até outro para ligar os dois.</p>'; return; }
      panel.innerHTML = mapPanelHtml(n, near);
    },
    onFocus(st) {
      renderTrail(st);
      try { if (st) sessionStorage.setItem('grifo.mapFocus', JSON.stringify(st)); else sessionStorage.removeItem('grifo.mapFocus'); } catch { /* sem armazenamento */ }
      const n = st && byId.get(st.id);
      if (n) showSugg(freeSuggestions(n, data.nodes, linkedTo(n.id)), false);
    },
    onConnect(a, b) { connectModal({ id: a.id, label: a.label, type: a.type }, b.label); },
  });
  panel.onclick = async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const n = mapCtx.focus;
    if (t.dataset.focus) graphApi.focusOn(t.dataset.focus);
    else if (t.dataset.map === 'connect' && n) connectModal({ id: n.id, label: n.label, type: n.type });
    else if (t.dataset.map === 'ai' && n) {
      t.disabled = true;
      t.textContent = '✨ Pensando…';
      try {
        const candidates = data.nodes.filter((x) => x.id !== n.id).map((x) => x.label.replace(/^#/, ''));
        const context = notesForNode(n.id).slice(0, 20).map((x) => plainText(x.text)).join('\n---\n');
        const res = await aiRun('links', { note: { book: n.label, text: context || n.label }, candidates });
        const byLabel = new Map(data.nodes.map((x) => [norm(x.label.replace(/^#/, '')), x]));
        const linked = linkedTo(n.id);
        const list = [
          ...(res.existing || []).map((x) => ({ node: byLabel.get(norm(x.target)), reason: x.reason })).filter((x) => x.node && x.node.id !== n.id && !linked.has(x.node.id))
            .map((x) => ({ id: x.node.id, label: x.node.label, type: x.node.type, reason: x.reason })),
          ...(res.concepts || []).filter((x) => !byLabel.has(norm(x.name))).map((x) => ({ id: `c:${norm(x.name)}`, label: x.name.trim(), reason: x.reason, isNew: true })),
        ];
        if (!list.length) toast('Nenhuma ligação nova encontrada.');
        showSugg(list, true);
      } catch (err) {
        if (err.message) toast(esc(err.message), 'err');
      }
      t.disabled = false;
      t.textContent = '✨ Sugerir com IA';
    } else if (t.dataset.suggLink && n) {
      const s = mapCtx.sugg[Number(t.dataset.suggLink)];
      if (s) connectModal({ id: n.id, label: n.label, type: n.type }, s.label);
    } else if (t.dataset.suggIgnore && n) {
      const s = mapCtx.sugg[Number(t.dataset.suggIgnore)];
      if (!s) return;
      ignorePair(n.id, s.id);
      showSugg(mapCtx.sugg.filter((x) => x !== s), false);
    }
  };
  $('#map-trail').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.trail === 'home') graphApi.exitFocus();
    else if (b.dataset.trail) graphApi.focusOn(b.dataset.trail);
    else if (b.dataset.depth) graphApi.setDepth(Number(b.dataset.depth));
  };
  $('#graph-legend').innerHTML = graphApi.groups().map((g) => `<a href="#" data-island="${esc(g.key)}"><i class="dot" style="background:${g.color}"></i>${esc(g.label)}</a>`).join('')
    || (mapShow().areas ? '<span class="muted">Dê um tema aos livros para formar as ilhas.</span>' : '<span class="muted">Áreas escondidas: só as ligações entre os pontos.</span>');
  $('#graph-legend').onclick = (e) => {
    const a = e.target.closest('[data-island]');
    if (!a) return;
    e.preventDefault();
    graphApi.exitFocus();
    graphApi.selectById(`g:${a.dataset.island}`);
  };
  view.querySelectorAll('[data-graph]').forEach((b) => {
    b.onclick = () => ({ in: () => graphApi.zoom(1.3), out: () => graphApi.zoom(1 / 1.3), fit: () => { graphApi.exitFocus(); graphApi.fit(); }, photo: () => actions.shareMap() })[b.dataset.graph]();
  });
  const search = $('#graph-search');
  search.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!graphApi.find(search.value)) toast('Nada encontrado no mapa.'); } };
  // volta ao foco de antes (ao voltar para o mapa ou depois de ligar dois pontos)
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem('grifo.mapFocus')); } catch { /* sem armazenamento */ }
  if (arg) setTimeout(() => graphApi.selectById(decodeURIComponent(arg)), 50);
  else if (saved && graphApi.has(saved.id)) {
    setTimeout(() => {
      graphApi.focusOn(saved.id, { trailIds: saved.trail.map((t) => t.id).filter((id) => graphApi.has(id)) });
      if (saved.depth === 2) graphApi.setDepth(2);
    }, 30);
  }
};
