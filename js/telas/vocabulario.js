// Vocabulário (palavras do dicionário) e página de tags.
// Parte do app.js separada por tela: usa o estado e os utilitários do app (importados de ../app.js).
import { esc, norm, splitTags } from '../util.js';
import { uid } from '../db.js';
import { lang } from '../i18n.js';
import * as G from '../game.js';
import * as S from '../srs.js';
import { state, $, modal, srcHref, bookById, empty, conceptHref, seg, persist, remove, commit, toast, openModal, closeModal, IDEAS_SEG, words, datalist, render } from '../app.js';

// ---------- vocabulário ----------
// Palavras procuradas no dicionário (ao selecionar num artigo ou PDF, ou digitando), com a frase onde apareceram
export const wordByText = (w) => state.words.find((x) => norm(x.word) === norm(w));
// sentidos agrupados pela classe da palavra (substantivo, verbo…), na ordem do dicionário
export function wordGroups(r) {
  const groups = [];
  for (const d of r.defs || []) {
    const g = groups.find((x) => x.pos === d.pos);
    if (g) g.items.push(d.text); else groups.push({ pos: d.pos, items: [d.text] });
  }
  return groups;
}
export const WORD_LISTS = [['synonyms', 'Sinônimos'], ['antonyms', 'Antônimos'], ['anagrams', 'Anagramas']];
export function wordDefsHtml(r) {
  return wordGroups(r).map((g) => `${g.pos ? `<div class="word-pos">${esc(g.pos)}</div>` : ''}<ol class="word-defs">${g.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>`).join('')
    + WORD_LISTS.filter(([k]) => r[k]?.length).map(([k, label]) => `<div class="word-pos">${label}</div><div class="chips">${r[k].map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>`).join('');
}
// verso do card: todos os sentidos por classe, depois sinônimos, antônimos e anagramas
export function wordBackText(w) {
  const defs = wordGroups(w).map((g) => `${g.pos ? `**${g.pos}**\n` : ''}${g.items.map((t, i) => `${i + 1}. ${t}`).join('\n')}`).join('\n\n');
  const lists = WORD_LISTS.filter(([k]) => w[k]?.length).map(([k, label]) => `**${label}:** ${w[k].join(', ')}`).join('\n');
  return [defs, lists].filter(Boolean).join('\n\n');
}
export const wordRecord = (r) => ({ word: r.word, lang: r.lang, base: r.base || '', defs: r.defs.slice(0, 30), synonyms: r.synonyms || [], antonyms: r.antonyms || [], anagrams: r.anagrams || [], source: r.source || null, v: 2 });
export function wordModal(r, { context = '', sourceId = null } = {}) {
  const saved = wordByText(r.word);
  const hasCard = saved && state.cards.some((c) => c.wordId === saved.id);
  openModal(`<div class="form word-modal">
    <h3 class="word-title">${esc(r.word)}${r.phonetic ? ` <small class="muted">${esc(r.phonetic)}</small>` : ''}</h3>
    ${r.base ? `<p class="small muted" style="margin:0">Forma de <b>${esc(r.base)}</b></p>` : ''}
    ${wordDefsHtml(r)}
    ${context ? `<blockquote class="word-ctx">${esc(context)}</blockquote>` : ''}
    <p class="small muted" style="margin:0">Fonte: <a href="${esc(r.source?.url || '#')}" target="_blank" rel="noopener">${esc(r.source?.name || '')}</a></p>
    <div class="actions">
      <button type="button" class="btn ghost" data-action="close">Fechar</button>
      ${saved ? '<span class="chip">✓ No seu vocabulário</span>' : '<button type="button" class="btn" id="word-save">➕ Salvar</button>'}
      ${hasCard ? '' : '<button type="button" class="btn primary" id="word-card">🧠 Salvar e criar card</button>'}
    </div>
  </div>`, (root) => {
    const save = async () => {
      const cur = wordByText(r.word);
      if (cur) return cur;
      const rec = { id: uid(), createdAt: Date.now(), ...wordRecord(r), context, sourceId };
      await commit(() => persist('words', rec), { rerender: false });
      return rec;
    };
    const s = $('#word-save', root);
    if (s) s.onclick = async () => { await save(); closeModal(); toast(`🔤 “${esc(r.word)}” no seu vocabulário · <u>ver</u>`, '', () => { location.hash = '#/vocabulario'; }); if (location.hash.startsWith('#/vocabulario')) render(); };
    const c = $('#word-card', root);
    if (c) c.onclick = async () => { const w = await save(); await makeWordCard(w); closeModal(); if (location.hash.startsWith('#/vocabulario')) render(); };
  });
}
export async function makeWordCard(w) {
  if (state.cards.some((c) => c.wordId === w.id)) return;
  const front = `O que significa “${w.word}”?${w.context ? `\n\n“${w.context}”` : ''}`;
  await commit(() => persist('cards', S.newCard({ id: uid(), noteId: null, wordId: w.id, bookId: w.sourceId || null, createdAt: Date.now(), type: 'qa', front, back: wordBackText(w), source: 'vocab' }, G.ymd())));
  toast('🧠 Card criado: a palavra entra na sua revisão');
}
// palavras salvas antes de guardar o verbete completo: busca de novo e completa a palavra e o card
export let refreshingWords = false;
export async function refreshOldWords() {
  const old = state.words.filter((w) => !w.v).slice(0, 10);
  if (!old.length || refreshingWords) return;
  refreshingWords = true;
  try {
    const D = await import('../dict.js');
    for (const w of old) {
      const r = await D.lookup(w.base && !w.defs.length ? w.base : w.word);
      const upd = r ? { ...w, ...wordRecord(r), word: w.word } : { ...w, v: 2 };
      await persist('words', upd);
      for (const c of state.cards.filter((x) => x.wordId === w.id)) await persist('cards', { ...c, back: wordBackText(upd) });
    }
  } finally { refreshingWords = false; }
  if (location.hash.startsWith('#/vocabulario')) render();
}
// procura e mostra o resultado (com aviso enquanto busca)
export async function wordLookup(raw, opts = {}) {
  const D = await import('../dict.js');
  const word = D.cleanWord(raw);
  if (!word) return;
  const saved = wordByText(word);
  if (saved) { wordModal(saved, { context: opts.context || saved.context, sourceId: saved.sourceId }); return; }
  openModal(`<div class="form"><h3 class="word-title">${esc(word)}</h3><p class="muted">📖 Procurando no dicionário…</p></div>`);
  const r = await D.lookup(word);
  if (!modal.open) return;
  if (!r) {
    openModal(`<div class="form"><h3 class="word-title">${esc(word)}</h3>
      <p>Não encontrei “${esc(word)}” nos dicionários gratuitos. Confira a grafia ou tente a forma básica (ex.: “correr” em vez de “correram”).</p>
      <p class="small"><a href="https://www.dicio.com.br/pesquisa.php?q=${encodeURIComponent(word)}" target="_blank" rel="noopener">Procurar no Dicio ↗</a></p>
      <div class="actions"><button type="button" class="btn" data-action="close">Fechar</button></div></div>`);
    return;
  }
  wordModal(r, opts);
}
export function wordItem(w) {
  const src = bookById(w.sourceId);
  const hasCard = state.cards.some((c) => c.wordId === w.id);
  return `<article class="card word-item" data-search="${esc(`${norm(w.word)} ${norm(w.defs[0]?.text || '')} ${norm(src?.title || '')}`)}">
    <div class="row between gap-s">
      <button class="word-open" data-action="showWord" data-id="${w.id}"><b class="word-title">${esc(w.word)}</b></button>
      <span class="row gap-s">${hasCard ? '<span class="chip">🧠 card</span>' : `<button class="icon-btn" data-action="wordCard" data-id="${w.id}" title="Criar card de revisão" aria-label="Criar card de ${esc(w.word)}">🧠</button>`}
        <button class="icon-btn" data-action="delWord" data-id="${w.id}" title="Tirar do vocabulário" aria-label="Tirar ${esc(w.word)} do vocabulário">🗑️</button></span>
    </div>
    <div class="small">${w.defs[0]?.pos ? `<i class="muted">${esc(w.defs[0].pos)}</i> · ` : ''}${esc(w.defs[0]?.text || '')}</div>
    ${w.context ? `<div class="word-ctx small">“${esc(w.context)}”</div>` : ''}
    ${src ? `<a class="small muted" href="${srcHref(src)}">${esc(src.title)}</a>` : ''}
  </article>`;
}
export function vocabView() {
  const words = [...state.words].sort((a, b) => b.createdAt - a.createdAt);
  return `${seg(IDEAS_SEG, 'words')}
  <h2 style="margin-top:0">Vocabulário</h2>
  <p class="small muted">Num artigo ou PDF, selecione uma palavra e toque em <b>📖 Significado</b>. Lendo no papel? Procure aqui.</p>
  <form class="row gap-s" id="word-form"><input name="q" class="search grow" required placeholder="Procurar uma palavra…" autocomplete="off" autocapitalize="off" style="margin:0"><button class="btn primary">Buscar</button></form>
  ${words.length ? `<h3>Suas palavras (${words.length})</h3><input class="search" type="search" placeholder="Filtrar suas palavras…" data-filter-list="#word-list"><div id="word-list">${words.map(wordItem).join('')}</div>`
    : empty('As palavras que você procurar e salvar aparecem aqui, com a frase onde estavam. Vire card e elas entram na revisão.')}`;
}
vocabView.mount = () => {
  const form = $('#word-form');
  form.onsubmit = (e) => { e.preventDefault(); wordLookup(form.q.value); form.q.value = ''; };
  refreshOldWords();
};
export const wordActions = {
  showWord: ({ id }) => { const w = state.words.find((x) => x.id === id); if (w) wordModal(w, { context: w.context, sourceId: w.sourceId }); },
  wordCard: async ({ id }) => { const w = state.words.find((x) => x.id === id); if (w) await makeWordCard(w); },
  delWord: async ({ id }) => {
    const w = state.words.find((x) => x.id === id);
    if (!w || !confirm(`Tirar “${w.word}” do vocabulário? O card de revisão dela também sai.`)) return;
    await commit(async () => {
      for (const c of state.cards.filter((x) => x.wordId === id)) await remove('cards', c.id);
      await remove('words', id);
    });
    toast(`🗑️ “${esc(w.word)}” saiu do vocabulário`);
  },
};

// Tags de todas as notas, sem diferenciar maiúsculas: a grafia mais usada dá o nome
export function tagIndex() {
  const groups = new Map();
  for (const n of state.notes) {
    for (const t of n.tags || []) {
      const g = groups.get(norm(t)) || { spell: new Map(), notes: new Set() };
      g.spell.set(t, (g.spell.get(t) || 0) + 1);
      g.notes.add(n.id);
      groups.set(norm(t), g);
    }
  }
  return [...groups].map(([key, g]) => ({ key, name: [...g.spell].sort((a, b) => b[1] - a[1])[0][0], count: g.notes.size }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function tagsView() {
  const tags = tagIndex();
  return `<a href="#/notas" class="back">← Notas</a>
  <h2 style="margin-top:0">Tags</h2>
  <p class="small muted">Renomeie para corrigir a grafia, use o nome de outra tag para juntar as duas, ou remova uma tag das notas (as notas continuam).</p>
  ${tags.length ? `<input class="search" type="search" placeholder="Buscar tag…" data-filter-list="#tag-list">
  <div id="tag-list" class="card list">${tags.map((t) => `<div class="row between li tag-row" data-search="${esc(t.key)}">
    <a class="chip tag" href="${conceptHref(t.name)}">#${esc(t.name)}</a>
    <span class="row gap-s"><span class="small muted">${t.count} ${t.count === 1 ? 'nota' : 'notas'}</span>
      <button class="icon-btn" data-action="renameTag" data-tag="${esc(t.name)}" title="Renomear ou juntar" aria-label="Renomear ou juntar #${esc(t.name)}">✏️</button>
      <button class="icon-btn" data-action="deleteTag" data-tag="${esc(t.name)}" title="Remover das notas" aria-label="Remover #${esc(t.name)}">🗑️</button></span>
  </div>`).join('')}</div>` : empty('Você ainda não usou tags. Ao editar uma nota, escreva as tags separadas por ponto e vírgula.', '<a class="btn" href="#/notas">Ver notas</a>')}`;
}

// troca a tag em todas as notas; com nome de outra tag, as duas viram uma só
export async function retag(from, to) {
  const key = norm(from);
  await commit(async () => {
    for (const n of state.notes.filter((x) => (x.tags || []).some((t) => norm(t) === key))) {
      await persist('notes', { ...n, tags: splitTags(n.tags.flatMap((t) => (norm(t) === key ? to : [t]))), updatedAt: Date.now() });
    }
  }, { quiet: true });
}

export const tagActions = {
  renameTag: ({ tag }) => {
    const others = tagIndex().filter((t) => t.key !== norm(tag));
    openModal(`<form class="form" id="tag-form">
      <h3>Renomear #${esc(tag)}</h3>
      <label>Novo nome <input name="to" value="${esc(tag)}" list="tag-names" required autocomplete="off">
        <span class="hint">Para juntar com outra tag, escolha o nome dela. Com ponto e vírgula, vira mais de uma tag.</span></label>
      <datalist id="tag-names">${others.map((t) => `<option value="${esc(t.name)}">`).join('')}</datalist>
      <div class="actions"><button type="button" class="btn ghost" data-action="close">Cancelar</button><button class="btn primary">Salvar</button></div>
    </form>`, (root) => {
      const form = $('#tag-form', root);
      form.to.select();
      form.onsubmit = async (e) => {
        e.preventDefault();
        const to = splitTags([form.to.value]);
        if (!to.length) return;
        const merged = to.length === 1 && others.find((t) => t.key === norm(to[0]));
        closeModal();
        await retag(tag, to);
        toast(merged ? `🏷️ #${esc(tag)} juntada com #${esc(merged.name)}` : `🏷️ Tag renomeada para ${to.map((t) => `#${esc(t)}`).join(' ')}`);
      };
    });
  },
  deleteTag: async ({ tag }) => {
    const count = tagIndex().find((t) => t.key === norm(tag))?.count || 0;
    if (!confirm(`Remover #${tag} de ${count} nota(s)? As notas continuam.`)) return;
    await retag(tag, []);
    toast(`🗑️ #${esc(tag)} removida`);
  },
};
