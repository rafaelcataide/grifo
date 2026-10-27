import { LOCALE, tr, lang, setLang, startTranslating } from './i18n.js';
import { db, uid, STORES } from './db.js';
import { LINK_RE, esc, norm, nf, linksOf, plainText, splitTags } from './util.js';
import * as G from './game.js';
import * as C from './charts.js';
import * as S from './srs.js';
import { runOCR } from './ocr.js';
import { createGraph, applyShow } from './graph.js';
import * as Share from './share.js';
import * as Scanner from './scanner.js';
import * as Importers from './importers.js';
import * as Cloud from './cloud.js';
import * as AI from './ai.js';
import { CONFIG } from '../config.js';
import { landingView } from './landing.js';

const APP_VERSION = '2026.10.24';
const DEFAULT_SETTINGS = { name: '', yearGoal: 12, dailyGoal: 20, dailyCards: 20, googleKey: '', handle: '' };
const STATUS = { reading: 'Lendo', want: 'Quero ler', finished: 'Lido', abandoned: 'Abandonado' };
const PURPOSE = {
  hobby: { label: 'Hobby', icon: '🎈' },
  professional: { label: 'Profissional', icon: '💼' },
  academic: { label: 'Acadêmico', icon: '🎓' },
};
// Temas com sugestões de subtema (o usuário pode digitar qualquer outro)
const THEMES = {
  Literatura: ['Romance', 'Fantasia', 'Ficção científica', 'Suspense', 'Terror', 'Poesia', 'Clássico', 'Contos'],
  Informática: ['Banco de dados', 'Programação', 'Arquitetura de software', 'Redes', 'Segurança', 'Inteligência artificial', 'DevOps', 'Engenharia de dados'],
  Negócios: ['Gestão', 'Liderança', 'Marketing', 'Empreendedorismo', 'Estratégia', 'Vendas'],
  Finanças: ['Investimentos', 'Finanças pessoais', 'Economia', 'Trading'],
  Psicologia: ['Comportamento', 'Neurociência', 'Hábitos', 'Inteligência emocional'],
  Filosofia: ['Estoicismo', 'Ética', 'Filosofia política', 'Existencialismo'],
  História: ['Brasil', 'Mundo', 'Guerras', 'Antiguidade'],
  Ciência: ['Física', 'Biologia', 'Matemática', 'Astronomia'],
  Saúde: ['Medicina', 'Nutrição', 'Saúde pública', 'Enfermagem'],
  Direito: ['Constitucional', 'Trabalhista', 'Previdenciário', 'Civil'],
  Educação: ['Didática', 'Aprendizagem'],
  Religião: ['Espiritualidade', 'Teologia'],
  Biografia: ['Negócios', 'Política', 'Arte', 'Esporte'],
  Autoajuda: ['Produtividade', 'Desenvolvimento pessoal'],
};
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const state = {
  books: [], sessions: [], notes: [], cards: [], reviews: [],
  settings: { ...DEFAULT_SETTINGS }, badges: {}, challenges: [], stats: null,
};
let review = null; // sessão de revisão em andamento: { queue: [cardId], revealed, done }

const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const modal = $('#modal');
const modalBody = $('#modal-body');

const fmtDate = (s) => (s ? G.parseYmd(s).toLocaleDateString(LOCALE) : '');
// livros e artigos (o que tem finalidade, tema e notas)
// endereço de um livro, artigo ou PDF
const srcHref = (b) => (b.kind === 'pdf' ? `#/pdf/${b.id}` : b.kind === 'article' ? `#/artigo/${b.id}` : `#/livro/${b.id}`);
const sources = () => [...state.books, ...(state.articles || [])];
const bookById = (id) => state.books.find((b) => b.id === id) || state.articles?.find((b) => b.id === id);
const noteById = (id) => state.notes.find((n) => n.id === id);
const stars = (n) => (n > 0 ? `<span class="stars">${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span></span>` : '');
const pct = (b) => (b.pages ? Math.min(100, Math.round(((b.status === 'finished' ? b.pages : b.currentPage || 0) / b.pages) * 100)) : 0);
const empty = (msg, extra = '') => `<div class="empty"><p>${msg}</p>${extra}</div>`;
const conceptHref = (name) => `#/conceito/${encodeURIComponent(name.trim())}`;
const purposeChip = (b) => { const p = PURPOSE[b.purpose || 'hobby']; return `<span class="chip p-${b.purpose || 'hobby'}">${p.icon} ${p.label}</span>`; };
const seg = (items, active) => `<nav class="seg">${items.map(([href, label, key]) => `<a href="${href}" class="${key === active ? 'active' : ''}">${label}</a>`).join('')}</nav>`;

// ---------------- links [[ ]] ----------------

function resolveLink(name) {
  const k = norm(name);
  const b = state.books.find((x) => norm(x.title) === k);
  if (b) return { type: 'book', href: `#/livro/${b.id}`, node: `b:${b.id}` };
  const n = state.notes.find((x) => x.title && norm(noteTitle(x)) === k);
  if (n) return { type: 'note', href: `#/nota/${n.id}`, node: `n:${n.id}` };
  return { type: 'concept', href: conceptHref(name), node: `c:${k}` };
}

// Texto da nota com [[links]] clicáveis (o resto é escapado)
function renderText(text) {
  let out = '', last = 0;
  for (const m of String(text || '').matchAll(LINK_RE)) {
    out += esc(text.slice(last, m.index));
    const [target, alias] = m[1].split('|');
    const r = resolveLink(target);
    out += `<a class="wl ${r.type}" href="${r.href}">${esc((alias || target).trim())}</a>`;
    last = m.index + m[0].length;
  }
  return (out + esc(String(text || '').slice(last))).replace(/\n/g, '<br>');
}

// título sem [[ ]] (o título nomeia a própria nota; colchetes nele não são ligação)
const noteTitle = (n) => plainText(n.title || '').trim();
const noteLabel = (n) => noteTitle(n) || (n.text || '').replace(LINK_RE, '$1').slice(0, 48) + ((n.text || '').length > 48 ? '…' : '');

// ---------------- persistência ----------------
async function load() {
  const all = await Promise.all(STORES.map((s) => db.all(s)));
  STORES.forEach((s, i) => { state[s] = all[i]; });
  // artigos salvos por link: mesma tabela dos livros, lista separada (não contam em metas nem na estante)
  // tags gravadas juntas antes de aceitar ';' ("religião;umbanda"): separa uma vez; a correção sincroniza
  for (const [i, n] of state.notes.entries()) {
    if (!(n.tags || []).some((t) => /[;,#]/.test(t))) continue;
    const fixed = { ...n, tags: splitTags(n.tags) };
    await db.put('notes', fixed);
    state.notes[i] = fixed;
  }
  state.articles = state.books.filter((b) => b.kind === 'article' || b.kind === 'pdf');
  state.books = state.books.filter((b) => b.kind !== 'article' && b.kind !== 'pdf');
  state.settings = { ...DEFAULT_SETTINGS, ...((await db.getKV('settings')) || {}) };
  state.badges = (await db.getKV('badges')) || {};
  state.challenges = (await db.getKV('challenges')) || [];
  const s = refreshStats();
  // Conquistas já merecidas (ex.: vindas de um backup importado) são registradas sem alarde
  const missing = G.BADGES.filter((b) => !state.badges[b.id] && b.test(s));
  if (missing.length) {
    for (const b of missing) state.badges[b.id] = G.ymd();
    await db.setKV('badges', state.badges);
  }
}

function refreshStats() {
  state.stats = G.computeStats(state);
  return state.stats;
}

async function persist(store, obj) {
  await db.put(store, obj);
  const arr = store === 'books' && (obj.kind === 'article' || obj.kind === 'pdf') ? state.articles : state[store];
  const i = arr.findIndex((x) => x.id === obj.id);
  if (i >= 0) arr[i] = obj; else arr.push(obj);
}

async function remove(store, id) {
  await db.del(store, id);
  state[store] = state[store].filter((x) => x.id !== id);
  if (store === 'books') state.articles = state.articles.filter((x) => x.id !== id);
}

// Outras abas do Grifo no mesmo navegador: avisa quando os dados mudam, para todas mostrarem o mesmo
// (sem isso, um item excluído numa aba continua aparecendo na outra)
const otherTabs = 'BroadcastChannel' in globalThis ? new BroadcastChannel('grifo-dados') : null;
let tabsTimer = 0;
if (otherTabs) {
  otherTabs.onmessage = () => {
    clearTimeout(tabsTimer);
    tabsTimer = setTimeout(async () => { await load(); if (!modal.open) render(); }, 150);
  };
}
const tellOtherTabs = () => otherTabs?.postMessage('mudou');

// Toda alteração passa por aqui: recalcula XP, desafios, conquistas e comemora.
async function commit(fn, { quiet = false, rerender = true } = {}) {
  const before = refreshStats().xp;
  const levelBefore = G.levelInfo(before).level;
  await fn();
  let s = refreshStats();

  const ch = G.weeklyChallenge(s);
  if (ch.done && !state.challenges.includes(ch.key)) {
    state.challenges.push(ch.key);
    await db.setKV('challenges', state.challenges);
    s = refreshStats();
    toast(`🎯 Desafio da semana concluído! <b>+${G.XP.challenge} XP</b>`, 'gold');
    confetti();
  }

  let unlocked = false;
  for (const b of G.BADGES) {
    if (!state.badges[b.id] && b.test(s)) {
      state.badges[b.id] = G.ymd();
      unlocked = true;
      toast(`${b.icon} Conquista desbloqueada: <b>${esc(b.name)}</b> · <u>compartilhar</u>`, 'gold', () => actions.shareBadge({ id: b.id }));
    }
  }
  if (unlocked) { await db.setKV('badges', state.badges); confetti(); }

  const gained = s.xp - before;
  if (gained > 0 && !quiet) toast(`✨ +${gained} XP`);
  const lv = G.levelInfo(s.xp);
  if (lv.level > levelBefore) { toast(`⬆️ Você subiu para o nível ${lv.level}: <b>${lv.title}</b>! · <u>compartilhar</u>`, 'gold', () => actions.shareLevel()); confetti(); }
  if (rerender) render();
  scheduleSync();
  tellOtherTabs();
}

// ---------------- tema ----------------
const THEME_ICON = { auto: '🌓', light: '☀️', dark: '🌙' };
const THEME_LABEL = { auto: 'Automático (segue o sistema)', light: 'Claro', dark: 'Escuro' };
function currentTheme() {
  try { return localStorage.getItem('theme') || 'auto'; } catch { return 'auto'; }
}
function applyTheme(mode) {
  try { localStorage.setItem('theme', mode); } catch { /* sem armazenamento: vale só nesta sessão */ }
  if (mode === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;
  const btn = $('#theme-btn');
  btn.textContent = THEME_ICON[mode];
  btn.title = `Tema: ${THEME_LABEL[mode]}`;
  requestAnimationFrame(() => {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    document.querySelector('meta[name="theme-color"]').content = bg;
    graphApi?.recolor();
    $('#graph-legend')?.querySelectorAll('[data-island] .dot').forEach((d, i) => { d.style.background = graphApi?.groups()[i]?.color; });
  });
}

// ---------------- feedback visual ----------------
function toast(html, kind = '', onClick = null) {
  const el = document.createElement('div');
  el.className = `toast ${kind}${onClick ? ' clickable' : ''}`;
  el.innerHTML = html;
  if (onClick) el.onclick = () => { el.remove(); onClick(); };
  $('#toasts').append(el);
  const life = onClick ? 6000 : 3200;
  setTimeout(() => el.classList.add('out'), life);
  setTimeout(() => el.remove(), life + 500);
}

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#9ea9fb', '#f3b089', '#f2d27a', '#8fd1b5', '#f2a6c4'];
  for (let i = 0; i < 40; i++) {
    const p = document.createElement('i');
    p.className = 'confetti';
    p.style.left = `${Math.random() * 100}vw`;
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = `${Math.random() * 0.4}s`;
    p.style.setProperty('--dx', `${(Math.random() - 0.5) * 200}px`);
    document.body.append(p);
    setTimeout(() => p.remove(), 2400);
  }
}

function openModal(html, mount) {
  modalBody.innerHTML = html;
  if (!modal.open) modal.showModal();
  mount?.(modalBody);
}
const closeModal = () => modal.close();
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

// ---------------- componentes ----------------
const READ_SEG = [['#/livros', '📚 Livros', 'books'], ['#/artigos', '📰 Artigos e PDFs', 'articles']];
const IDEAS_SEG = [['#/notas', '✍️ Notas', 'list'], ['#/mapa', '🕸️ Mapa', 'map'], ['#/vocabulario', '🔤 Palavras', 'words'], ['#/perguntar', '✨ Perguntar', 'ask']];
function cover(b, cls = '') {
  if (b.cover) return `<img class="cover ${cls}" src="${esc(b.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
  const initials = (b.title || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const hueVal = [...(b.title || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return `<div class="cover ph ${cls}" style="--h:${hueVal}">${esc(initials)}</div>`;
}

const themeLine = (b) => [b.genre, b.subtheme].filter(Boolean).map(esc).join(' › ');

function bookCard(b) {
  const p = pct(b);
  return `<article class="book card" data-href="#/livro/${b.id}" data-purpose="${b.purpose || 'hobby'}" data-search="${esc(`${b.title} ${b.author} ${b.genre} ${b.subtheme}`.toLowerCase())}">
    ${cover(b)}
    <div class="grow">
      <div class="book-title">${esc(b.title)}</div>
      <div class="muted small">${esc(b.author || 'Autor desconhecido')}${b.pages ? ` · ${b.pages} pág.` : ''}</div>
      <div class="small">${purposeChip(b)}${themeLine(b) ? `<span class="muted">${themeLine(b)}</span>` : ''}</div>
      ${b.status === 'reading' ? `<div class="bar"><div style="width:${p}%"></div></div>
        <div class="small muted row between"><span>pág. ${b.currentPage || 0} de ${b.pages || '?'}</span><b>${p}%</b></div>` : ''}
      ${b.status === 'finished' ? `<div class="small">${stars(b.rating)} <span class="muted">${b.endDate ? `lido em ${fmtDate(b.endDate)}` : ''}</span></div>` : ''}
      ${b.status !== 'reading' && b.status !== 'finished' ? `<span class="chip">${STATUS[b.status]}</span>` : ''}
    </div>
    ${b.status === 'reading' ? `<span class="book-actions"><button class="btn small" data-action="startTimer" data-id="${b.id}" title="Começar a ler (cronômetro)" aria-label="Começar a ler">⏱️</button><button class="btn small primary" data-action="logReading" data-id="${b.id}">+ Leitura</button></span>` : ''}
  </article>`;
}

function noteCard(n, showBook = true) {
  const b = bookById(n.bookId);
  const cards = state.cards.filter((c) => c.noteId === n.id).length;
  return `<article class="note card ${n.kind === 'quote' ? 'quote' : ''}" data-href="#/nota/${n.id}" data-book="${n.bookId}" data-src="${b?.kind === 'article' ? 'article' : 'book'}" data-search="${esc(`${n.title || ''} ${n.text} ${(n.tags || []).join(' ')} ${b?.title || ''}`.toLowerCase())}">
    ${n.title ? `<div class="note-title">${esc(noteTitle(n))}</div>` : ''}
    <div class="note-text">${renderText(n.text)}</div>
    <div class="row between wrap gap-s">
      <div class="small muted">
        ${showBook && b ? `<a href="#/livro/${b.id}">${esc(b.title)}</a> · ` : ''}${n.page ? `pág. ${n.page} · ` : ''}${new Date(n.createdAt).toLocaleDateString(LOCALE)}
        ${n.source === 'ocr' ? '<span class="chip">📷 OCR</span>' : ''}
        ${cards ? `<span class="chip">🧠 ${cards}</span>` : ''}
        ${(n.tags || []).map((t) => `<a class="chip tag" href="${conceptHref(t)}">#${esc(t)}</a>`).join('')}
      </div>
      <div class="row gap-s">
        <button class="icon-btn" data-action="postNote" data-id="${n.id}" title="Criar post para o Instagram" aria-label="Criar post">📸</button>
        <button class="icon-btn" data-action="newCard" data-id="${n.id}" title="Criar card de memorização" aria-label="Criar card">🧠</button>
        <button class="icon-btn" data-action="editNote" data-id="${n.id}" aria-label="Editar">✏️</button>
      </div>
    </div>
  </article>`;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

function levelCard() {
  const s = state.stats, lv = G.levelInfo(s.xp);
  return `<section class="card hero">
    <div class="row between">
      <div>
        <div class="small muted">${greeting()}${state.settings.name ? `, ${esc(state.settings.name)}` : ''}</div>
        <div class="lv">Nível ${lv.level} · ${lv.title}</div>
      </div>
      <div class="streak ${s.streak ? 'on' : ''}" title="Dias seguidos lendo"><span>🔥</span><b>${s.streak}</b><small>${s.streak === 1 ? 'dia' : 'dias'}</small></div>
    </div>
    <div class="xpbar"><div style="width:${(lv.progress * 100).toFixed(1)}%"></div></div>
    <div class="row between"><span class="small muted">${nf(s.xp)} XP · faltam ${nf(lv.next - s.xp)} para o nível ${lv.level + 1}</span>
      <span class="row gap-s">${s.streak > 1 ? '<button class="icon-btn small" data-action="shareStreak" title="Compartilhar sequência">🔥📸</button>' : ''}
      <button class="icon-btn small" data-action="shareLevel" title="Compartilhar nível">📸</button></span></div>
  </section>`;
}

// ---------------- telas ----------------
// ---------- grifos do dia ----------
// Todo dia, 3 trechos de livros diferentes voltam para você (como o Readwise). A escolha é fixa no dia,
// favoritos aparecem com mais frequência, e "Ver outros" sorteia de novo.
let dailyShift = 0;
const dayHash = (s) => [...s].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) >>> 0, 2166136261);

function dailyHighlights(count = 3) {
  const pool = state.notes.filter((n) => {
    const len = plainText(n.text).length;
    return len >= 20 && len <= 700 && bookById(n.bookId);
  });
  const key = `${G.ymd()}#${dailyShift}`;
  const ranked = pool
    .map((n) => ({ n, r: (dayHash(key + n.id) / 4294967296) / (n.fav ? 2.5 : 1) }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.n);
  const out = [], books = new Set();
  for (const n of ranked) {
    if (books.has(n.bookId) && ranked.length > count) continue;
    out.push(n);
    books.add(n.bookId);
    if (out.length === count) break;
  }
  return out;
}

function dailyCard() {
  const list = dailyHighlights();
  if (!list.length) return '';
  return `<section class="card daily">
    <div class="row between"><h3 style="margin:0">🖍️ Grifos do dia</h3>
      ${state.notes.length > 3 ? '<button class="btn small ghost" data-action="dailyMore">↻ Ver outros</button>' : ''}</div>
    ${list.map((n) => {
      const b = bookById(n.bookId);
      return `<article class="daily-item">
        <a class="daily-text" href="#/nota/${n.id}">“${esc(plainText(n.text))}”</a>
        <div class="row between wrap gap-s">
          <span class="small muted">${esc(b.title)}${b.author ? ` · ${esc(b.author)}` : ''}${n.page ? ` · p. ${n.page}` : ''}</span>
          <span class="row gap-s">
            <button class="icon-btn small" data-action="toggleFav" data-id="${n.id}" title="${n.fav ? 'Tirar dos favoritos' : 'Favoritar: aparece mais nos grifos do dia'}" aria-label="Favoritar">${n.fav ? '💜' : '🤍'}</button>
            <button class="icon-btn small" data-action="postNote" data-id="${n.id}" title="Criar post" aria-label="Criar post">📸</button>
            <button class="icon-btn small" data-action="newCard" data-id="${n.id}" title="Criar card" aria-label="Criar card">🧠</button>
          </span>
        </div>
      </article>`;
    }).join('')}
  </section>`;
}

// ---------- boas-vindas (primeiro uso) ----------
let onbStep = 1;

function onboarding() {
  const set = state.settings;
  if (onbStep === 2 && state.books.length) onbStep = 3;
  if (onbStep === 3 && state.notes.length) setTimeout(() => actions.finishOnboarding(), 0);
  const dots = [1, 2, 3].map((i) => `<i class="${i <= onbStep ? 'on' : ''}"></i>`).join('');
  let body;
  if (onbStep === 1) {
    body = `<span class="onb-emoji">👋</span><h2>Bem-vindo ao Grifo</h2>
      <p class="muted">Organize suas leituras, guarde seus grifos e transforme o hábito de ler num jogo.</p>
      <form class="form onb-form" id="onb-form">
        <label>Como quer ser chamado? <input name="name" value="${esc(set.name)}" placeholder="Seu nome" autocomplete="given-name"></label>
        <div class="grid2">
          <label>Livros por ano <input name="yearGoal" type="number" min="1" value="${set.yearGoal}"></label>
          <label>Páginas por dia <input name="dailyGoal" type="number" min="1" value="${set.dailyGoal}"></label>
        </div>
        <button class="btn primary block" style="margin-top:4px">Continuar</button>
      </form>`;
  } else if (onbStep === 2) {
    body = `<span class="onb-emoji">📚</span><h2>${set.name ? `${esc(set.name)}, qual` : 'Qual'} livro você está lendo?</h2>
      <p class="muted">Aponte a câmera para o código de barras no verso do livro, ou busque pelo título.</p>
      <div class="onb-actions">
        <button class="btn primary block" data-action="scanBook">▥ Escanear código de barras</button>
        <button class="btn block" data-action="newBook">🔎 Buscar ou digitar</button>
        <button class="btn ghost block" data-action="importFile">⬆️ Importar do Kindle, Goodreads ou Skoob</button>
      </div>`;
  } else {
    const b = state.books.find((x) => x.status === 'reading') || state.books[0];
    body = `<span class="onb-emoji">✨</span><h2>Agora o truque</h2>
      <p class="muted">Fotografe uma página com trechos grifados de <b>${esc(b.title)}</b>. O Grifo lê só o que você marcou com marca-texto e vira uma nota.</p>
      <div class="onb-actions">
        <button class="btn primary block" data-action="scan" data-id="${b.id}">📷 Capturar meu primeiro grifo</button>
        <button class="btn ghost block" data-action="finishOnboarding">Fazer isso depois</button>
      </div>`;
  }
  return `<section class="onb"><div class="onb-dots">${dots}</div>${body}</section>`;
}
onboarding.mount = () => {
  const f = $('#onb-form');
  if (!f) return;
  f.onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(f));
    state.settings = { ...state.settings, name: fd.name.trim(), yearGoal: Math.max(1, Number(fd.yearGoal) || 12), dailyGoal: Math.max(1, Number(fd.dailyGoal) || 20) };
    await db.setKV('settings', state.settings);
    onbStep = 2;
    render();
  };
};

const needsOnboarding = () => !state.settings.onboarded && !state.books.length && !state.notes.length;

// ---------- primeiros passos ----------
// Lista que leva a pessoa até sentir o valor do app; cada passo se marca sozinho e a lista some no fim
const FIRST_STEPS = [
  { id: 'book', label: 'Adicione um livro que está lendo', done: () => state.books.length > 0, btn: ['➕ Livro', 'newBook'] },
  { id: 'note', label: 'Guarde um grifo: foto da página ou texto', done: () => state.notes.length > 0, btn: ['📷 Grifo', 'scan'] },
  { id: 'card', label: 'Transforme um grifo em card de revisão', done: () => state.cards.length > 0, href: ['🧠 Ver notas', '#/notas'] },
  { id: 'review', label: 'Faça sua primeira revisão', done: () => (state.reviews || []).length > 0, href: ['🧠 Revisar', '#/revisar'] },
  { id: 'link', label: 'Ligue duas ideias com [[ ]] numa nota', done: () => state.notes.some((n) => linksOf(n.text).length), btn: ['✍️ Nota', 'newNote'] },
  { id: 'article', label: 'Salve um artigo para ler e grifar', done: () => state.articles.length > 0, href: ['📰 Artigos', '#/artigos'] },
];
function firstSteps() {
  if (state.settings.firstStepsHidden) return '';
  const steps = FIRST_STEPS.map((st) => ({ ...st, ok: st.done() }));
  const done = steps.filter((st) => st.ok).length;
  if (done === steps.length) return '';
  const next = steps.find((st) => !st.ok);
  return `<section class="card first-steps">
    <div class="row between"><b>🚀 Primeiros passos</b><span class="small muted">${done} de ${steps.length}</span></div>
    <div class="bar"><div style="width:${(done / steps.length) * 100}%"></div></div>
    <ol>${steps.map((st) => `<li class="${st.ok ? 'ok' : st === next ? 'next' : ''}"><span class="fs-dot">${st.ok ? '✓' : ''}</span><span class="grow">${st.label}</span>${st === next ? (st.btn ? `<button class="btn small primary" data-action="${st.btn[1]}">${st.btn[0]}</button>` : `<a class="btn small primary" href="${st.href[1]}">${st.href[0]}</a>`) : ''}</li>`).join('')}</ol>
    <button class="btn ghost small" data-action="hideFirstSteps">Esconder</button>
  </section>`;
}

function home() {
  const s = state.stats, set = state.settings;
  const ch = G.weeklyChallenge(s);
  const reading = state.books.filter((b) => b.status === 'reading');
  const readingArts = state.articles.filter(articleStarted).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const queued = state.articles.filter((a) => (a.status || 'want') === 'want' && !articleStarted(a)).length;
  const recentBadges = G.BADGES.filter((b) => state.badges[b.id])
    .sort((a, b) => state.badges[b.id].localeCompare(state.badges[a.id])).slice(0, 4);
  const streakMsg = s.pagesToday > 0
    ? (s.pagesToday >= set.dailyGoal ? 'Meta de hoje batida! 🎉' : `Faltam ${set.dailyGoal - s.pagesToday} páginas para a meta de hoje.`)
    : (s.streak > 0 ? `Leia hoje para manter sua sequência de ${s.streak} dias!` : 'Que tal começar uma sequência hoje?');

  return `${firstSteps()}
  ${levelCard()}
  <p class="nudge">${streakMsg}</p>
  <section class="grid2">
    <div class="card center">${C.ring(s.pagesToday / set.dailyGoal)}<div class="small"><b>${s.pagesToday}</b> / ${set.dailyGoal} páginas hoje</div></div>
    <div class="card center">${C.ring(s.finishedThisYear / set.yearGoal)}<div class="small"><b>${s.finishedThisYear}</b> / ${set.yearGoal} livros em ${s.year}</div></div>
  </section>
  ${dailyCard()}
  ${s.dueCards ? `<a class="card due-card" href="#/revisar"><span class="big-emoji">🧠</span>
    <div class="grow"><b>${s.dueCards} ${s.dueCards === 1 ? 'card' : 'cards'} para revisar</b><div class="small muted">Leva poucos minutos e fixa o que você leu.</div></div>
    <span class="btn small primary">Revisar</span></a>` : ''}
  ${state.sessions.length || state.books.some((b) => b.status === 'finished') ? `<button class="card wrapped-cta" data-action="shareWrapped">
    <span class="big-emoji">✨</span><span class="grow"><b>Sua retrospectiva</b><span class="small muted">Do mês ou do ano, pronta para o Stories</span></span><span class="btn small primary">Ver</span></button>` : ''}
  <section class="card challenge ${ch.done ? 'done' : ''}">
    <div class="row gap"><span class="big-emoji">${ch.done ? '✅' : '🎯'}</span>
      <div class="grow"><div class="small muted">Desafio da semana · +${G.XP.challenge} XP</div><b>${ch.text}</b></div>
      <b>${ch.value}/${ch.target}</b></div>
    <div class="bar"><div style="width:${(ch.value / ch.target) * 100}%"></div></div>
  </section>
  <div class="quick">
    <button class="btn" data-action="newBook">➕ Livro</button>
    <button class="btn" data-action="scanBook">▥ Escanear livro</button>
    <button class="btn" data-action="newNote">✍️ Nota</button>
    <button class="btn" data-action="scan">📷 Grifo</button>
    <a class="btn" href="#/artigos">📰 Artigo</a>
  </div>
  <h2>Lendo agora</h2>
  ${reading.length ? reading.map(bookCard).join('') : readingArts.length ? '' : empty('Nenhum livro em andamento.', '<button class="btn primary" data-action="newBook">Adicionar um livro</button>')}
  ${readingArts.length ? `<h3>Artigos</h3>${readingArts.slice(0, 5).map(articleItem).join('')}` : ''}
  ${queued ? `<a class="nudge" href="#/artigos">📰 ${queued} ${queued === 1 ? 'artigo' : 'artigos'} para ler depois →</a>` : ''}
  ${recentBadges.length ? `<h2>Conquistas recentes</h2><div class="badges">${recentBadges.map(badgeTile).join('')}</div>` : ''}`;
}

function booksView() {
  const filter = sessionStorage.getItem('bookFilter') || 'all';
  const purpose = sessionStorage.getItem('bookPurpose') || 'all';
  const list = state.books
    .filter((b) => (filter === 'all' || b.status === filter) && (purpose === 'all' || (b.purpose || 'hobby') === purpose))
    .sort((a, b) => (b.endDate || b.startDate || '').localeCompare(a.endDate || a.startDate || '') || b.createdAt - a.createdAt);
  const count = (st) => state.books.filter((b) => b.status === st).length;
  return `${seg(READ_SEG, 'books')}
  <div class="row between"><h2>Meus livros</h2><button class="btn primary" data-action="newBook">➕ Novo</button></div>
  <div class="row gap-s wrap page-actions"><button class="btn small" data-action="recommend" title="Sugestões de leitura com IA">✨ O que ler</button><button class="btn small" data-action="shareShelf" title="Arte da sua estante para o Instagram">📸 Estante</button><button class="btn small" data-action="importFile" title="Importar do Kindle, Goodreads ou Skoob">⬆️ Importar</button></div>
  <input class="search" type="search" placeholder="Buscar por título, autor, tema ou subtema…" data-filter-list="#book-list">
  <div class="tabs">
    ${[['all', `Todos (${state.books.length})`], ...Object.entries(STATUS).map(([k, v]) => [k, `${v} (${count(k)})`])]
      .map(([k, v]) => `<button class="tab ${filter === k ? 'active' : ''}" data-action="bookFilter" data-v="${k}">${v}</button>`).join('')}
  </div>
  <div class="tabs">
    ${[['all', 'Todas as finalidades'], ...Object.entries(PURPOSE).map(([k, p]) => [k, `${p.icon} ${p.label}`])]
      .map(([k, v]) => `<button class="tab ${purpose === k ? 'active' : ''}" data-action="bookPurpose" data-v="${k}">${v}</button>`).join('')}
  </div>
  <div id="book-list">${list.length ? list.map(bookCard).join('') : empty('Nenhum livro aqui ainda.')}</div>`;
}

function bookDetail(id) {
  const b = bookById(id);
  if (!b) return empty('Livro não encontrado.', '<a class="btn" href="#/livros">Voltar</a>');
  const s = state.stats;
  const sessions = state.sessions.filter((x) => x.bookId === id).sort((a, c) => c.date.localeCompare(a.date) || c.createdAt - a.createdAt);
  const notes = state.notes.filter((n) => n.bookId === id).sort((a, c) => (a.page || 0) - (c.page || 0));
  const mentions = state.notes.filter((n) => n.bookId !== id && linksOf(n.text).some((l) => norm(l) === norm(b.title)));
  const related = state.books.filter((x) => x.id !== id && b.genre && norm(x.genre) === norm(b.genre))
    .sort((x) => (b.subtheme && norm(x.subtheme) === norm(b.subtheme) ? -1 : 1)).slice(0, 6);
  const cards = state.cards.filter((c) => c.bookId === id);
  const read = s.sessByBook.get(id) || 0;
  const minutes = sessions.reduce((a, x) => a + (x.minutes || 0), 0);
  const readDays = new Set(sessions.map((x) => x.date)).size;

  let forecast = '';
  if (b.status === 'reading' && b.pages) {
    const recent = sessions.filter((x) => G.daysBetween(x.date, s.today) < 14).reduce((a, x) => a + x.pages, 0) / 14;
    const pace = recent || s.avg30;
    const left = b.pages - (b.currentPage || 0);
    if (pace > 0 && left > 0) {
      const days = Math.ceil(left / pace);
      forecast = `No seu ritmo (${nf(pace)} pág./dia) você termina em <b>${days} ${days === 1 ? 'dia' : 'dias'}</b>, por volta de ${fmtDate(G.addDays(s.today, days))}.`;
    }
  }

  return `<a href="#/livros" class="back">← Livros</a>
  <section class="detail-head">
    ${cover(b, 'lg')}
    <div class="grow">
      <h2>${esc(b.title)}</h2>
      <div class="muted">${esc(b.author || 'Autor desconhecido')}</div>
      <div class="chips">
        ${purposeChip(b)}
        <span class="chip">${STATUS[b.status]}</span>
        ${b.pages ? `<span class="chip">${b.pages} pág.</span>` : ''}
      </div>
      ${b.genre ? `<div class="small"><a href="${conceptHref(b.genre)}">${esc(b.genre)}</a>${b.subtheme ? ` › <a href="${conceptHref(b.subtheme)}">${esc(b.subtheme)}</a>` : ''}</div>` : ''}
      ${stars(b.rating)}
    </div>
  </section>
  ${b.pages ? `<div class="bar lg"><div style="width:${pct(b)}%"></div></div>
    <div class="small muted row between"><span>pág. ${b.status === 'finished' ? b.pages : b.currentPage || 0} de ${b.pages}</span><b>${pct(b)}%</b></div>` : ''}
  ${forecast ? `<p class="nudge">${forecast}</p>` : ''}
  <div class="quick">
    ${b.status !== 'finished' ? `<button class="btn primary" data-action="startTimer" data-id="${b.id}">⏱️ Começar a ler</button><button class="btn" data-action="logReading" data-id="${b.id}">📖 Registrar leitura</button>` : ''}
    <button class="btn" data-action="newNote" data-id="${b.id}">✍️ Nota</button>
    <button class="btn" data-action="scan" data-id="${b.id}">📷 Grifo</button>
    ${b.status === 'reading' ? `<button class="btn" data-action="finishBook" data-id="${b.id}">🏁 Concluir</button>` : ''}
    <button class="btn" data-action="shareBook" data-id="${b.id}">📸 ${b.status === 'finished' ? 'Terminei!' : 'Lendo agora'}</button>
    <a class="btn" href="#/mapa/${encodeURIComponent(`b:${b.id}`)}">🕸️ No mapa</a>
    ${notes.length ? `<button class="btn" data-action="aiCards" data-book="${b.id}">✨ Cards com IA</button>` : ''}
    ${notes.length >= 3 ? `<button class="btn" data-action="aiSummary" data-book="${b.id}">✨ Fichamento com IA</button>` : ''}
    <button class="btn ghost" data-action="editBook" data-id="${b.id}">✏️ Editar</button>
  </div>
  ${b.review ? `<section class="card"><div class="small muted">Minha opinião</div><p>${esc(b.review).replace(/\n/g, '<br>')}</p></section>` : ''}
  <section class="grid3">
    <div class="card stat"><b>${read}</b><span>páginas registradas</span></div>
    <div class="card stat"><b>${readDays}</b><span>dias de leitura</span></div>
    <div class="card stat"><b>${cards.length}</b><span>cards de memória</span></div>
  </section>
  <h3>Notas (${notes.length})</h3>
  ${notes.length ? notes.map((n) => noteCard(n, false)).join('') : empty('Sem notas ainda. Fotografe um trecho grifado ou escreva uma reflexão.')}
  ${mentions.length ? `<h3>Citado em outras notas</h3><section class="card backlinks">${mentions.map((n) => `<a href="#/nota/${n.id}">${esc(noteLabel(n))}<br><small>${esc(bookById(n.bookId)?.title || '')}</small></a>`).join('')}</section>` : ''}
  ${related.length ? `<h3>Livros relacionados</h3>${related.map(bookCard).join('')}` : ''}
  <h3>Histórico de leitura</h3>
  ${sessions.length ? `<div class="card list">${sessions.map((x) => `<div class="row between li">
      <span>${fmtDate(x.date)} · pág. ${x.fromPage}→${x.toPage}${x.minutes ? ` · ${x.minutes} min` : ''}</span>
      <span class="row gap-s"><b>+${x.pages}</b><button class="icon-btn" data-action="deleteSession" data-id="${x.id}" aria-label="Excluir">🗑️</button></span>
    </div>`).join('')}</div>` : empty('Nenhuma sessão registrada.')}
  <button class="btn danger ghost block" data-action="deleteBook" data-id="${b.id}">Excluir livro</button>`;
}

function notesView() {
  const scope = getScope('notesScope');
  const notes = state.notes.filter((n) => noteInScope(n, scope)).sort((a, b) => b.createdAt - a.createdAt);
  return `${seg(IDEAS_SEG, 'list')}
  <div class="row between"><h2 style="margin-top:0">Notas</h2>
    <div class="row gap-s"><button class="btn" data-action="scan">📷 Grifo</button><button class="btn primary" data-action="newNote">✍️ Nova</button></div></div>
  <p class="small muted">Dica: escreva <b>[[</b> numa nota para ligá-la a um livro, a outra nota ou a um conceito. As ligações formam o mapa mental.</p>
  <div class="row gap-s search-row"><input class="search grow" type="search" placeholder="Buscar em notas e tags…" data-filter-list="#note-list"><a class="btn" href="#/tags">🏷️ Tags</a></div>
  ${state.notes.length > 1 ? scopeFilters('notesScope') : ''}
  <div id="note-list">${notes.length ? notes.map((n) => noteCard(n)).join('')
    : state.notes.length ? empty('Nenhuma nota com esses filtros.', '<button class="btn" data-action="clearScope" data-key="notesScope">✕ Limpar filtros</button>')
    : empty('Suas citações e reflexões aparecem aqui.', '<button class="btn primary" data-action="scan">📷 Capturar um grifo</button>')}</div>`;
}

// ---------- vocabulário ----------
// Palavras procuradas no dicionário (ao selecionar num artigo ou PDF, ou digitando), com a frase onde apareceram
const wordByText = (w) => state.words.find((x) => norm(x.word) === norm(w));
// sentidos agrupados pela classe da palavra (substantivo, verbo…), na ordem do dicionário
function wordGroups(r) {
  const groups = [];
  for (const d of r.defs || []) {
    const g = groups.find((x) => x.pos === d.pos);
    if (g) g.items.push(d.text); else groups.push({ pos: d.pos, items: [d.text] });
  }
  return groups;
}
const WORD_LISTS = [['synonyms', 'Sinônimos'], ['antonyms', 'Antônimos'], ['anagrams', 'Anagramas']];
function wordDefsHtml(r) {
  return wordGroups(r).map((g) => `${g.pos ? `<div class="word-pos">${esc(g.pos)}</div>` : ''}<ol class="word-defs">${g.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>`).join('')
    + WORD_LISTS.filter(([k]) => r[k]?.length).map(([k, label]) => `<div class="word-pos">${label}</div><div class="chips">${r[k].map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>`).join('');
}
// verso do card: todos os sentidos por classe, depois sinônimos, antônimos e anagramas
function wordBackText(w) {
  const defs = wordGroups(w).map((g) => `${g.pos ? `**${g.pos}**\n` : ''}${g.items.map((t, i) => `${i + 1}. ${t}`).join('\n')}`).join('\n\n');
  const lists = WORD_LISTS.filter(([k]) => w[k]?.length).map(([k, label]) => `**${label}:** ${w[k].join(', ')}`).join('\n');
  return [defs, lists].filter(Boolean).join('\n\n');
}
const wordRecord = (r) => ({ word: r.word, lang: r.lang, base: r.base || '', defs: r.defs.slice(0, 30), synonyms: r.synonyms || [], antonyms: r.antonyms || [], anagrams: r.anagrams || [], source: r.source || null, v: 2 });
function wordModal(r, { context = '', sourceId = null } = {}) {
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
async function makeWordCard(w) {
  if (state.cards.some((c) => c.wordId === w.id)) return;
  const front = `O que significa “${w.word}”?${w.context ? `\n\n“${w.context}”` : ''}`;
  await commit(() => persist('cards', S.newCard({ id: uid(), noteId: null, wordId: w.id, bookId: w.sourceId || null, createdAt: Date.now(), type: 'qa', front, back: wordBackText(w), source: 'vocab' }, G.ymd())));
  toast('🧠 Card criado: a palavra entra na sua revisão');
}
// palavras salvas antes de guardar o verbete completo: busca de novo e completa a palavra e o card
let refreshingWords = false;
async function refreshOldWords() {
  const old = state.words.filter((w) => !w.v).slice(0, 10);
  if (!old.length || refreshingWords) return;
  refreshingWords = true;
  try {
    const D = await import('./dict.js');
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
async function wordLookup(raw, opts = {}) {
  const D = await import('./dict.js');
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
function wordItem(w) {
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
function vocabView() {
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
const wordActions = {
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
function tagIndex() {
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

function tagsView() {
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
async function retag(from, to) {
  const key = norm(from);
  await commit(async () => {
    for (const n of state.notes.filter((x) => (x.tags || []).some((t) => norm(t) === key))) {
      await persist('notes', { ...n, tags: splitTags(n.tags.flatMap((t) => (norm(t) === key ? to : [t]))), updatedAt: Date.now() });
    }
  }, { quiet: true });
}

const tagActions = {
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

function noteDetail(id) {
  const n = noteById(id);
  if (!n) return empty('Nota não encontrada.', '<a class="btn" href="#/notas">Voltar</a>');
  const b = bookById(n.bookId);
  const out = [...new Set(linksOf(n.text))];
  const backlinks = n.title ? state.notes.filter((x) => x.id !== n.id && linksOf(x.text).some((l) => norm(l) === norm(noteTitle(n)))) : [];
  const shared = state.notes.filter((x) => x.id !== n.id && (
    (x.tags || []).some((t) => (n.tags || []).map(norm).includes(norm(t))) ||
    linksOf(x.text).some((l) => out.map(norm).includes(norm(l)))
  )).slice(0, 8);
  const cards = state.cards.filter((c) => c.noteId === n.id);
  return `<a href="#/notas" class="back">← Notas</a>
  <section class="card note ${n.kind === 'quote' ? 'quote' : ''}">
    ${n.title ? `<h2 style="margin-top:0">${esc(noteTitle(n))}</h2>` : ''}
    <div class="note-text">${renderText(n.text)}</div>
    <div class="small muted">${b ? `<a href="#/livro/${b.id}">${esc(b.title)}</a>` : ''}${n.page ? ` · pág. ${n.page}` : ''} · ${n.kind === 'quote' ? 'Citação' : 'Reflexão'}
      ${n.source === 'ocr' ? '<span class="chip">📷 OCR</span>' : ''}
      ${(n.tags || []).map((t) => `<a class="chip tag" href="${conceptHref(t)}">#${esc(t)}</a>`).join('')}</div>
  </section>
  <div class="quick">
    <button class="btn primary" data-action="postNote" data-id="${n.id}">📸 Criar post</button>
    <button class="btn" data-action="newCard" data-id="${n.id}">🧠 Criar card</button>
    <button class="btn" data-action="aiCards" data-id="${n.id}">✨ Cards com IA</button>
    <button class="btn" data-action="aiLinks" data-id="${n.id}">✨ Sugerir conexões</button>
    <button class="btn" data-action="feynman" data-id="${n.id}">🎓 Explicar com minhas palavras</button>
    <a class="btn" href="#/mapa/${encodeURIComponent(`n:${n.id}`)}">🕸️ No mapa</a>
    <button class="btn" data-action="shareNote" data-id="${n.id}">↗ Compartilhar</button>
    ${Cloud.user() ? `<button class="btn" data-action="noteToClub" data-id="${n.id}">👥 No clube</button>` : ''}
    <button class="btn ghost" data-action="editNote" data-id="${n.id}">✏️ Editar</button>
  </div>
  ${out.length ? `<h3>Liga-se a</h3><div class="chips">${out.map((l) => { const r = resolveLink(l); return `<a class="wl ${r.type}" href="${r.href}">${esc(l)}</a>`; }).join(' ')}</div>` : ''}
  ${backlinks.length ? `<h3>Notas que citam esta</h3><section class="card backlinks">${backlinks.map((x) => `<a href="#/nota/${x.id}">${esc(noteLabel(x))}<br><small>${esc(bookById(x.bookId)?.title || '')}</small></a>`).join('')}</section>` : ''}
  ${shared.length ? `<h3>Ideias próximas</h3><section class="card backlinks">${shared.map((x) => `<a href="#/nota/${x.id}">${esc(noteLabel(x))}<br><small>${esc(bookById(x.bookId)?.title || '')}</small></a>`).join('')}</section>` : ''}
  <h3>Cards (${cards.length})</h3>
  ${cards.length ? cards.map(cardItem).join('') : empty('Transforme esta nota em perguntas para revisar depois.')}
  <button class="btn danger ghost block" data-action="deleteNote" data-id="${n.id}">Excluir nota</button>`;
}

function conceptView(raw) {
  const name = decodeURIComponent(raw || '');
  const k = norm(name);
  const books = state.books.filter((b) => norm(b.genre) === k || norm(b.subtheme) === k);
  const notes = state.notes.filter((n) => linksOf(n.text).some((l) => norm(l) === k) || (n.tags || []).some((t) => norm(t) === k));
  const isTheme = state.books.some((b) => norm(b.genre) === k);
  const kind = isTheme ? 'Tema' : state.books.some((b) => norm(b.subtheme) === k) ? 'Subtema' : 'Conceito';
  const subs = isTheme ? [...new Set(books.map((b) => b.subtheme).filter(Boolean))] : [];
  return `<a href="#/notas" class="back">← Ideias</a>
  <h2>💡 ${esc(name)} <span class="chip">${kind}</span></h2>
  <div class="quick"><a class="btn" href="#/mapa/${encodeURIComponent(`c:${k}`)}">🕸️ Ver no mapa</a>
    <button class="btn" data-action="newNote" data-link="${esc(name)}">✍️ Nota sobre isto</button>
    ${notes.length ? `<button class="btn" data-action="feynman" data-concept="${esc(name)}">🎓 Explicar com minhas palavras</button>` : ''}</div>
  ${subs.length ? `<h3>Subtemas</h3><div class="chips">${subs.map((x) => `<a class="chip tag" href="${conceptHref(x)}">${esc(x)}</a>`).join('')}</div>` : ''}
  ${books.length ? `<h3>Livros (${books.length})</h3>${books.map(bookCard).join('')}` : ''}
  <h3>Notas conectadas (${notes.length})</h3>
  ${notes.length ? notes.map((n) => noteCard(n)).join('') : empty(`Nenhuma nota liga para [[${esc(name)}]] ainda.`)}`;
}

// ---------- filtros por finalidade, tema, autor e livro (mapa e revisão) ----------
// Cada tela guarda os seus na sessão; as opções de um filtro se ajustam aos outros já escolhidos.
// Cada filtro é um campo de texto: ao digitar, a lista mostra só as opções que combinam.
const SCOPE_FIELDS = ['purpose', 'theme', 'author', 'book'];
function getScope(key) {
  try { return JSON.parse(sessionStorage.getItem(key)) || {}; } catch { return {}; }
}
const scopeActive = (f) => SCOPE_FIELDS.some((k) => f[k]);
// "Fulano; Beltrano" ou "Fulano & Beltrano": cada autor conta separado no filtro
const authorsOf = (b) => String(b.author || '').split(/\s*[;&]\s*/).map((a) => a.trim()).filter(Boolean);
function bookInScope(b, f, skip = '') {
  return (!f.purpose || skip === 'purpose' || (b.purpose || 'hobby') === f.purpose)
    && (!f.theme || skip === 'theme' || norm(b.genre || '') === f.theme)
    && (!f.author || skip === 'author' || authorsOf(b).some((a) => norm(a) === f.author))
    && (!f.book || skip === 'book' || (f.book === '__books' ? !isArticle(b) : f.book === '__articles' ? isArticle(b) : b.id === f.book));
}
const isArticle = (b) => b.kind === 'article' || b.kind === 'pdf';
// nota passa no filtro pelo livro ou artigo dela; "__none" são as notas soltas (sem livro)
function noteInScope(n, f) {
  if (!scopeActive(f)) return true;
  const b = bookById(n.bookId);
  if (f.book === '__none') return !b && SCOPE_FIELDS.every((k) => k === 'book' || !f[k]);
  return !!b && bookInScope(b, f);
}
function scopeOptions(key, field) {
  const f = getScope(key);
  const pool = sources().filter((b) => bookInScope(b, f, field));
  const uniq = (pairs) => [...new Map(pairs.filter(([v]) => v).map((p) => [p[0], p])).values()].sort((a, b) => a[1].localeCompare(b[1], LOCALE));
  if (field === 'purpose') return Object.entries(PURPOSE).map(([k, p]) => [k, tr(p.label)]);
  if (field === 'theme') return uniq(pool.map((b) => [norm(b.genre || ''), b.genre]));
  if (field === 'author') return uniq(pool.flatMap((b) => authorsOf(b).map((a) => [norm(a), a])));
  const special = [];
  if (pool.some(isArticle) && pool.some((b) => !isArticle(b))) special.push(['__books', tr('Só livros')], ['__articles', tr('Só artigos')]);
  if (key === 'notesScope' && state.notes.some((n) => !bookById(n.bookId))) special.push(['__none', tr('Sem livro (notas soltas)')]);
  return [...special, ...uniq(pool.map((b) => [b.id, isArticle(b) ? `${b.title} (${tr('artigo')})` : b.title]))];
}
const SCOPE_ALL = { purpose: 'Todas as finalidades', theme: 'Todos os temas', author: 'Todos os autores', book: 'Todos os livros e artigos' };
function scopeFilters(key) {
  const f = getScope(key);
  const combo = (field) => {
    const cur = f[field] ? scopeOptions(key, field).find(([v]) => v === f[field])?.[1] || '' : '';
    return `<div class="combo${cur ? ' set' : ''}" data-scope="${key}" data-field="${field}">
      <input class="search" type="text" placeholder="${SCOPE_ALL[field]}" value="${esc(cur)}" autocomplete="off" aria-label="${SCOPE_ALL[field]}" role="combobox" aria-expanded="false">
      ${cur ? `<button type="button" class="combo-clear" aria-label="Tirar este filtro">✕</button>` : ''}
      <ul class="combo-list" role="listbox" hidden></ul>
    </div>`;
  };
  return `<div class="scope-filters">
    ${SCOPE_FIELDS.map(combo).join('')}
    ${scopeActive(f) ? `<button class="btn small ghost" data-action="clearScope" data-key="${key}">✕ Limpar filtros</button>` : ''}
  </div>`;
}
function applyScope(key, field, value) {
  const f = { ...getScope(key), [field]: value };
  // o livro escolhido sai do filtro se não combinar mais com tema/autor/finalidade
  if (f.book && !f.book.startsWith('__') && !(bookById(f.book) && bookInScope(bookById(f.book), f, 'book'))) delete f.book;
  for (const k of SCOPE_FIELDS) if (!f[k]) delete f[k];
  sessionStorage.setItem(key, JSON.stringify(f));
  render();
}

// Campo de escolha com busca para formulários: o valor vai num campo escondido com o mesmo name
function pickField(name, options, value, { all = '', placeholder = '' } = {}) {
  const label = options.find(([v]) => v === value)?.[1] || '';
  return `<div class="combo${value ? ' set' : ''}" data-pick data-all="${esc(all)}" data-opts="${esc(JSON.stringify(options))}">
    <input type="hidden" name="${name}" value="${esc(value || '')}">
    <input class="search" type="text" placeholder="${esc(placeholder)}" value="${esc(label)}" autocomplete="off" role="combobox" aria-expanded="false" aria-label="${esc(placeholder)}">
    <ul class="combo-list" role="listbox" hidden></ul>
  </div>`;
}
const comboInput = (box) => box.querySelector('input:not([type=hidden])');
const comboOpts = (box) => (box.dataset.scope ? scopeOptions(box.dataset.scope, box.dataset.field) : (box._opts ||= JSON.parse(box.dataset.opts || '[]')));
const comboCur = (box) => (box.dataset.scope ? getScope(box.dataset.scope)[box.dataset.field] || '' : box.querySelector('input[type=hidden]').value);
const comboAll = (box) => (box.dataset.scope ? SCOPE_ALL[box.dataset.field] : box.dataset.all); // primeira opção (nenhuma escolha)
function comboChoose(box, v) {
  if (box.dataset.scope) { applyScope(box.dataset.scope, box.dataset.field, v); return; }
  const hidden = box.querySelector('input[type=hidden]');
  hidden.value = v;
  box.classList.toggle('set', !!v);
  comboClose(box);
  hidden.dispatchEvent(new Event('change', { bubbles: true }));
}

// Lista do filtro: abre ao tocar, filtra ao digitar, escolhe com toque, setas + Enter; Esc fecha
function comboRender(box) {
  const input = comboInput(box);
  const list = box.querySelector('.combo-list');
  // sem diferenciar acentos: "atom" acha "Atômicos"
  const fold = (t) => norm(t).normalize('NFD').replace(/\p{M}/gu, '');
  const q = fold(input.value);
  const cur = comboCur(box);
  const all = comboOpts(box);
  const curLabel = all.find(([v]) => v === cur)?.[1] || '';
  // com a opção escolhida ainda escrita no campo, mostra todas; ao digitar, só as que combinam
  const typed = q && q !== fold(curLabel);
  const opts = all.filter(([, l]) => !typed || fold(l).includes(q));
  const first = comboAll(box) ? [['', comboAll(box)]] : [];
  list.innerHTML = [...first, ...opts].map(([v, l], i) => `<li role="option" data-v="${esc(v)}" class="${v === cur ? 'cur' : ''}${i === (typed && opts.length ? 1 : 0) ? ' hi' : ''}">${esc(l)}</li>`).join('')
    + (typed && !opts.length ? '<li class="none">Nada encontrado</li>' : '');
  if (!first.length && !list.querySelector('.hi')) list.querySelector('li[data-v]')?.classList.add('hi');
  list.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}
function comboClose(box, restore = true) {
  const list = box.querySelector('.combo-list');
  const input = comboInput(box);
  list.hidden = true;
  input.setAttribute('aria-expanded', 'false');
  if (restore) {
    const cur = comboCur(box);
    input.value = cur ? comboOpts(box).find(([v]) => v === cur)?.[1] || '' : '';
  }
}
document.addEventListener('focusin', (e) => { const box = e.target.closest?.('.combo'); if (box) { e.target.select?.(); comboRender(box); } });
document.addEventListener('focusout', (e) => { const box = e.target.closest?.('.combo'); if (box) setTimeout(() => { if (!box.contains(document.activeElement)) comboClose(box); }, 120); });
document.addEventListener('input', (e) => { const box = e.target.closest?.('.combo'); if (box) comboRender(box); });
// o "✕" do campo tira só esse filtro
document.addEventListener('click', (e) => {
  const x = e.target.closest?.('.combo-clear');
  if (!x) return;
  const box = x.closest('.combo');
  applyScope(box.dataset.scope, box.dataset.field, '');
});
document.addEventListener('mousedown', (e) => {
  const li = e.target.closest?.('.combo-list li[data-v]');
  if (!li) return;
  e.preventDefault(); // não tira o foco antes de escolher
  comboChoose(li.closest('.combo'), li.dataset.v);
});
document.addEventListener('keydown', (e) => {
  const box = e.target.closest?.('.combo');
  if (!box) return;
  const items = [...box.querySelectorAll('.combo-list li[data-v]')];
  const i = items.findIndex((li) => li.classList.contains('hi'));
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (box.querySelector('.combo-list').hidden) { comboRender(box); return; }
    const next = items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    items.forEach((li) => li.classList.toggle('hi', li === next));
    next?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const pick = items[i];
    if (pick) comboChoose(box, pick.dataset.v);
  } else if (e.key === 'Escape') {
    comboClose(box);
    e.target.blur();
  }
});

// ---------- mapa mental ----------
let graphApi = null;

// Dados do mapa: cada tema é uma ilha (grupo) com seus livros e subtemas; as ligações das notas
// vão do livro para a ideia citada; as próprias notas ficam guardadas para aparecer ao tocar no livro.
// cor de cada tema: posição na lista de todos os temas da biblioteca, para não mudar com os filtros
const themeIndex = (key) => [...new Set(state.books.map((b) => norm(b.genre || '')).filter(Boolean))].sort().indexOf(key);

function graphData(scope = {}) {
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
  const books = sources().filter((b) => bookInScope(b, scope));
  const ids = new Set(books.map((b) => b.id));

  for (const b of books) {
    const group = b.genre ? norm(b.genre) : '';
    if (group && !groups.has(group)) groups.set(group, { key: group, label: b.genre, href: conceptHref(b.genre), color: themeIndex(group) });
    const art = b.kind === 'article';
    const bid = node(`b:${b.id}`, b.title, 'book', { purpose: b.purpose || 'hobby', href: srcHref(b), group, article: art || b.kind === 'pdf' });
    if (b.subtheme && norm(b.subtheme) !== group) link(bid, node(`c:${norm(b.subtheme)}`, b.subtheme, 'subtheme', { href: conceptHref(b.subtheme), group }));
  }
  for (const n of state.notes) {
    if (!ids.has(n.bookId)) continue;
    const bid = `b:${n.bookId}`;
    node(`n:${n.id}`, noteLabel(n), 'note', { href: `#/nota/${n.id}`, parent: bid });
    for (const t of n.tags || []) link(bid, node(`c:${norm(t)}`, `#${t}`, 'tag', { href: conceptHref(t) }));
    for (const l of linksOf(n.text)) {
      const r = resolveLink(l);
      if (r.type === 'book') { if (nodes.has(r.node)) link(bid, r.node); continue; } // livro filtrado fica de fora
      if (r.type === 'note') { link(bid, `b:${noteById(r.node.slice(2))?.bookId}`); continue; }
      if (groups.has(norm(l))) continue; // [[Tema]]: o livro já está na ilha do tema
      node(r.node, l, 'concept', { href: r.href });
      link(bid, r.node);
    }
  }
  return { nodes: [...nodes.values()], groups: [...groups.values()], links: [...links.values()].filter((l) => nodes.has(l.source) && nodes.has(l.target)) };
}

// O que aparece no mapa (escolha de cada pessoa, guardada no aparelho)
const MAP_SHOW = [['books', 'Livros'], ['areas', 'Áreas'], ['subthemes', 'Subtemas'], ['ideas', 'Ideias'], ['tags', 'Tags']];
function mapShow() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('grifo.mapShow')) || {}; } catch { /* sem armazenamento */ }
  return Object.fromEntries(MAP_SHOW.map(([k]) => [k, saved[k] !== false]));
}
const TYPE_LABEL = { book: 'Livro', theme: 'Tema', subtheme: 'Subtema', tag: 'Tag', note: 'Nota', concept: 'Ideia' };

function mapView() {
  const scope = getScope('mapScope');
  const show = mapShow();
  const d = applyShow(graphData(scope), show);
  return `${seg(IDEAS_SEG, 'map')}
  <input type="search" class="search" id="graph-search" placeholder="Encontrar no mapa…" style="margin-bottom:8px">
  ${scopeFilters('mapScope')}
  <div class="map-show"><span class="small muted">Mostrar:</span>${MAP_SHOW.map(([k, label]) => `<label class="chip-toggle"><input type="checkbox" data-map-show="${k}" ${show[k] ? 'checked' : ''}> ${label}</label>`).join('')}</div>
  ${d.nodes.length ? `<section class="card graph-wrap">
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
      <span><i class="dot diamond"></i>Ideia que liga livros</span>
    </div>
  </section>
  <section class="card" id="graph-panel"><p class="small muted" style="margin:0">Cada ilha é um tema. Toque num livro para ver as notas dele, ou numa ilha para ver o tema. Arraste para mover; use dois dedos (ou a roda do mouse) para zoom.</p></section>`
    : scopeActive(scope) ? empty('Nenhum livro com esses filtros.') : empty('O mapa aparece quando você cadastrar livros com tema e criar notas com [[ligações]].', '<button class="btn primary" data-action="newBook">Adicionar livro</button>')}`;
}
mapView.mount = (arg) => {
  const canvas = $('#graph');
  if (!canvas) return;
  const panel = $('#graph-panel');
  graphApi = createGraph(canvas, applyShow(graphData(getScope('mapScope')), mapShow()), {
    onSelect(n, near) {
      if (!n) { panel.innerHTML = '<p class="small muted" style="margin:0">Toque num livro para ver as notas dele, ou numa ilha para ver o tema.</p>'; return; }
      const order = ['subtheme', 'book', 'concept', 'tag', 'note'];
      near.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
      const notes = near.filter((x) => x.type === 'note');
      const others = near.filter((x) => x.type !== 'note');
      const chip = (x) => `<a class="chip" href="${x.href}">${esc(x.article ? 'Artigo' : TYPE_LABEL[x.type])}: ${esc(x.label.length > 40 ? `${x.label.slice(0, 39)}…` : x.label)}</a>`;
      const count = n.type === 'theme' ? `${others.length} na ilha` : `${others.length} ${others.length === 1 ? 'conexão' : 'conexões'}`;
      panel.innerHTML = `<div class="row between gap"><div><span class="chip">${n.article ? 'Artigo' : TYPE_LABEL[n.type]}</span><h3 style="margin:4px 0 0">${esc(n.label)}</h3></div>
        <a class="btn small primary" href="${n.href}">Abrir</a></div>
        ${others.length ? `<div class="small muted" style="margin:10px 0 4px">${count}</div><div class="chips">${others.map(chip).join('')}</div>` : ''}
        ${notes.length ? `<div class="small muted" style="margin:10px 0 4px">${notes.length} ${notes.length === 1 ? 'nota' : 'notas'}</div><div class="chips">${notes.map(chip).join('')}</div>` : ''}`;
    },
  });
  $('#graph-legend').innerHTML = graphApi.groups().map((g) => `<a href="#" data-island="${esc(g.key)}"><i class="dot" style="background:${g.color}"></i>${esc(g.label)}</a>`).join('')
    || (mapShow().areas ? '<span class="muted">Dê um tema aos livros para formar as ilhas.</span>' : '<span class="muted">Áreas escondidas: só as ligações entre os pontos.</span>');
  $('#graph-legend').onclick = (e) => {
    const a = e.target.closest('[data-island]');
    if (!a) return;
    e.preventDefault();
    graphApi.selectById(`g:${a.dataset.island}`);
  };
  view.querySelectorAll('[data-graph]').forEach((b) => {
    b.onclick = () => ({ in: () => graphApi.zoom(1.3), out: () => graphApi.zoom(1 / 1.3), fit: () => graphApi.fit(), photo: () => actions.shareMap() })[b.dataset.graph]();
  });
  const search = $('#graph-search');
  search.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!graphApi.find(search.value)) toast('Nada encontrado no mapa.'); } };
  if (arg) setTimeout(() => graphApi.selectById(decodeURIComponent(arg)), 50);
};

// ---------- cards de memorização ----------
// [[ligação]] já escapada → negrito, sem os colchetes (em cards e textos que não levam a lugar nenhum)
const linkBold = (html) => html.replace(LINK_RE, (m, x) => `<b class="wl-txt">${x.split('|').pop().trim()}</b>`)
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'); // **negrito**: classes e listas no verso dos cards de palavras

function cardFace(c, answer) {
  if (c.type === 'cloze') {
    const html = linkBold(esc(c.front)).replace(/\n/g, '<br>');
    return answer ? S.clozeAnswer(html) : S.clozeQuestion(html);
  }
  return linkBold(esc(answer ? c.back : c.front)).replace(/\n/g, '<br>');
}

function cardItem(c) {
  const b = bookById(c.bookId);
  return `<div class="card card-item">
    <div class="q">${cardFace(c, false)}</div>
    ${c.type === 'qa' ? `<div class="muted">${esc(plainText(c.back)).slice(0, 160)}</div>` : ''}
    <div class="row between small muted" style="margin-top:6px">
      <span>${b ? esc(b.title) : ''} · próxima: ${c.due <= state.stats.today ? 'hoje' : fmtDate(c.due)}</span>
      <span class="row gap-s"><button class="icon-btn" data-action="editCard" data-id="${c.id}" aria-label="Editar">✏️</button>
      <button class="icon-btn" data-action="deleteCard" data-id="${c.id}" aria-label="Excluir">🗑️</button></span>
    </div></div>`;
}

// cards dentro do filtro da revisão (pelo livro do card ou da nota de origem)
function reviewCards(f = getScope('reviewScope')) {
  if (!scopeActive(f)) return [...state.cards];
  return state.cards.filter((c) => {
    const b = bookById(c.bookId || noteById(c.noteId)?.bookId);
    return b && bookInScope(b, f);
  });
}

function reviewView() {
  const s = state.stats;
  if (review && review.queue.length) {
    const c = state.cards.find((x) => x.id === review.queue[0]);
    if (!c) { review.queue.shift(); return reviewView(); }
    const b = bookById(c.bookId), n = noteById(c.noteId);
    return `<div class="row between"><button class="btn small ghost" data-action="stopReview">✕ Encerrar</button>
      <span class="small muted">${review.done} feitas · ${review.queue.length} restantes</span></div>
      <div class="bar"><div style="width:${(review.done / (review.done + review.queue.length)) * 100}%"></div></div>
      <section class="card review-card">
        <div class="small muted">${b ? esc(b.title) : ''}${n?.page ? ` · pág. ${n.page}` : ''}</div>
        <div class="review-q">${cardFace(c, false)}</div>
        ${review.revealed ? `<div class="review-a">${c.type === 'cloze' ? cardFace(c, true) : cardFace(c, true)}</div>` : ''}
      </section>
      ${review.revealed
        ? `<div class="grades">${S.GRADES.map((g) => `<button class="btn ${g.cls}" data-action="grade" data-g="${g.g}">${g.label}<small>${S.intervalLabel(c, g.g, s.today)}</small></button>`).join('')}</div>
           <p class="small muted center">Atalhos: 1 Errei · 2 Difícil · 3 Bom · 4 Fácil</p>`
        : '<button class="btn primary block" data-action="reveal" style="margin-top:0">Mostrar resposta <small>(espaço)</small></button>'}
      ${n ? `<p class="small center"><a href="#/nota/${n.id}">Ver nota de origem</a></p>` : ''}`;
  }
  const finished = review && review.done > 0;
  review = null;
  const scope = getScope('reviewScope');
  const cards = reviewCards().sort((a, b) => a.due.localeCompare(b.due));
  const due = cards.filter((c) => c.due <= s.today).length;
  const filtered = scopeActive(scope);
  return `<h2>Revisar</h2>
  ${state.cards.length ? scopeFilters('reviewScope') : ''}
  ${finished ? '<section class="card center"><span class="big-emoji">🎉</span><b>Revisão concluída!</b><span class="small muted">Os cards voltam no momento certo para você não esquecer.</span></section>' : ''}
  ${examSection()}
  <section class="grid3">
    <div class="card stat"><b>${due}</b><span>para hoje</span></div>
    <div class="card stat"><b>${cards.length}</b><span>${filtered ? 'cards no filtro' : 'cards no total'}</span></div>
    <div class="card stat"><b>${s.reviews ? `${Math.round(s.retention * 100)}%` : '—'}</b><span>acertos</span></div>
  </section>
  ${due ? `<button class="btn primary block" data-action="startReview" style="margin:0 0 12px">🧠 Revisar ${Math.min(due, state.settings.dailyCards)} cards agora</button>`
    : `<p class="nudge">${filtered && cards.length ? 'Nada para hoje neste filtro. Os cards voltam no momento certo.' : filtered ? 'Nenhum card com esses filtros.' : s.cards ? 'Tudo em dia! Volte amanhã para a próxima rodada.' : 'Crie cards a partir das suas notas (botão 🧠) para memorizar o que leu.'}</p>`}
  <p class="small muted">Cada card volta num intervalo que cresce conforme você acerta (repetição espaçada, como no Anki). +${G.XP.review} XP por revisão.</p>
  <h3>${filtered ? 'Cards no filtro' : 'Todos os cards'} (${cards.length})</h3>
  ${cards.length ? cards.map(cardItem).join('') : empty('Nenhum card ainda.', '<a class="btn" href="#/notas">Ir para as notas</a>')}`;
}

// ---------- busca em tudo ----------
// Livros, artigos (inclusive o texto), notas e ideias (temas, subtemas, conceitos e tags) num campo só
function searchAll(q) {
  const k = norm(q);
  if (k.length < 2) return null;
  const has = (...xs) => xs.some((x) => x && norm(x).includes(k));
  // trecho do texto em volta do termo, com o termo destacado
  const snippet = (text) => {
    const t = String(text || '').replace(/\s+/g, ' ');
    const i = norm(t).indexOf(k);
    if (i < 0) return esc(t.slice(0, 120));
    const a = Math.max(0, i - 60);
    const part = t.slice(a, i + k.length + 80);
    const j = i - a;
    return `${a ? '…' : ''}${esc(part.slice(0, j))}<mark>${esc(part.slice(j, j + k.length))}</mark>${esc(part.slice(j + k.length))}…`;
  };
  const books = state.books.filter((b) => has(b.title, b.author, b.genre, b.subtheme, b.isbn));
  const articles = state.articles.filter((a) => has(a.title, a.author, a.site, a.genre, a.subtheme) || (a.blocks || []).some((b) => has(b.x)))
    .map((a) => ({ a, hit: (a.blocks || []).find((b) => has(b.x))?.x }));
  const notes = state.notes.filter((n) => has(n.title, plainText(n.text), ...(n.tags || [])));
  const ideas = new Map();
  for (const b of sources()) for (const x of [b.genre, b.subtheme]) if (x && has(x)) ideas.set(norm(x), x);
  for (const n of state.notes) for (const x of [...linksOf(n.text), ...(n.tags || [])]) if (has(x) && resolveLink(x).type === 'concept') ideas.set(norm(x), x);
  return { books, articles, notes, ideas: [...ideas.values()], snippet };
}

function searchView() {
  const q = sessionStorage.getItem('searchQ') || '';
  return `<h2>Buscar</h2>
  <input type="search" class="search" id="search-all" placeholder="Livros, artigos, notas e ideias…" value="${esc(q)}" autocomplete="off" enterkeyhint="search">
  <div id="search-out">${searchResults(q)}</div>`;
}
function searchResults(q) {
  const r = searchAll(q);
  if (!r) return '<p class="small muted">Digite ao menos 2 letras. A busca olha títulos, autores, temas, o texto das notas e o texto dos artigos salvos.</p>';
  const total = r.books.length + r.articles.length + r.notes.length + r.ideas.length;
  if (!total) return `<p class="nudge">Nada encontrado para “${esc(q)}”.</p>`;
  const MAX = 8;
  const more = (n) => (n > MAX ? `<p class="small muted">+ ${n - MAX} resultado(s). Refine a busca.</p>` : '');
  return [
    r.ideas.length ? `<h3>Ideias e temas (${r.ideas.length})</h3><div class="chips">${r.ideas.slice(0, 20).map((x) => `<a class="chip tag" href="${conceptHref(x)}">${esc(x)}</a>`).join('')}</div>` : '',
    r.books.length ? `<h3>Livros (${r.books.length})</h3>${r.books.slice(0, MAX).map(bookCard).join('')}${more(r.books.length)}` : '',
    r.articles.length ? `<h3>Artigos (${r.articles.length})</h3>${r.articles.slice(0, MAX).map(({ a, hit }) => `<a class="card search-hit" href="${srcHref(a)}"><b>${esc(a.title)}</b><div class="small muted">${esc(a.site || '')}</div>${hit ? `<div class="small">${r.snippet(hit)}</div>` : ''}</a>`).join('')}${more(r.articles.length)}` : '',
    r.notes.length ? `<h3>Notas (${r.notes.length})</h3>${r.notes.slice(0, MAX).map((n) => `<a class="card search-hit" href="#/nota/${n.id}">${n.title ? `<b>${esc(noteTitle(n))}</b>` : ''}<div class="small">${r.snippet(plainText(n.text))}</div><div class="small muted">${esc(bookById(n.bookId)?.title || '')}</div></a>`).join('')}${more(r.notes.length)}` : '',
  ].join('');
}
searchView.mount = () => {
  const input = $('#search-all');
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  let t = 0;
  input.oninput = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      sessionStorage.setItem('searchQ', input.value);
      $('#search-out').innerHTML = searchResults(input.value);
    }, 150);
  };
};
// "/" abre a busca (fora de campos de texto)
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  if (document.body.classList.contains('gated')) return;
  e.preventDefault();
  location.hash = '#/busca';
});

// ---------- artigos salvos por link ----------
const FREE_ARTICLES = 10;
const SHARED_KEY = 'grifo.shared';

// tempo de leitura (~200 palavras por minuto) e quanto já foi lido (guardado neste aparelho)
const readMinutes = (a) => Math.max(1, Math.round((a.blocks || []).reduce((n, b) => n + b.x.split(/\s+/).length, 0) / 200));
const POS_KEY = (id) => `grifo.artpos.${id}`;
function readPos(id) {
  try { return JSON.parse(localStorage.getItem(POS_KEY(id))) || { p: 0, y: 0 }; } catch { return { p: 0, y: 0 }; }
}
const ART_QUEUE = { want: 'Ler depois', reading: 'Lendo', finished: 'Lidos' };

// artigo ou PDF começado: marcado como lendo ou com parte do texto já lida
const articleStarted = (a) => a.status !== 'finished' && (a.status === 'reading' || readPos(a.id).p > 0.05);
function articleItem(a) {
  const notes = state.notes.filter((n) => n.bookId === a.id).length;
  const pos = readPos(a.id).p;
  const status = a.status === 'finished' ? '<span class="chip">✓ Lido</span>'
    : articleStarted(a) ? `<span class="chip p-academic">Lendo${pos > 0.05 ? ` · ${Math.round(pos * 100)}%` : ''}</span>` : '<span class="chip">Ler depois</span>';
  return `<a class="card book art-item" href="${srcHref(a)}">
      ${a.cover ? `<img class="art-thumb" src="${esc(a.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="art-thumb ph">${a.kind === 'pdf' ? '📄' : '📰'}</span>`}
      <div class="grow"><div class="book-title">${esc(a.title)}</div>
        <div class="small muted">${a.kind === 'pdf' ? `PDF · ${a.pages || '?'} páginas` : `${esc(a.site || '')} · ${readMinutes(a)} min`}${notes ? ` · ${notes} ${notes === 1 ? 'grifo' : 'grifos'}` : ''}</div>
        <div class="chips" style="margin-top:4px">${status}${a.genre ? `<span class="chip tag">${esc(a.genre)}</span>` : ''}</div></div></a>`;
}

function articlesView() {
  const filter = sessionStorage.getItem('artFilter') || 'all';
  const all = [...state.articles].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const list = filter === 'all' ? all : all.filter((a) => (a.status || 'want') === filter);
  const count = (k) => all.filter((a) => (a.status || 'want') === k).length;
  return `${seg(READ_SEG, 'articles')}
  <h2>Artigos e PDFs</h2>
  <form class="row gap-s" id="art-form"><input name="url" type="url" class="search grow" required placeholder="Cole o link de um artigo…" autocomplete="off" style="margin:0"><button class="btn primary" id="art-save">Salvar</button></form>
  <div class="row gap-s wrap" style="margin-top:8px"><button class="btn" data-action="addPdf">📄 Adicionar PDF</button><input type="file" id="pdf-file" accept="application/pdf,.pdf" hidden></div>
  <p class="hint">No celular, em qualquer site ou app de notícias: <b>Compartilhar → Grifo</b>. Depois é só selecionar um trecho e tocar em <b>Grifar</b>.</p>
  ${!isPlus() ? `<p class="small muted">${state.articles.length} de ${FREE_ARTICLES} artigos do plano grátis · <a href="#/plus">ilimitados no Plus</a></p>` : ''}
  ${all.length ? `<div class="tabs">${[['all', `Todos (${all.length})`], ...Object.entries(ART_QUEUE).map(([k, v]) => [k, `${v} (${count(k)})`])]
    .map(([k, v]) => `<button class="tab ${filter === k ? 'active' : ''}" data-action="artFilter" data-v="${k}">${v}</button>`).join('')}</div>` : ''}
  ${list.length ? list.map(articleItem).join('')
    : all.length ? '<p class="nudge">Nenhum artigo aqui.</p>' : empty('Salve artigos, posts e notícias para ler, grifar e conectar com seus livros.')}`;
}
articlesView.mount = () => {
  const form = $('#art-form');
  form.onsubmit = (e) => { e.preventDefault(); actions.saveArticle({ url: form.url.value.trim() }); };
};

// Finalidade, tema e subtema do artigo (como nos livros), com o botão para mudar
function articleTags(a) {
  const pp = PURPOSE[a.purpose || 'hobby'];
  const parts = [a.genre, a.subtheme].filter(Boolean);
  return parts.length
    ? `<div class="chips art-tags"><span class="chip p-${a.purpose || 'hobby'}">${pp.icon} ${pp.label}</span>${parts.map((x) => `<a class="chip tag" href="${conceptHref(x)}">${esc(x)}</a>`).join('')}<button class="chip chip-btn" data-action="classifyArticle" data-id="${a.id}">✏️ Classificar</button></div>`
    : `<button class="card art-classify" data-action="classifyArticle" data-id="${a.id}">🏷️ <span><b>Classifique este artigo</b><br><span class="small muted">Finalidade, tema e subtema: ele passa a aparecer no mapa, nos filtros e junto dos livros do mesmo tema.</span></span></button>`;
}

// Marca no texto os trechos já grifados (as notas de citação deste artigo)
function markHighlights(html, quotes) {
  let out = html;
  for (const q of quotes) {
    const h = esc(q);
    if (h.length >= 3 && out.includes(h)) out = out.replace(h, `<mark>${h}</mark>`);
  }
  return out;
}

function articleView(id) {
  const a = state.articles.find((x) => x.id === id);
  if (!a) return `<a href="#/artigos" class="back">← Artigos</a>${empty('Artigo não encontrado.')}`;
  const notes = state.notes.filter((n) => n.bookId === id).sort((x, y) => x.createdAt - y.createdAt);
  const quotes = notes.filter((n) => n.kind === 'quote').map((n) => plainText(n.text));
  const tag = { h: 'h3', q: 'blockquote', li: 'li', p: 'p' };
  const body = (a.blocks || []).map((b) => `<${tag[b.t] || 'p'}>${markHighlights(esc(b.x), quotes)}</${tag[b.t] || 'p'}>`).join('');
  return `<a href="#/artigos" class="back">← Artigos</a>
  <article class="reader">
    <div class="small muted">${esc([a.site, a.author, `${readMinutes(a)} min de leitura`].filter(Boolean).join(' · '))}</div>
    <h1 class="reader-title">${esc(a.title)}</h1>
    <div class="quick">
      <a class="btn small" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">↗ Original</a>
      <button class="btn small" data-action="articleRead" data-id="${a.id}">${a.status === 'finished' ? '✓ Lido' : '✔ Marcar como lido'}</button>
      <button class="btn small" data-action="newNote" data-id="${a.id}">✍️ Nota</button>
      <button class="btn small ghost" data-action="deleteArticle" data-id="${a.id}">🗑️ Excluir</button>
    </div>
    ${articleTags(a)}
    <div class="reader-body" id="reader-body">${body}</div>
  </article>
  <h3>Seus grifos (${notes.length})</h3>
  ${notes.length ? notes.map((n) => noteCard(n, false)).join('') : '<p class="small muted">Selecione um trecho do texto e toque em <b>Grifar</b>.</p>'}
  <div class="sel-bar" id="sel-bar" hidden><button class="btn primary" id="grifar-btn">🖍️ Grifar trecho</button><button class="btn" id="define-btn" hidden>📖 Significado</button></div>`;
}
// Seleção de texto + botão "Grifar" (artigos e PDFs). onSave recebe o texto e a página (no PDF).
function attachGrifar(bodyEl, btn, onSave, { sourceId = null } = {}) {
  // a barra tem o Grifar e, com uma palavra (ou expressão curta) selecionada, o Significado
  const bar = btn.closest('.sel-bar') || btn;
  const defineBtn = bar.querySelector('#define-btn');
  const shortSel = (t) => t && t.text.length <= 40 && t.text.split(' ').length <= 3;
  const isW = (ch) => /[\p{L}\p{N}]/u.test(ch || '');
  // trecho selecionado, completado até o fim das palavras cortadas pela seleção ("faz a m" → "faz a memória")
  const sel = () => {
    const s = getSelection();
    if (!s || s.isCollapsed || !bodyEl.contains(s.anchorNode) || !bodyEl.contains(s.focusNode)) return null;
    const r = s.getRangeAt(0).cloneRange();
    if (r.startContainer.nodeType === 3) {
      const t = r.startContainer.data;
      let i = r.startOffset;
      while (i > 0 && isW(t[i - 1]) && isW(t[i])) i--;
      r.setStart(r.startContainer, i);
    }
    if (r.endContainer.nodeType === 3) {
      const t = r.endContainer.data;
      let i = r.endOffset;
      while (i < t.length && isW(t[i - 1]) && isW(t[i])) i++;
      r.setEnd(r.endContainer, i);
    }
    const el = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer;
    const block = el?.closest('p, li, blockquote, h1, h2, h3, h4, .pdf-page, figcaption, td') || el;
    return { text: r.toString().replace(/\s+/g, ' ').trim(), page: Number(el?.closest('[data-page]')?.dataset.page) || null, around: block?.textContent || '' };
  };
  // guarda o último trecho selecionado: no toque, a seleção pode sumir antes do clique chegar ao botão
  let last = null;
  const onSel = () => {
    if (!btn.isConnected) { document.removeEventListener('selectionchange', onSel); return; }
    const t = sel();
    if (t && t.text.length >= 2) {
      last = t;
      bar.hidden = false;
      btn.hidden = t.text.length < 3;
      if (defineBtn) defineBtn.hidden = !shortSel(t);
    } else if (!bar.matches(':hover') && !bar.contains(document.activeElement)) bar.hidden = true;
  };
  document.addEventListener('selectionchange', onSel);
  // o mousedown nos botões não desfaz a seleção (cancelar o pointerdown impediria o clique no Chrome)
  bar.addEventListener('mousedown', (e) => e.preventDefault());
  btn.onclick = async () => {
    const t = sel() || last;
    if (!t || t.text.length < 3) return;
    last = null;
    bar.hidden = true;
    getSelection().removeAllRanges();
    await onSave(t.text, t.page);
  };
  if (defineBtn) defineBtn.onclick = async () => {
    const t = sel() || last;
    if (!shortSel(t)) return;
    last = null;
    bar.hidden = true;
    getSelection().removeAllRanges();
    const D = await import('./dict.js');
    wordLookup(t.text, { sourceId, context: D.sentenceAround(t.around, D.cleanWord(t.text)) });
  };
}

// continua de onde parou e marca "Lendo" ao passar do começo
function trackReading(id, bodyEl) {
  const saved = readPos(id);
  if (saved.y > 0 && view.dataset.route !== location.hash) setTimeout(() => scrollTo(0, saved.y), 50);
  let t = 0;
  const onScroll = () => {
    if (!bodyEl.isConnected) { removeEventListener('scroll', onScroll); return; }
    clearTimeout(t);
    t = setTimeout(async () => {
      const r = bodyEl.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (innerHeight - r.top) / r.height));
      try { localStorage.setItem(POS_KEY(id), JSON.stringify({ p, y: scrollY })); } catch { /* sem armazenamento */ }
      const a = state.articles.find((x) => x.id === id);
      if (a && (a.status || 'want') === 'want' && p > 0.15) await persist('books', { ...a, status: 'reading', startDate: G.ymd() });
    }, 400);
  };
  addEventListener('scroll', onScroll, { passive: true });
}

articleView.mount = (id) => {
  const btn = $('#grifar-btn');
  const bodyEl = $('#reader-body');
  if (!btn || !bodyEl) return;
  trackReading(id, bodyEl);
  attachGrifar(bodyEl, btn, async (text) => {
    const note = { id: uid(), createdAt: Date.now(), bookId: id, text, kind: 'quote', source: 'article', tags: [], page: null };
    await commit(() => persist('notes', note));
    toast('🖍️ Trecho grifado · <u>adicionar reflexão</u>', '', () => noteForm(noteById(note.id)));
  }, { sourceId: id });
};
// ---------- PDFs ----------
// O arquivo fica no aparelho (IndexedDB); no Plus também vai para o armazenamento da conta e é baixado em outro aparelho.
const canSyncPdf = () => Cloud.enabled() && Cloud.user() && Cloud.plan() === 'plus';
async function pdfBlob(a) {
  const local = await db.getFile(a.id);
  if (local) return local;
  if (!canSyncPdf() || !a.synced) return null;
  const blob = await Cloud.downloadPdf(a.id);
  await db.setFile(a.id, blob);
  return blob;
}
const pdfNotesHtml = (id) => {
  const notes = state.notes.filter((n) => n.bookId === id).sort((x, y) => (x.page || 0) - (y.page || 0) || x.createdAt - y.createdAt);
  return `<h3>Seus grifos (${notes.length})</h3>${notes.length ? notes.map((n) => noteCard(n, false)).join('') : '<p class="small muted">Selecione um trecho do PDF e toque em <b>Grifar</b>.</p>'}`;
};

function pdfView(id) {
  const a = state.articles.find((x) => x.id === id && x.kind === 'pdf');
  if (!a) return `<a href="#/artigos" class="back">← Artigos</a>${empty('PDF não encontrado.')}`;
  return `<a href="#/artigos" class="back">← Artigos</a>
  <article class="reader pdf-reader">
    <div class="small muted">${esc(['PDF', a.pages ? `${a.pages} páginas` : '', a.author].filter(Boolean).join(' · '))}</div>
    <h1 class="reader-title">${esc(a.title)}</h1>
    <div class="quick">
      <button class="btn small" data-action="articleRead" data-id="${a.id}">${a.status === 'finished' ? '✓ Lido' : '✔ Marcar como lido'}</button>
      <button class="btn small" data-action="newNote" data-id="${a.id}">✍️ Nota</button>
      <button class="btn small" data-action="pdfImport" data-id="${a.id}">📥 Importar grifos do arquivo</button>
      <button class="btn small ghost" data-action="deleteArticle" data-id="${a.id}">🗑️ Excluir</button>
    </div>
    ${articleTags(a)}
    <p class="small muted" id="pdf-status">Abrindo o PDF…</p>
    <div class="pdf-pages" id="reader-body"></div>
  </article>
  <div id="pdf-notes">${pdfNotesHtml(id)}</div>
  <div class="sel-bar" id="sel-bar" hidden><button class="btn primary" id="grifar-btn">🖍️ Grifar trecho</button><button class="btn" id="define-btn" hidden>📖 Significado</button></div>`;
}
pdfView.mount = async (id) => {
  const a = state.articles.find((x) => x.id === id && x.kind === 'pdf');
  const bodyEl = $('#reader-body');
  const status = $('#pdf-status');
  if (!a || !bodyEl) return;
  let blob;
  try { blob = await pdfBlob(a); } catch { blob = null; }
  if (!bodyEl.isConnected) return;
  if (!blob) {
    status.innerHTML = `O arquivo deste PDF está em outro aparelho${canSyncPdf() ? '' : ' (no Plus, seus PDFs sincronizam entre aparelhos)'}. <button class="btn small" id="pdf-reattach">📄 Escolher o arquivo</button>`;
    $('#pdf-reattach').onclick = () => actions.addPdf({ id });
    return;
  }
  const P = await import('./pdf.js');
  let doc;
  try { doc = await P.openPdf(blob); } catch (e) { status.textContent = `Não consegui abrir o PDF: ${e.message}`; return; }
  status.remove();
  // páginas: espaço reservado do tamanho certo e desenho só quando chega perto da tela
  const width = Math.min(bodyEl.clientWidth || 600, 900);
  const first = await doc.getPage(1);
  const v = first.getViewport({ scale: 1 });
  const h = Math.round((width / v.width) * v.height);
  bodyEl.innerHTML = Array.from({ length: doc.numPages }, (_, i) => `<div class="pdf-page" data-page="${i + 1}" style="width:${width}px;height:${h}px"><span class="pdf-pn">${i + 1}</span></div>`).join('');
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting || e.target.dataset.done) continue;
      e.target.dataset.done = '1';
      P.renderPage(doc, Number(e.target.dataset.page), e.target, width).catch(() => { e.target.dataset.done = ''; });
    }
  }, { rootMargin: '900px 0px' });
  bodyEl.querySelectorAll('.pdf-page').forEach((el) => io.observe(el));
  trackReading(id, bodyEl);
  attachGrifar(bodyEl, $('#grifar-btn'), async (text, page) => {
    const note = { id: uid(), createdAt: Date.now(), bookId: id, text, kind: 'quote', source: 'pdf', tags: [], page };
    await commit(() => persist('notes', note), { rerender: false });
    $('#pdf-notes').innerHTML = pdfNotesHtml(id);
    toast(`🖍️ Grifado${page ? ` (p. ${page})` : ''} · <u>adicionar reflexão</u>`, '', () => noteForm(noteById(note.id)));
  }, { sourceId: id });
  // na primeira vez, traz os grifos que já estavam no arquivo
  if (!a.imported) importPdfHighlights(a, doc, P, true);
};

// Grifos feitos em outros apps viram notas (sem repetir os que já existem)
async function importPdfHighlights(a, doc, P, auto = false) {
  try {
    const found = await P.existingHighlights(doc);
    const have = new Set(state.notes.filter((n) => n.bookId === a.id).map((n) => `${n.page}|${norm(plainText(n.text))}`));
    const add = found.filter((x) => !have.has(`${x.page}|${norm(x.text)}`));
    await commit(async () => {
      for (const [i, x] of add.entries()) {
        await persist('notes', { id: uid(), createdAt: Date.now() + i, bookId: a.id, text: x.comment ? `${x.text}\n\n${x.comment}` : x.text, kind: 'quote', source: 'pdf', tags: [], page: x.page });
      }
      await persist('books', { ...state.articles.find((y) => y.id === a.id), imported: true });
    }, { rerender: false });
    if ($('#pdf-notes')) $('#pdf-notes').innerHTML = pdfNotesHtml(a.id);
    if (add.length) toast(`📥 ${add.length} ${add.length === 1 ? 'grifo importado' : 'grifos importados'} do arquivo`);
    else if (!auto) toast(found.length ? 'Os grifos do arquivo já estavam aqui.' : 'Este PDF não tem grifos feitos em outros apps.');
  } catch (e) {
    if (!auto) toast(`Não consegui ler os grifos do arquivo: ${esc(e.message)}`, 'err');
  }
}

const pdfActions = {
  // escolhe um PDF no aparelho (id: trocar o arquivo de um PDF já salvo)
  addPdf({ id } = {}) {
    const input = $('#pdf-file') || Object.assign(document.createElement('input'), { type: 'file', accept: 'application/pdf,.pdf' });
    input.value = '';
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return;
      if (f.size > 50 * 1024 * 1024) { toast('PDF grande demais (máximo 50 MB).', 'err'); return; }
      toast('📄 Abrindo o PDF…');
      try {
        const P = await import('./pdf.js');
        const doc = await P.openPdf(f);
        const meta = await P.info(doc, f.name);
        const old = id && state.articles.find((x) => x.id === id);
        const rec = old ? { ...old, pages: meta.pages } : {
          id: uid(), createdAt: Date.now(), kind: 'pdf', status: 'reading', startDate: G.ymd(), purpose: 'hobby', genre: '', subtheme: '', pages: meta.pages, currentPage: 0, rating: 0, isbn: '',
          title: meta.title || 'PDF sem título', author: meta.author, fileName: f.name, size: f.size,
        };
        await db.setFile(rec.id, f);
        if (canSyncPdf()) {
          // sem esperar mais que 30 s: a conexão lenta não pode impedir de abrir o PDF
          const slow = new Promise((_, rej) => setTimeout(() => rej(new Error('tempo esgotado')), 30_000));
          try { await Promise.race([Cloud.uploadPdf(rec.id, f), slow]); rec.synced = true; } catch { toast('O PDF ficou só neste aparelho (não foi possível enviar para a conta agora).', 'err'); }
        }
        await commit(() => persist('books', rec));
        Cloud.track('pdf_add');
        location.hash = `#/pdf/${rec.id}`;
        if (old) render();
      } catch (e) {
        console.error(e);
        const why = e?.name === 'PasswordException' ? 'o arquivo tem senha' : e?.name === 'InvalidPDFException' ? 'o arquivo não é um PDF válido' : e?.message || String(e);
        toast(`Não consegui abrir esse PDF: ${esc(why)}`, 'err');
      }
    };
    input.click();
  },
  async pdfImport({ id }) {
    const a = state.articles.find((x) => x.id === id);
    const blob = await pdfBlob(a);
    if (!blob) { toast('O arquivo deste PDF não está neste aparelho.', 'err'); return; }
    const P = await import('./pdf.js');
    importPdfHighlights(a, await P.openPdf(blob), P, false);
  },
};

// Sugestão de finalidade, tema e subtema pela IA (Plus), usando os temas que a pessoa já tem
async function suggestCategory(a) {
  const map = new Map();
  for (const b of sources()) {
    if (!b.genre) continue;
    if (!map.has(b.genre)) map.set(b.genre, new Set());
    if (b.subtheme) map.get(b.genre).add(b.subtheme);
  }
  const themes = [...map].map(([theme, subs]) => ({ theme, subthemes: [...subs] }));
  const text = (a.blocks || []).map((b) => b.x).join('\n').slice(0, 5000);
  return aiRun('classify', { title: a.title, site: a.site, text, themes });
}
// Logo depois de salvar: classifica sozinho, se a IA estiver liberada para a pessoa
async function autoClassify(id) {
  if (AI.available(state.settings) !== 'ok') return;
  try {
    const a = state.articles.find((x) => x.id === id);
    const r = await suggestCategory(a);
    const now = state.articles.find((x) => x.id === id);
    if (!now || now.genre) return; // a pessoa já classificou nesse meio tempo
    await commit(() => persist('books', { ...now, purpose: r.purpose, genre: r.theme, subtheme: r.subtheme }), { quiet: true });
    toast(`🏷️ Classificado como ${esc(r.theme)} › ${esc(r.subtheme)} · <u>alterar</u>`, '', () => actions.classifyArticle({ id }));
  } catch { /* sem classificação automática: a pessoa classifica à mão */ }
}

const articleActions = {
  async saveArticle({ url }) {
    if (!/^https?:\/\//i.test(url || '')) { toast('Cole o endereço completo do artigo, começando com https://', 'err'); return; }
    const same = state.articles.find((a) => a.url === url || a.sourceUrl === url);
    if (same) { location.hash = `#/artigo/${same.id}`; return; }
    if (!Cloud.enabled() || !Cloud.user()) { toast('Entre na sua conta para salvar artigos.', 'err'); return; }
    if (!isPlus() && state.articles.length >= FREE_ARTICLES) {
      toast(`⭐ O plano grátis guarda até ${FREE_ARTICLES} artigos · <u>conhecer o Plus</u>`, 'gold', () => { location.hash = '#/plus'; });
      return;
    }
    const btn = $('#art-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Buscando…'; }
    toast('📰 Buscando o artigo…');
    try {
      const r = await Cloud.fetchArticle(url);
      const art = {
        id: uid(), createdAt: Date.now(), kind: 'article', status: 'want', purpose: 'hobby', genre: '', subtheme: '', pages: 0, currentPage: 0, rating: 0, isbn: '',
        title: r.title, author: r.byline, site: r.site, url: r.url, sourceUrl: url, cover: r.image, excerpt: r.excerpt, published: r.published, lang: r.lang, blocks: r.blocks,
      };
      await commit(() => persist('books', art));
      Cloud.track('article_save');
      location.hash = `#/artigo/${art.id}`;
      autoClassify(art.id);
    } catch (e) {
      toast(esc(e.message), 'err');
    } finally {
      if (btn?.isConnected) { btn.disabled = false; btn.textContent = 'Salvar'; }
    }
  },
  classifyArticle({ id }) {
    const a = state.articles.find((x) => x.id === id);
    openModal(`<form class="form" id="artcat-form"><h3>🏷️ Classificar artigo</h3>
      <p class="small muted" style="margin:0">${esc(a.title)}</p>
      <label>Finalidade
        <div class="radio-pills">${Object.entries(PURPOSE).map(([k, p]) => `<input type="radio" name="purpose" id="ap-${k}" value="${k}" ${(a.purpose || 'hobby') === k ? 'checked' : ''}><label for="ap-${k}">${p.icon} ${p.label}</label>`).join('')}</div>
      </label>
      <div class="grid2">
        <label>Tema <input name="genre" list="themes" value="${esc(a.genre || '')}" placeholder="ex: Psicologia" autocomplete="off">${datalist('themes', themeOptions())}</label>
        <label>Subtema <input name="subtheme" list="subthemes" value="${esc(a.subtheme || '')}" placeholder="ex: Memória" autocomplete="off"><span id="art-subthemes">${datalist('subthemes', subthemeOptions(a.genre))}</span></label>
      </div>
      <button type="button" class="btn small" id="artcat-ai">✨ Sugerir com IA${isPlus() ? '' : ' 🔒'}</button>
      <div class="actions"><button type="button" class="btn ghost" data-action="close">Cancelar</button><button class="btn primary">Salvar</button></div>
    </form>`, (root) => {
      const form = $('#artcat-form', root);
      $('#artcat-ai', root).onclick = async (e) => {
        if (!isPlus()) { closeModal(); toast('⭐ A classificação com IA faz parte do Grifo Plus · <u>conhecer</u>', 'gold', () => { location.hash = '#/plus'; }); return; }
        const b = e.currentTarget;
        b.disabled = true;
        b.textContent = '✨ Pensando…';
        try {
          const r = await suggestCategory(a);
          root.querySelector(`#ap-${r.purpose}`).checked = true;
          form.genre.value = r.theme;
          form.subtheme.value = r.subtheme;
        } catch (err) { if (err.message) toast(esc(err.message), 'err'); }
        b.disabled = false;
        b.textContent = '✨ Sugerir com IA';
      };
      form.genre.oninput = () => { $('#art-subthemes', root).innerHTML = datalist('subthemes', subthemeOptions(form.genre.value)); };
      form.onsubmit = async (e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(form));
        closeModal();
        await commit(() => persist('books', { ...a, purpose: fd.purpose || 'hobby', genre: fd.genre.trim(), subtheme: fd.subtheme.trim() }));
      };
    });
  },
  async hideFirstSteps() {
    state.settings = { ...state.settings, firstStepsHidden: true };
    await db.setKV('settings', state.settings);
    render();
  },
  artFilter: ({ v }) => { sessionStorage.setItem('artFilter', v); render(); },
  async articleRead({ id }) {
    const a = state.articles.find((x) => x.id === id);
    await commit(() => persist('books', { ...a, status: a.status === 'finished' ? 'want' : 'finished', endDate: a.status === 'finished' ? '' : G.ymd() }));
  },
  async deleteArticle({ id }) {
    const a = state.articles.find((x) => x.id === id);
    const notes = state.notes.filter((n) => n.bookId === id);
    if (!confirm(`Excluir “${a.title}”${notes.length ? ` e ${notes.length} grifo(s)` : ''}?`)) return;
    await commit(async () => {
      for (const c of state.cards.filter((x) => notes.some((n) => n.id === x.noteId))) await remove('cards', c.id);
      for (const n of notes) await remove('notes', n.id);
      await remove('books', id);
    });
    toast(`🗑️ “${esc(a.title)}” excluído`);
    if (a.kind === 'pdf') {
      await db.delFile(id);
      if (a.synced && canSyncPdf()) Cloud.deletePdf(id).catch(() => {});
    }
    location.hash = '#/artigos';
  },
};

// Link recebido pelo menu "Compartilhar" do celular (manifest share_target): guarda e salva quando der
(function captureShared() {
  const q = new URLSearchParams(location.search);
  const found = [q.get('url'), q.get('text'), q.get('title')].join(' ').match(/https?:\/\/[^\s"<>]+/);
  if (!found) return;
  try { localStorage.setItem(SHARED_KEY, found[0]); } catch { /* sem armazenamento */ }
  for (const k of ['url', 'text', 'title']) q.delete(k);
  history.replaceState(null, '', location.pathname + (q.toString() ? `?${q}` : '') + '#/artigos');
})();
function saveSharedArticle() {
  let url = null;
  try { url = localStorage.getItem(SHARED_KEY); } catch { /* sem armazenamento */ }
  if (!url || !Cloud.user()) return;
  try { localStorage.removeItem(SHARED_KEY); } catch { /* sem armazenamento */ }
  setTimeout(() => actions.saveArticle({ url }), 0);
}

// ---------- plano de prova (Plus) ----------
// Descrição curta de um filtro ("Psicologia · Daniel Kahneman")
function scopeLabel(f) {
  const parts = [];
  if (f.purpose) parts.push(PURPOSE[f.purpose]?.label);
  for (const k of ['theme', 'author', 'book']) if (f[k]) parts.push(scopeOptions('__none', k).find(([v]) => v === f[k])?.[1]);
  return parts.filter(Boolean).join(' · ') || 'todos os cards';
}
function examSection() {
  const ex = state.settings.exam;
  if (!ex) {
    if (!state.cards.length) return '';
    return `<section class="card exam-card"><div class="row gap"><span class="big-emoji">🎯</span><div class="grow"><b>Plano para prova</b>${isPlus() ? '' : ' <span class="chip">⭐ Plus</span>'}
      <div class="small muted">Tem prova marcada? Escolha o assunto e a data: o Grifo distribui a revisão até lá e faz uma revisão final na véspera.</div></div></div>
      <button class="btn small" data-action="newExam" style="margin-top:10px">Criar plano</button></section>`;
  }
  const p = S.examPlan(reviewCards(ex.scope), ex.date, G.ymd());
  if (p.daysLeft <= 0) {
    return `<section class="card exam-card"><b>🎯 ${esc(ex.name)}</b><p class="small muted" style="margin:6px 0 10px">A data da prova passou. Boa sorte, ou melhor: parabéns pelo estudo!</p>
      <button class="btn small" data-action="endExam">Encerrar plano</button></section>`;
  }
  const pct = p.total ? Math.round((p.learned / p.total) * 100) : 0;
  return `<section class="card exam-card">
    <div class="row between"><b>🎯 ${esc(ex.name)}</b><span class="chip">${p.daysLeft === 1 ? 'amanhã' : `faltam ${p.daysLeft} dias`}</span></div>
    <div class="small muted" style="margin:4px 0 10px">${fmtDate(ex.date)} · ${esc(scopeLabel(ex.scope))}</div>
    <div class="bar"><div style="width:${pct}%"></div></div>
    <div class="small" style="margin:6px 0 10px">${p.learned} de ${p.total} cards já estudados (${pct}%)</div>
    <div class="row gap-s wrap">${p.goal ? `<button class="btn primary" data-action="startExam">Estudar para a prova (${p.goal} hoje)</button>` : '<span class="small muted">Meta de hoje cumprida. Amanhã tem mais.</span>'}
      <button class="btn ghost small" data-action="newExam">Editar</button><button class="btn ghost small" data-action="endExam">Encerrar</button></div>
  </section>`;
}
const examActions = {
  newExam() {
    if (!isPlus()) { toast('⭐ O plano para prova faz parte do Grifo Plus · <u>conhecer</u>', 'gold', () => { location.hash = '#/plus'; }); return; }
    const ex = state.settings.exam || { name: '', date: G.addDays(G.ymd(), 30), scope: getScope('reviewScope') };
    const scope = state.settings.exam ? ex.scope : getScope('reviewScope');
    openModal(`<form class="form" id="exam-form"><h3>🎯 Plano para prova</h3>
      <label>Nome da prova <input name="name" required maxlength="60" value="${esc(ex.name)}" placeholder="ex: Concurso TRT, Prova de Direito Civil"></label>
      <label>Data <input name="date" type="date" required min="${G.addDays(G.ymd(), 1)}" value="${ex.date}"></label>
      <p class="small">Cards incluídos: <b>${esc(scopeLabel(scope))}</b> (${reviewCards(scope).length} cards).</p>
      <p class="hint">Para mudar o assunto, feche, escolha tema, autor ou livro nos filtros da revisão e crie o plano de novo.</p>
      <div class="actions"><button type="button" class="btn ghost" data-action="close">Cancelar</button><button class="btn primary">Salvar plano</button></div>
    </form>`, (root) => {
      $('#exam-form', root).onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        state.settings = { ...state.settings, exam: { name: fd.get('name').trim(), date: fd.get('date'), scope } };
        await db.setKV('settings', state.settings);
        closeModal();
        render();
      };
    });
  },
  async endExam() {
    if (!confirm('Encerrar o plano para prova? Seus cards continuam como estão.')) return;
    const { exam, ...rest } = state.settings;
    state.settings = rest;
    await db.setKV('settings', state.settings);
    render();
  },
  startExam() {
    const ex = state.settings.exam;
    review = { queue: S.examPlan(reviewCards(ex.scope), ex.date, G.ymd()).queue, revealed: false, done: 0, exam: ex.date };
    render();
  },
};

async function gradeCard(g) {
  if (!review?.queue.length || !review.revealed) return; // toque duplo não avalia o próximo card sem ver
  const c = state.cards.find((x) => x.id === review.queue[0]);
  if (!c) { review.queue.shift(); render(); return; }
  let next = S.schedule(c, g, G.ymd());
  if (review.exam) next = S.capForExam(next, review.exam, G.ymd());
  review.queue.shift();
  if (g === 0) review.queue.push(c.id); // errou: volta no fim desta sessão
  review.done++;
  review.revealed = false;
  // o "Mostrar resposta" do próximo card nasce onde estavam os botões: um toque rápido/duplo não pode revelá-lo
  review.revealAfter = Date.now() + 350;
  // o próximo card aparece na hora, do começo; a gravação vem depois (sem redesenhar de novo)
  const i = state.cards.findIndex((x) => x.id === c.id);
  if (i >= 0) state.cards[i] = next;
  render();
  view.querySelector('.review-card, h2')?.scrollIntoView({ block: 'nearest' });
  try {
    await commit(async () => {
      await persist('cards', next);
      await persist('reviews', { id: uid(), cardId: c.id, date: G.ymd(), grade: g, createdAt: Date.now() });
    }, { quiet: true, rerender: false });
  } catch (e) {
    console.error(e);
    toast(`Não foi possível salvar esta revisão: ${esc(e.message || String(e))}`, 'err');
  }
}

// ---------- progresso ----------
function statsView() {
  const s = state.stats;
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    let v = 0;
    for (const [k, p] of s.pagesByDay) if (k.startsWith(key)) v += p;
    months.push({ label: MONTHS[d.getMonth()], value: v, highlight: i === 0 });
  }
  const booksByMonth = MONTHS.map((m, i) => ({
    label: m,
    value: s.finishedBooks.filter((b) => b.endDate && b.endDate.startsWith(`${s.year}-${String(i + 1).padStart(2, '0')}`)).length,
    highlight: i === now.getMonth(),
  }));
  const top = (map, n) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n).map(([label, value]) => ({ label, value }));

  const timed = s.finishedBooks.filter((b) => b.startDate && b.endDate);
  const durations = timed.map((b) => ({ b, days: Math.max(1, G.daysBetween(b.startDate, b.endDate) + 1) }));
  const avgDays = durations.length ? durations.reduce((a, x) => a + x.days, 0) / durations.length : 0;
  const fastest = durations.sort((a, b) => a.days - b.days)[0];
  const biggest = [...s.finishedBooks].sort((a, b) => (b.pages || 0) - (a.pages || 0))[0];
  const avgRating = s.rated.length ? s.rated.reduce((a, b) => a + b.rating, 0) / s.rated.length : 0;
  const mins = state.sessions.filter((x) => x.minutes > 0);
  const speed = mins.length ? (mins.reduce((a, x) => a + x.pages, 0) / mins.reduce((a, x) => a + x.minutes, 0)) * 60 : 0;

  const dayOfYear = G.daysBetween(`${s.year}-01-01`, s.today) + 1;
  const projected = Math.round((s.finishedThisYear / dayOfYear) * 365);
  const ratingDist = [5, 4, 3, 2, 1].map((r) => ({ label: '★'.repeat(r), value: s.rated.filter((b) => b.rating === r).length }));
  const purposes = Object.entries(PURPOSE).map(([k, p]) => ({ label: `${p.icon} ${p.label}`, value: s.purposes.get(k) || 0 })).filter((x) => x.value);

  return `${seg([['#/stats', '📊 Análises', 'stats'], ['#/conquistas', '🏆 Conquistas', 'ach'], ['#/clubes', '👥 Clubes', 'clubs']], 'stats')}
  <button class="card wrapped-cta" data-action="shareWrapped"><span class="big-emoji">✨</span>
    <span class="grow"><b>Retrospectiva</b><span class="small muted">Seu mês ou ano em slides para o Stories</span></span><span class="btn small primary">Gerar</span></button>
  <section class="grid3">
    <div class="card stat"><b>${s.finished}</b><span>livros lidos</span></div>
    <div class="card stat"><b>${nf(s.totalPages)}</b><span>páginas lidas</span></div>
    <div class="card stat"><b>${nf(s.avg30)}</b><span>pág./dia (30d)</span></div>
    <div class="card stat"><b>${s.longest}</b><span>maior sequência</span></div>
    <div class="card stat"><b>${avgDays ? nf(avgDays) : '—'}</b><span>dias por livro</span></div>
    <div class="card stat"><b>${speed ? nf(speed) : '—'}</b><span>pág./hora</span></div>
    <div class="card stat"><b>${s.notes}</b><span>notas (${s.linkedNotes} conectadas)</span></div>
    <div class="card stat"><b>${s.cards}</b><span>cards</span></div>
    <div class="card stat"><b>${s.reviews ? `${Math.round(s.retention * 100)}%` : '—'}</b><span>acertos na revisão</span></div>
  </section>
  ${s.finishedThisYear ? `<p class="nudge">Nesse ritmo você fecha ${s.year} com <b>${projected} livros</b>${projected >= state.settings.yearGoal ? ' — acima da sua meta! 🚀' : ` (meta: ${state.settings.yearGoal}). Bora acelerar!`}</p>` : ''}
  <section class="card"><h3>Dias de leitura</h3>${C.heatmap(s.sessDays)}</section>
  <section class="card"><h3>Páginas por mês</h3>${C.bars(months, { unit: ' pág.' })}</section>
  <section class="card"><h3>Livros concluídos em ${s.year}</h3>${C.bars(booksByMonth)}</section>
  <section class="grid2 stretch">
    <div class="card"><h3>Finalidade</h3>${C.hbars(purposes)}</div>
    <div class="card"><h3>Temas</h3>${C.hbars(top(s.genres, 6))}</div>
  </section>
  <section class="grid2 stretch">
    <div class="card"><h3>Subtemas</h3>${C.hbars(top(s.subthemes, 6))}</div>
    <div class="card"><h3>Autores mais lidos</h3>${C.hbars(top(s.authors, 6))}</div>
  </section>
  <section class="card"><h3>Avaliações ${avgRating ? `· média ${nf(avgRating)} ★` : ''}</h3>${C.hbars(s.rated.length ? ratingDist : [])}</section>
  <section class="card"><h3>Recordes</h3><div class="list">
    <div class="row between li"><span>🏃 Melhor dia</span><b>${s.maxDay ? `${s.maxDay} pág. em ${fmtDate(s.maxDayDate)}` : '—'}</b></div>
    <div class="row between li"><span>🧱 Maior livro</span><b>${biggest ? `${esc(biggest.title)} (${biggest.pages} pág.)` : '—'}</b></div>
    <div class="row between li"><span>⚡ Leitura mais rápida</span><b>${fastest ? `${esc(fastest.b.title)} (${fastest.days} ${fastest.days === 1 ? 'dia' : 'dias'})` : '—'}</b></div>
    <div class="row between li"><span>✍️ Notas via OCR</span><b>${s.ocrNotes}</b></div>
  </div></section>`;
}

function badgeTile(b) {
  const got = state.badges[b.id];
  return `<div class="badge ${got ? 'got' : ''}" title="${esc(b.desc)}${got ? ' · toque para compartilhar' : ''}" ${got ? `data-action="shareBadge" data-id="${b.id}" role="button" tabindex="0"` : ''}>
    <span class="badge-icon">${b.icon}</span><b>${esc(b.name)}</b><small>${got ? `desde ${fmtDate(got)}` : esc(b.desc)}</small></div>`;
}

function achievementsView() {
  const s = state.stats;
  const got = G.BADGES.filter((b) => state.badges[b.id]).length;
  const ch = G.weeklyChallenge(s);
  const cur = G.levelInfo(s.xp).level;
  const levels = G.LEVELS.map((t, i) => {
    const l = i + 1;
    return `<div class="row between li ${l === cur ? 'current' : ''} ${l > cur ? 'muted' : ''}"><span>${l <= cur ? '✅' : '🔒'} Nível ${l} · ${t}</span><span class="small">${nf(G.xpForLevel(l))} XP</span></div>`;
  }).join('');
  return `${seg([['#/stats', '📊 Análises', 'stats'], ['#/conquistas', '🏆 Conquistas', 'ach'], ['#/clubes', '👥 Clubes', 'clubs']], 'ach')}
  ${levelCard()}
  <section class="card"><h3>De onde vem seu XP</h3><div class="list">
    <div class="row between li"><span>📄 Páginas lidas (${G.XP.page} XP cada)</span><b>${nf(s.xpBreakdown.pages)}</b></div>
    <div class="row between li"><span>📘 Livros concluídos (${G.XP.book} XP)</span><b>${nf(s.xpBreakdown.books)}</b></div>
    <div class="row between li"><span>✍️ Notas (${G.XP.note} XP, +${G.XP.ocr} OCR, +${G.XP.link} com [[ ]])</span><b>${nf(s.xpBreakdown.notes)}</b></div>
    <div class="row between li"><span>🧠 Cards (${G.XP.card} XP) e revisões (${G.XP.review} XP)</span><b>${nf(s.xpBreakdown.memory)}</b></div>
    <div class="row between li"><span>🎯 Desafios semanais (${G.XP.challenge} XP)</span><b>${nf(s.xpBreakdown.challenges)}</b></div>
  </div></section>
  <section class="card challenge ${ch.done ? 'done' : ''}"><div class="small muted">Desafio desta semana</div><b>${ch.text}</b> — ${ch.value}/${ch.target}
    <div class="bar"><div style="width:${(ch.value / ch.target) * 100}%"></div></div>
    <div class="small muted">${state.challenges.length} desafio(s) concluído(s) até hoje</div></section>
  <h2>Medalhas · ${got}/${G.BADGES.length}</h2>
  <div class="badges">${G.BADGES.map(badgeTile).join('')}</div>
  <h2>Níveis</h2><section class="card list">${levels}</section>`;
}

function settingsView() {
  const st = state.settings;
  const theme = currentTheme();
  const u = Cloud.user();
  return `<a href="#/" class="back">← Início</a><h2>Ajustes</h2>
  <a class="card account-head" href="#/conta">
    ${u && Cloud.currentProfile()?.avatar_url ? `<img src="${esc(Cloud.currentProfile().avatar_url)}" alt="" class="avatar" referrerpolicy="no-referrer">` : '<span class="avatar ph">👤</span>'}
    <span class="grow"><b>${u ? esc(Cloud.currentProfile()?.display_name || u.email) : Cloud.enabled() ? 'Entrar com Google' : 'Modo pessoal'}</b>
    <span class="small muted" style="display:block">${u ? `☁️ Sincronizado ${ago(Cloud.syncStatus().lastSyncAt)}` : Cloud.enabled() ? 'Salve na nuvem e use em vários aparelhos' : 'Dados só neste aparelho · todos os recursos liberados'}</span></span>
    <span class="muted">›</span></a>
  <section class="card form"><h3>🌐 Idioma · Language</h3>
    <div class="radio-pills">${[['pt', '🇧🇷 Português'], ['en', '🇺🇸 English']].map(([k, l]) => `<input type="radio" name="lang" id="lg-${k}" value="${k}" ${lang === k ? 'checked' : ''} data-lang-pick><label for="lg-${k}" data-no-tr>${l}</label>`).join('')}</div>
  </section>
  <section class="card form"><h3>Aparência</h3>
    <div class="radio-pills">${Object.entries(THEME_LABEL).map(([k, v]) => `<input type="radio" name="theme" id="th-${k}" value="${k}" ${theme === k ? 'checked' : ''} data-theme-pick><label for="th-${k}">${THEME_ICON[k]} ${v.split(' (')[0]}</label>`).join('')}</div>
    <p class="hint">O botão ${THEME_ICON[theme]} no topo alterna entre automático, claro e escuro.</p>
  </section>
  <form class="card form" id="settings-form">
    <h3>Perfil e metas</h3>
    <label>Seu nome <input name="name" value="${esc(st.name)}" placeholder="Como quer ser chamado?"></label>
    <div class="grid2">
      <label>Meta anual (livros) <input name="yearGoal" type="number" min="1" value="${st.yearGoal}"></label>
      <label>Meta diária (páginas) <input name="dailyGoal" type="number" min="1" value="${st.dailyGoal}"></label>
    </div>
    <label>Cards por revisão <input name="dailyCards" type="number" min="5" value="${st.dailyCards}"></label>
    <label>Assinatura nas artes (opcional) <input name="handle" value="${esc(st.handle)}" placeholder="ex: @seuperfil">
      <span class="hint">Aparece no rodapé das imagens para o Instagram, ao lado de “Grifo”.</span></label>
    <label>Chave da API do Google Livros (opcional)
      <input name="googleKey" value="${esc(st.googleKey)}" placeholder="AIza…" autocomplete="off" spellcheck="false">
      <span class="hint">Sem chave, a busca usa um limite gratuito dividido com todo mundo e às vezes falha. A chave é grátis: Google Cloud Console → ative a “Books API” → Credenciais → Criar chave de API. Ela fica salva só neste aparelho.</span>
    </label>
    ${Cloud.enabled() ? '' : `<label>Chave da API da Anthropic (IA, opcional)
      <input name="aiKey" type="password" value="${esc(st.aiKey)}" placeholder="sk-ant-…" autocomplete="off" spellcheck="false">
      <span class="hint">No modo pessoal, a IA usa a sua própria chave (console.anthropic.com → API Keys); você paga direto pelo uso. Ela fica salva só neste aparelho. Com o servidor configurado, a IA vem pelo plano Plus e não precisa de chave.</span>
    </label>`}
    <button class="btn primary">Salvar</button>
  </form>
  <section class="card form"><h3>⏰ Lembretes</h3>
    <label class="check"><input type="checkbox" id="rem-on" ${st.reminder?.enabled ? 'checked' : ''}> Me lembrar de ler e de revisar os cards</label>
    <label>Horário <input type="time" id="rem-time" value="${esc(st.reminder?.time || '20:00')}" style="max-width:140px"></label>
    <p class="hint" id="rem-status">${reminderSupport()}</p>
    <div class="quick" style="margin:0"><button type="button" class="btn" data-action="testReminder">🔔 Testar</button>
      <button type="button" class="btn" data-action="calendarReminder">📅 Adicionar ao calendário</button></div>
  </section>
  <section class="card"><h3>Backup</h3>
    <p class="small muted">${Cloud.user() ? 'Seus dados estão na nuvem e neste aparelho. O backup em arquivo é uma cópia extra.' : 'Seus dados ficam só neste aparelho. Exporte um backup de vez em quando ou entre na sua conta para salvar na nuvem.'}</p>
    <div class="quick"><button class="btn" data-action="importFile">📱 Kindle, Goodreads, Skoob</button><button class="btn" data-action="export">⬇️ Exportar</button>
      <button class="btn" data-action="import">⬆️ Importar</button>
      <input type="file" id="import-file" accept="application/json,.json" hidden></div>
  </section>
  <section class="card"><h3>📤 Levar para outros apps${isPlus() ? '' : ' <span class="chip">⭐ Plus</span>'}</h3>
    <p class="small muted">Suas notas viram arquivos Markdown com as [[ligações]] (Obsidian e Notion) e seus cards viram um baralho do Anki.</p>
    <div class="quick" style="margin:0"><button class="btn" data-action="exportMarkdown">🧩 Obsidian / Notion (.zip)</button><button class="btn" data-action="exportAnki">🧠 Anki (.txt)</button></div>
    <p class="hint">No Obsidian: descompacte o .zip numa pasta e abra como cofre. No Notion: Importar → Texto e Markdown. No Anki: Arquivo → Importar (tipo, baralho e lacunas já vêm prontos).</p>
  </section>
  <section class="card"><h3>Dicas</h3><ul class="small">
    <li><b>Mapa mental:</b> escreva <b>[[Nome]]</b> numa nota para ligá-la a um livro, outra nota (pelo título) ou conceito. Temas e subtemas dos livros também viram pontos do mapa.</li>
    <li><b>Cards:</b> no botão 🧠 de uma nota, crie pergunta e resposta ou selecione palavras para virar lacuna.</li>
    <li><b>OCR:</b> fotografe a página de frente, com boa luz. Marca-texto amarelo, verde, rosa, azul ou laranja são detectados.</li>
  </ul></section>
  <section class="card"><h3>💬 Fale com a gente</h3>
    <p class="small muted">Encontrou um problema ou tem uma ideia? Sua mensagem chega direto para quem faz o Grifo.</p>
    <div class="quick" style="margin:0"><button class="btn" data-action="feedback">✉️ Enviar sugestão</button>
      <a class="btn ghost" href="#/privacidade">Privacidade</a><a class="btn ghost" href="#/termos">Termos</a></div>
    <p class="hint">Versão ${APP_VERSION}</p>
  </section>
  <button class="btn danger ghost block" data-action="wipe">Apagar todos os dados</button>`;
}

// ---------------- conta, sincronização e plano ----------------
let syncTimer = null;
function scheduleSync(delay = 3000) {
  if (!Cloud.user()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(runSync, delay);
}
async function runSync({ silent = true } = {}) {
  if (!Cloud.user()) return;
  try {
    const applied = await Cloud.sync();
    if (applied) { await load(); render(); tellOtherTabs(); }
    await Cloud.publishStats(publicStats());
    if (!silent) toast('☁️ Sincronizado');
  } catch (e) {
    if (!silent) toast(`Não foi possível sincronizar: ${esc(e.message)}`, 'err');
  }
  if (location.hash === '#/conta') render();
}

// O que aparece no perfil público e no ranking dos clubes (nada de notas ou dados pessoais)
function publicStats() {
  const s = state.stats, lv = G.levelInfo(s.xp);
  const month = s.today.slice(0, 7);
  let monthPages = 0;
  for (const [k, v] of s.sessDays) if (k.startsWith(month)) monthPages += v;
  const themes = [...s.genres].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
  const recent = [...s.finishedBooks].sort((a, b) => (b.endDate || '').localeCompare(a.endDate || '')).slice(0, 8)
    .map((b) => ({ title: b.title, author: b.author || '', rating: b.rating || 0 }));
  return {
    level: lv.level, title: lv.title, xp: s.xp, books: s.finished, booksYear: s.finishedThisYear, pages: s.totalPages,
    streak: s.streak, longest: s.longest, weekStart: s.week.start, weekPages: s.week.pages, month, monthPages,
    notes: s.notes, themes, recent, reading: state.books.filter((b) => b.status === 'reading').slice(0, 3).map((b) => ({ title: b.title, author: b.author || '' })),
  };
}

const isPlus = () => Cloud.plan() !== 'free'; // modo pessoal libera tudo
const profileLink = (handle) => `${location.origin}${location.pathname}#/u/${handle}`;
function ago(ts) {
  if (!ts) return 'nunca';
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 1 ? 'agora há pouco' : m < 60 ? `há ${m} min` : `há ${Math.round(m / 60)} h`;
}

function accountView() {
  if (!Cloud.enabled()) {
    return `<a href="#/ajustes" class="back">← Ajustes</a><h2>Conta</h2>
    <section class="card"><h3>📱 Modo pessoal</h3>
      <p class="small">O Grifo está guardando tudo só neste aparelho e todos os recursos estão liberados.</p>
      <p class="small muted">Para entrar com Google, sincronizar entre celular e computador, participar de clubes e ter perfil público, conecte o app ao servidor (Supabase). O passo a passo está em <b>supabase/LEIA-ME.md</b>.</p>
    </section>`;
  }
  const u = Cloud.user();
  if (!u) {
    return `<a href="#/" class="back">← Conhecer o Grifo</a>
    ${Cloud.pendingInvite() ? '<p class="lp-invite">🎈 Convite aceito: ao criar sua conta, você ganha <b>1 mês de Grifo Plus</b>.</p>' : ''}
    <section class="login">
      <img src="icons/icon.svg" alt="" width="84" height="84" class="login-logo">
      <h2>Grifo</h2>
      <p class="login-tag">leituras que ficam</p>
      <ul class="login-points">
        <li>📷 Fotografe a página e guarde só o que você grifou</li>
        <li>🕸️ Conecte ideias de livros diferentes num mapa mental</li>
        <li>🧠 Revise com cards e não esqueça o que leu</li>
      </ul>
      <button class="btn google-btn block" data-action="loginGoogle"><svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg> Continuar com Google</button>
      <div class="divider"><span>ou</span></div>
      <form class="form" id="email-form">
        <label>E-mail <input type="email" name="email" required placeholder="voce@gmail.com" autocomplete="email"></label>
        ${CONFIG.turnstileSiteKey ? '<div id="captcha" class="captcha"></div>' : ''}
        <div id="code-row" hidden><label>Código recebido por e-mail <input name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" maxlength="10"></label></div>
        <button class="btn block" id="email-btn" style="margin-top:0">Receber código por e-mail</button>
      </form>
      <p class="hint">É grátis. Seus livros e notas ficam na sua conta, em qualquer aparelho.</p>
      <p class="hint">Ao entrar, você concorda com os <a href="#/termos">Termos de uso</a> e a <a href="#/privacidade">Política de privacidade</a>.</p>
    </section>`;
  }
  const p = Cloud.currentProfile() || {};
  const st = Cloud.syncStatus();
  const plan = Cloud.plan();
  return `<a href="#/ajustes" class="back">← Ajustes</a>
  <section class="card account-head">
    ${p.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="" class="avatar" referrerpolicy="no-referrer">` : '<span class="avatar ph">👤</span>'}
    <div class="grow"><b>${esc(p.display_name || u.email)}</b><div class="small muted">${esc(u.email || '')}</div>
      <span class="chip ${plan === 'plus' ? 'p-academic' : ''}">${plan === 'plus' ? '⭐ Grifo Plus' : 'Plano grátis'}</span></div>
  </section>
  <section class="card"><h3>☁️ Sincronização</h3>
    <p class="small">${st.syncing ? 'Sincronizando…' : `Última sincronização: ${ago(st.lastSyncAt)}`}${st.lastError ? `<br><span style="color:var(--danger)">Erro: ${esc(st.lastError)}</span>` : ''}</p>
    <p class="hint">Sincroniza sozinho ao abrir o app e a cada alteração.</p>
    <button class="btn" data-action="syncNow">🔄 Sincronizar agora</button>
  </section>
  <form class="card form" id="public-form"><h3>🌐 Perfil público</h3>
    <label>Nome de usuário <input name="handle" value="${esc(p.handle || '')}" placeholder="ex: rafael.le" pattern="[a-z0-9_.]{3,30}" title="3 a 30 letras minúsculas, números, ponto ou _"></label>
    <label class="check"><input type="checkbox" name="is_public" ${p.is_public ? 'checked' : ''}> Mostrar meu perfil para qualquer pessoa com o link</label>
    <p class="hint">O perfil mostra nível, metas, livros lidos e temas preferidos. Notas e grifos nunca são publicados.</p>
    <div class="row gap-s wrap"><button class="btn primary">Salvar perfil</button>
      ${p.handle ? `<a class="btn" href="#/u/${esc(p.handle)}">Ver perfil</a><button type="button" class="btn" data-action="copyProfile">🔗 Copiar link</button>` : ''}</div>
  </form>
  <section class="card" id="invite-card"><h3>🎁 Convide amigos</h3><p class="small muted" style="margin:0">Carregando seu convite…</p></section>
  <div id="admin-link"></div>
  ${plan !== 'plus' ? '<a class="card wrapped-cta" href="#/plus"><span class="big-emoji">⭐</span><span class="grow"><b>Conheça o Grifo Plus</b><span class="small muted">IA na sua biblioteca, estilos extras e artes sem marca</span></span></a>' : ''}
  <section class="card form"><h3>✉️ Resumo semanal</h3>
    <label class="check"><input type="checkbox" data-weekly ${p.weekly_email ? 'checked' : ''}> Receber todo domingo um e-mail com minhas páginas, sequência e um grifo da semana</label>
  </section>
  <section class="card"><h3>🔒 Seus dados</h3>
    <p class="small muted">Você pode baixar uma cópia de tudo ou apagar sua conta. Ao excluir, livros, notas, cards, perfil e participação em clubes são apagados para sempre (clubes que você criou também).</p>
    <div class="quick" style="margin:0"><button class="btn" data-action="export">⬇️ Baixar meus dados</button>
      <a class="btn ghost" href="#/privacidade">Política de privacidade</a></div>
  </section>
  <button class="btn ghost block" data-action="logout">Sair da conta</button>
  <button class="btn danger ghost block" data-action="deleteAccount" style="margin-top:8px">Excluir minha conta</button>`;
}
accountView.mount = () => {
  if (Cloud.user()) mountInvite();
  const ef = $('#email-form');
  if (ef) {
    let sent = false;
    const captcha = CONFIG.turnstileSiteKey ? mountCaptcha($('#captcha')) : null;
    ef.onsubmit = async (e) => {
      e.preventDefault();
      const btn = $('#email-btn');
      btn.disabled = true;
      try {
        if (!sent) {
          const token = captcha ? await captcha.token() : undefined;
          if (captcha && !token) throw new Error('Confirme que você não é um robô.');
          await Cloud.sendEmailCode(ef.email.value.trim(), token);
          captcha?.reset();
          sent = true;
          $('#code-row').hidden = false;
          ef.code.focus();
          btn.textContent = 'Entrar';
          toast('📧 Enviamos um código para o seu e-mail.');
        } else {
          await Cloud.verifyEmailCode(ef.email.value.trim(), ef.code.value.trim());
          toast('Bem-vindo! ☁️');
        }
      } catch (err) {
        toast(esc(err.message), 'err');
      }
      btn.disabled = false;
    };
  }
  const pf = $('#public-form');
  if (pf) {
    pf.onsubmit = async (e) => {
      e.preventDefault();
      const handle = pf.handle.value.trim().toLowerCase();
      try {
        await Cloud.updateProfile({ handle: handle || null, is_public: pf.is_public.checked, stats: publicStats() });
        toast('Perfil salvo ✔');
      } catch (err) {
        toast(err.message.includes('duplicate') ? 'Esse nome de usuário já existe.' : esc(err.message), 'err');
      }
    };
  }
};

// CAPTCHA (Cloudflare Turnstile) para o cadastro por e-mail: barra criação de contas por robôs
let turnstileScript = null;
function mountCaptcha(el) {
  let widgetId = null, token = null, waiting = [];
  turnstileScript ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.onload = resolve;
    s.onerror = reject;
    document.head.append(s);
  });
  turnstileScript.then(() => {
    if (!el.isConnected) return;
    widgetId = window.turnstile.render(el, {
      sitekey: CONFIG.turnstileSiteKey,
      language: 'pt-br',
      theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'auto',
      callback: (t) => { token = t; waiting.forEach((r) => r(t)); waiting = []; },
      'expired-callback': () => { token = null; },
    });
  }).catch(() => { el.textContent = 'Não foi possível carregar a verificação. Use “Continuar com Google”.'; });
  return {
    token: () => (token ? Promise.resolve(token) : new Promise((r) => { waiting.push(r); setTimeout(() => r(null), 15000); })),
    reset: () => { token = null; if (widgetId !== null) window.turnstile.reset(widgetId); },
  };
}

// ---------- perfil público ----------
function publicProfileView(handle) {
  return `<section id="pub" class="pub"><p class="muted center">Carregando perfil…</p></section>`;
}
publicProfileView.mount = async (handle) => {
  const box = $('#pub');
  if (!Cloud.enabled()) { box.innerHTML = empty('Perfis públicos precisam do servidor configurado.'); return; }
  const p = await Cloud.publicProfile(decodeURIComponent(handle || '')).catch(() => null);
  if (!p) { box.innerHTML = empty('Perfil não encontrado ou privado.'); return; }
  const s = p.stats || {};
  box.innerHTML = `<section class="card hero center">
      ${p.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="" class="avatar lg" referrerpolicy="no-referrer">` : '<span class="avatar lg ph">📚</span>'}
      <h2 style="margin:6px 0 0">${esc(p.display_name || p.handle)}</h2><div class="small muted">@${esc(p.handle)}</div>
      ${s.level ? `<div class="lv">Nível ${s.level} · ${esc(s.title || '')}</div>` : ''}
    </section>
    <section class="grid3">
      <div class="card stat"><b>${s.booksYear ?? 0}</b><span>livros este ano</span></div>
      <div class="card stat"><b>${nf(s.pages)}</b><span>páginas lidas</span></div>
      <div class="card stat"><b>🔥 ${s.streak ?? 0}</b><span>dias seguidos</span></div>
    </section>
    ${(s.themes || []).length ? `<h3>Temas preferidos</h3><div class="chips">${s.themes.map((t) => `<span class="chip tag">${esc(t)}</span>`).join('')}</div>` : ''}
    ${(s.reading || []).length ? `<h3>Lendo agora</h3><div class="card list">${s.reading.map((b) => `<div class="li"><b>${esc(b.title)}</b> <span class="muted small">${esc(b.author)}</span></div>`).join('')}</div>` : ''}
    ${(s.recent || []).length ? `<h3>Lidos recentemente</h3><div class="card list">${s.recent.map((b) => `<div class="row between li"><span><b>${esc(b.title)}</b> <span class="muted small">${esc(b.author)}</span></span>${stars(b.rating)}</div>`).join('')}</div>` : ''}
    <p class="center small muted">Organize suas leituras também: <a href="#/">conheça o Grifo</a></p>`;
};

// ---------- clubes de leitura ----------
function clubsView() {
  const head = seg([['#/stats', '📊 Análises', 'stats'], ['#/conquistas', '🏆 Conquistas', 'ach'], ['#/clubes', '👥 Clubes', 'clubs']], 'clubs');
  if (!Cloud.enabled()) return `${head}${empty('Clubes de leitura precisam do servidor configurado (veja supabase/LEIA-ME.md).')}`;
  if (!Cloud.user()) return `${head}${empty('Entre na sua conta para criar ou participar de clubes de leitura com amigos.', '<a class="btn primary" href="#/conta">Entrar com Google</a>')}`;
  return `${head}
  <div class="quick"><button class="btn primary" data-action="newClub">➕ Criar clube</button><button class="btn" data-action="joinClubPrompt">🔑 Entrar com código</button></div>
  <div id="clubs-list"><p class="muted small">Carregando clubes…</p></div>`;
}
const clubPostCache = new Map();
clubsView.mount = async () => {
  const box = $('#clubs-list');
  if (!box) return;
  try {
    await Cloud.publishStats(publicStats());
    const clubs = await Cloud.myClubs();
    if (!clubs.length) { box.innerHTML = empty('Você ainda não participa de nenhum clube. Crie um e convide amigos com o código!'); return; }
    const month = state.stats.today.slice(0, 7), week = state.stats.week.start;
    const parts = await Promise.all(clubs.map(async (c) => {
      const [members, posts] = await Promise.all([Cloud.clubMembers(c.id), Cloud.clubPosts(c.id, 6).catch(() => [])]);
      const nameOf = (uid) => { const m = members.find((x) => x.user_id === uid); return m?.display_name || m?.handle || 'Leitor'; };
      clubPostCache.set(c.id, posts);
      const rows = members.map((m) => ({
        ...m,
        week: m.stats?.weekStart === week ? m.stats.weekPages || 0 : 0,
        month: m.stats?.month === month ? m.stats.monthPages || 0 : 0,
      })).sort((a, b) => b.week - a.week);
      const total = rows.reduce((a, r) => a + r.month, 0);
      const me = Cloud.user().id;
      return `<section class="card club">
        <div class="row between"><h3 style="margin:0">${esc(c.name)}</h3><span class="chip">${rows.length} ${rows.length === 1 ? 'membro' : 'membros'}</span></div>
        <div class="row between wrap gap-s club-book">
          <span>📖 ${c.current_book ? `Lendo juntos: <b>${esc(c.current_book)}</b>` : '<span class="muted">Nenhum livro do clube definido</span>'}</span>
          ${c.owner === me ? `<button class="btn small ghost" data-action="setClubBook" data-id="${c.id}" data-book="${esc(c.current_book || '')}">✏️</button>` : ''}
        </div>
        <div class="small muted" style="margin-top:6px">Meta coletiva do mês: <b>${nf(total)}</b> / ${nf(c.goal_pages)} páginas</div>
        <div class="bar"><div style="width:${Math.min(100, (total / c.goal_pages) * 100)}%"></div></div>
        <div class="small muted" style="margin:10px 0 4px">Ranking da semana (páginas)</div>
        <div class="list">${rows.map((r, i) => `<div class="row between li ${r.user_id === me ? 'current' : ''}">
          <span>${['🥇', '🥈', '🥉'][i] || `${i + 1}.`} ${r.handle ? `<a href="#/u/${esc(r.handle)}">${esc(r.display_name || r.handle)}</a>` : esc(r.display_name || 'Leitor')}${r.stats?.streak > 1 ? ` <span class="small">🔥${r.stats.streak}</span>` : ''}</span>
          <b>${nf(r.week)}</b></div>`).join('')}</div>
        <div class="small muted" style="margin:12px 0 4px">🖍️ Grifos do clube</div>
        ${posts.length ? `<div class="club-posts">${posts.map((p) => `<article class="club-post">
          <div class="club-post-text">“${linkBold(esc(p.text))}”</div>
          <div class="row between wrap gap-s"><span class="small muted">${esc(nameOf(p.user_id))} · ${esc(p.book_title || '')}${p.page ? ` · p. ${p.page}` : ''}</span>
            <span class="row gap-s">${p.user_id === me
              ? `<button class="icon-btn small" data-action="deleteClubPost" data-id="${p.id}" aria-label="Apagar">🗑️</button>`
              : `<button class="icon-btn small" data-action="saveClubPost" data-club="${c.id}" data-id="${p.id}" title="Salvar na minha estante" aria-label="Salvar na minha estante">📥</button>`}</span></div>
        </article>`).join('')}</div>` : '<p class="small muted" style="margin:0">Ninguém compartilhou ainda. Abra uma nota e toque em “Compartilhar no clube”.</p>'}
        <div class="row between wrap gap-s" style="margin-top:10px">
          <span class="small">Convite: <b class="code">${esc(c.code)}</b></span>
          <span class="row gap-s"><button class="btn small" data-action="inviteClub" data-code="${esc(c.code)}" data-name="${esc(c.name)}">📤 Convidar</button>
          <button class="btn small ghost" data-action="leaveClub" data-id="${c.id}">Sair</button></span>
        </div>
      </section>`;
    }));
    box.innerHTML = parts.join('');
  } catch (e) {
    box.innerHTML = empty(`Não foi possível carregar os clubes: ${esc(e.message)}`);
  }
};

// ---------- pergunte à sua biblioteca (IA) ----------
const STOP = new Set('a o e de da do das dos em no na nos nas um uma uns umas que para por com sem como mais menos sobre entre ao aos à às é são ser foi qual quais quem onde quando porque se eu meu minha meus minhas livros livro diz dizem'.split(' '));
const words = (t) => norm(t).normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));

function relevantNotes(question, limit = 60) {
  const q = words(question);
  const scored = state.notes.map((n) => {
    const b = bookById(n.bookId);
    const text = `${n.title || ''} ${n.text} ${(n.tags || []).join(' ')} ${b?.title || ''} ${b?.genre || ''} ${b?.subtheme || ''}`;
    const ws = words(text);
    const score = q.reduce((a, w) => a + ws.filter((x) => x.startsWith(w) || w.startsWith(x)).length, 0);
    return { n, b, score };
  });
  const pool = state.notes.length <= limit ? scored : scored.filter((x) => x.score > 0);
  return pool.sort((a, b) => b.score - a.score).slice(0, limit)
    .map(({ n, b }) => ({ id: n.id, book: b?.title || '', author: b?.author || '', page: n.page, text: plainText(n.text) }));
}

let askState = { q: '', answer: null, busy: false };
function askView() {
  const a = askState.answer;
  const cited = a ? a.sources.map((id) => noteById(id)).filter(Boolean) : [];
  const num = new Map(cited.map((n, i) => [n.id, i + 1]));
  const answerHtml = a ? esc(a.answer).replace(/\[n([\w-]+)\]/g, (m, id) => (num.has(id) ? `<a class="cite" href="#/nota/${id}">[${num.get(id)}]</a>` : '')).replace(/\n/g, '<br>') : '';
  return `${seg(IDEAS_SEG, 'ask')}
  <form class="card form" id="ask-form">
    <h3>✨ Pergunte à sua biblioteca</h3>
    <p class="hint" style="margin:0">A IA responde usando só as suas notas e grifos, citando de onde veio cada ideia.</p>
    <textarea name="q" rows="3" required placeholder="ex: O que meus livros dizem sobre liderança?">${esc(askState.q)}</textarea>
    <button class="btn primary" ${askState.busy ? 'disabled' : ''}>${askState.busy ? 'Pensando…' : 'Perguntar'}</button>
  </form>
  ${a ? `<section class="card ask-answer"><div>${answerHtml}</div>
    ${cited.length ? `<h3 style="margin-top:14px">Fontes</h3><div class="backlinks">${cited.map((n) => `<a href="#/nota/${n.id}">[${num.get(n.id)}] ${esc(noteLabel(n))}<br><small>${esc(bookById(n.bookId)?.title || '')}${n.page ? ` · pág. ${n.page}` : ''}</small></a>`).join('')}</div>` : ''}
  </section>` : ''}
  ${!state.notes.length ? empty('Crie algumas notas primeiro: é delas que a IA tira as respostas.') : ''}`;
}
askView.mount = () => {
  const f = $('#ask-form');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const q = f.q.value.trim();
    if (!q || !state.notes.length) return;
    askState = { q, answer: null, busy: true };
    render();
    try {
      const res = await aiRun('ask', { question: q, notes: relevantNotes(q) });
      askState = { q, answer: res, busy: false };
    } catch (err) {
      askState = { q, answer: null, busy: false };
      if (err.message) toast(esc(err.message), 'err');
    }
    if (location.hash.startsWith('#/perguntar')) render();
  };
};

// Chama a IA tratando login, plano e chave pessoal
async function aiRun(task, input) {
  if (globalThis.__aiMock) return globalThis.__aiMock(task, input); // testes da interface sem gastar com a IA
  const st = AI.available(state.settings);
  if (st === 'login') { location.hash = '#/conta'; throw new Error('Entre na sua conta para usar a IA.'); }
  if (st === 'plus') { location.hash = '#/plus'; throw new Error(''); }
  if (st === 'key') { location.hash = '#/ajustes'; throw new Error('Cadastre sua chave da API da Anthropic em Ajustes → IA.'); }
  try {
    return await AI.run(task, { ...input, lang }, state.settings);
  } catch (e) {
    if (e.code === 'plus') { location.hash = '#/plus'; throw new Error(''); }
    throw e;
  }
}

// ---------- fichamento e técnica de Feynman (IA, Plus) ----------
const busyModal = (title, msg) => openModal(`<div class="form"><h3>${title}</h3><p class="small muted">${msg}</p></div>`);

// Texto do fichamento (para salvar como nota, copiar ou imprimir)
function summaryText(b, r) {
  const quote = (id) => noteById(id) && plainText(noteById(id).text);
  return [
    `Fichamento: ${b.title}${b.author ? ` (${b.author})` : ''}`, '',
    r.overview, '',
    'Ideias principais', ...r.ideas.map((x, i) => `${i + 1}. ${x.title}: ${x.text}`), '',
    'Grifos marcantes', ...r.quotes.map(quote).filter(Boolean).map((q) => `“${q}”`), '',
    'Para refletir', ...r.questions.map((q) => `• ${q}`),
  ].join('\n');
}

function printText(title, text) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;width:0;height:0;border:0';
  document.body.append(f);
  f.contentDocument.write(`<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:15px/1.6 Georgia,serif;max-width:680px;margin:40px auto;color:#222;white-space:pre-wrap}</style><body>${esc(text)}</body>`);
  f.contentDocument.close();
  setTimeout(() => { f.contentWindow.print(); setTimeout(() => f.remove(), 1000); }, 200);
}

const aiStudyActions = {
  async aiSummary({ book }) {
    const b = bookById(book);
    const notes = state.notes.filter((n) => n.bookId === book).map((n) => ({ id: n.id, text: plainText(n.text), page: n.page, kind: n.kind }));
    busyModal('✨ Fichamento', `Lendo seus ${notes.length} grifos e notas de “${esc(b.title)}”…`);
    let r;
    try { r = await aiRun('summary', { book: { title: b.title, author: b.author }, notes }); } catch (e) { closeModal(); if (e.message) toast(esc(e.message), 'err'); return; }
    const text = summaryText(b, r);
    const chip = (id) => (noteById(id) ? `<a class="chip" href="#/nota/${id}">${esc((noteLabel(noteById(id)) || '').slice(0, 32))}</a>` : '');
    openModal(`<div class="form summary"><div class="row between"><h3>✨ Fichamento</h3><button type="button" class="icon-btn" data-action="close" aria-label="Fechar">✕</button></div>
      <h2 style="margin:0">${esc(b.title)}</h2>
      ${r.overview.split(/\n+/).map((p) => `<p>${esc(p)}</p>`).join('')}
      <h3>Ideias principais</h3>
      <ol class="summary-ideas">${r.ideas.map((x) => `<li><b>${esc(x.title)}</b> ${esc(x.text)}<div class="chips">${x.notes.map(chip).join('')}</div></li>`).join('')}</ol>
      ${r.quotes.length ? `<h3>Grifos marcantes</h3>${r.quotes.map((id) => noteById(id) && `<blockquote>${esc(plainText(noteById(id).text))}</blockquote>`).filter(Boolean).join('')}` : ''}
      <h3>Para refletir</h3><ul>${r.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>
      <div class="row gap-s wrap"><button class="btn primary" id="sum-save">✍️ Salvar como nota</button><button class="btn" id="sum-copy">📋 Copiar</button><button class="btn" id="sum-print">📄 PDF / imprimir</button></div>
    </div>`, (root) => {
      $('#sum-save', root).onclick = async () => {
        closeModal();
        await commit(() => persist('notes', { id: uid(), createdAt: Date.now(), bookId: b.id, title: `Fichamento: ${b.title}`, text, kind: 'thought', source: 'ai', tags: ['fichamento'] }));
        toast('Fichamento salvo nas notas do livro');
      };
      $('#sum-copy', root).onclick = async () => { try { await navigator.clipboard.writeText(text); toast('Fichamento copiado'); } catch { prompt('Copie o fichamento:', text); } };
      $('#sum-print', root).onclick = () => printText(`Fichamento: ${b.title}`, text);
    });
  },
  feynman({ id, concept }) {
    const n = id && noteById(id);
    const topic = concept || noteTitle(n) || (linksOf(n.text).length ? [...new Set(linksOf(n.text))].slice(0, 2).join(' e ') : 'a ideia desta nota');
    // referência: a nota (ou as notas do conceito) e as notas que tratam das mesmas ideias
    const keys = concept ? [norm(concept)] : linksOf(n.text).map(norm);
    const refs = state.notes.filter((x) => (n && x.id === n.id) || linksOf(x.text).some((l) => keys.includes(norm(l))) || (x.tags || []).some((t) => keys.includes(norm(t))));
    openModal(`<form class="form" id="feyn-form"><div class="row between"><h3>🎓 Explique com suas palavras</h3><button type="button" class="icon-btn" data-action="close" aria-label="Fechar">✕</button></div>
      <p class="small">Explique <b>${esc(topic)}</b> como se fosse para alguém que nunca leu o livro. A IA compara com as suas ${refs.length} ${refs.length === 1 ? 'nota' : 'notas'} sobre o assunto.</p>
      <textarea name="exp" rows="7" required minlength="40" placeholder="Com minhas palavras, isso quer dizer que…"></textarea>
      <div id="feyn-out"></div>
      <div class="actions"><button type="button" class="btn ghost" data-action="close">Fechar</button><button class="btn primary" id="feyn-go">Avaliar</button></div>
    </form>`, (root) => {
      const form = $('#feyn-form', root);
      form.onsubmit = async (e) => {
        e.preventDefault();
        const go = $('#feyn-go', root);
        go.disabled = true;
        go.textContent = 'Avaliando…';
        try {
          const r = await aiRun('feynman', { topic, explanation: form.exp.value, notes: refs.slice(0, 30).map((x) => ({ text: plainText(x.text), book: bookById(x.bookId)?.title || '' })) });
          const list = (title, items, cls) => (items.length ? `<div class="feyn-${cls}"><b>${title}</b><ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '');
          $('#feyn-out', root).innerHTML = `<section class="feyn">
            <div class="row gap"><span class="feyn-score">${Math.max(0, Math.min(10, r.score))}<small>/10</small></span><span>${esc(r.verdict)}</span></div>
            ${list('✅ Você explicou bem', r.right, 'ok')}${list('➕ Faltou', r.missing, 'miss')}${list('⚠️ Atenção', r.wrong, 'warn')}
            <p class="small"><b>💡 Dica:</b> ${esc(r.tip)}</p></section>`;
          go.textContent = 'Avaliar de novo';
        } catch (err) {
          if (err.message) toast(esc(err.message), 'err');
          go.textContent = 'Avaliar';
        }
        go.disabled = false;
      };
    });
  },
};

// ---------- plano Plus ----------
function plusView() {
  const plan = Cloud.plan();
  const u = Cloud.user();
  const checkout = CONFIG.plusCheckoutUrl && u
    ? `${CONFIG.plusCheckoutUrl}${CONFIG.plusCheckoutUrl.includes('?') ? '&' : '?'}client_reference_id=${encodeURIComponent(u.id)}${u.email ? `&prefilled_email=${encodeURIComponent(u.email)}` : ''}`
    : '';
  const feats = [
    ['✨', 'Pergunte à sua biblioteca', 'Respostas tiradas das suas notas, com as fontes'],
    ['🧠', 'Cards automáticos', 'A IA transforma grifos em cards de memorização'],
    ['🔗', 'Conexões sugeridas', 'Descobre ligações entre ideias de livros diferentes'],
    ['📝', 'Fichamento com IA', 'Resumo do livro feito a partir dos seus grifos, em PDF'],
    ['🎓', 'Explique com suas palavras', 'A IA avalia sua explicação (técnica de Feynman)'],
    ['🎯', 'Plano para prova', 'Revisão distribuída até a data da prova, com revisão final na véspera'],
    ['📰', 'Artigos ilimitados', 'Salve links, leia sem anúncios e grife trechos'],
    ['🎨', 'Temas e cores extras', 'Minimal, Aquarela, E-reader, Caderno, Pôr do sol e marca-texto colorido'],
    ['📊', 'Retrospectiva completa', 'Mês a mês, seus autores, ideias mais conectadas e grifos favoritos'],
    ['🏷️', 'Artes sem marca', 'Posts só com a sua assinatura'],
  ];
  if (u && plan === 'free') Cloud.track('plus_view');
  return `<a href="#/conta" class="back">← Conta</a>
  <section class="card hero center plus-hero"><span class="onb-emoji">⭐</span><h2 style="margin:0">Grifo Plus</h2>
    <p class="muted" style="margin:4px 0 0">Seu segundo cérebro de leituras, com IA.</p>
    <div class="price">${esc(CONFIG.plusPriceLabel)}</div></section>
  <section class="card list">${feats.map(([i, t, d]) => `<div class="row gap li"><span class="big-emoji">${i}</span><span><b>${t}</b><br><span class="small muted">${d}</span></span></div>`).join('')}</section>
  <section class="card"><h3>Grátis para sempre</h3><p class="small muted" style="margin:0">Livros, notas, OCR de grifos, mapa mental, cards e revisão, metas, conquistas, clubes, sincronização e todas as artes básicas.</p></section>
  ${plan === 'personal' ? '<p class="nudge">Você está no modo pessoal: todos os recursos já estão liberados neste aparelho.</p>'
    : plan === 'plus' ? '<p class="nudge">✅ Você já é Plus. Obrigado por apoiar o Grifo!</p>'
    : !u ? '<a class="btn primary block" href="#/conta">Entrar para assinar</a>'
    : checkout ? `<a class="btn primary block" href="${esc(checkout)}" target="_blank" rel="noopener">Assinar o Plus</a><p class="hint center">Depois do pagamento, volte ao app: o plano é liberado em instantes.</p>`
    : '<p class="nudge">As assinaturas abrem em breve.</p>'}
  ${u && plan === 'free' ? '<a class="card wrapped-cta" href="#/conta"><span class="big-emoji">🎁</span><span class="grow"><b>Ganhe Plus de graça</b><span class="small muted">Cada amigo que entrar pelo seu convite dá 1 mês de Plus para os dois</span></span></a>' : ''}`;
}

// ---------- convites ----------
const inviteMsg = (link) => tr('Estou usando o Grifo para guardar o que grifo nos livros e revisar depois. Entre pelo meu convite e ganhe 1 mês de Plus:') + ` ${link}`;
async function mountInvite() {
  const box = $('#invite-card');
  try {
    const inv = await Cloud.myInvite();
    if (!box?.isConnected || !inv) return;
    const link = Cloud.inviteLink(inv.code);
    const until = inv.plus_until && new Date(inv.plus_until) > new Date() ? new Date(inv.plus_until).toLocaleDateString(LOCALE) : '';
    box.innerHTML = `<h3>🎁 Convide amigos</h3>
      <p class="small">Cada pessoa que criar conta pelo seu link ganha <b>1 mês de Plus</b>, e você também (até 12 meses).</p>
      <div class="invite-link"><code>${esc(link.replace(/^https?:\/\//, ''))}</code></div>
      <div class="row gap-s wrap"><button class="btn primary" data-action="shareInvite">📤 Enviar convite</button><button class="btn" data-action="copyInvite">🔗 Copiar link</button></div>
      <p class="small muted" style="margin:8px 0 0">${inv.invited ? `${inv.invited} ${inv.invited === 1 ? 'pessoa entrou' : 'pessoas entraram'} pelo seu convite.` : 'Ninguém entrou pelo seu convite ainda.'}${until ? ` Plus até ${until}.` : ''}</p>`;
  } catch {
    if (box?.isConnected) box.innerHTML = '<h3>🎁 Convide amigos</h3><p class="small muted" style="margin:0">Não foi possível carregar o convite agora.</p>';
  }
  if (await Cloud.isAdmin() && $('#admin-link')) $('#admin-link').innerHTML = '<a class="card wrapped-cta" href="#/admin"><span class="big-emoji">📊</span><span class="grow"><b>Painel de métricas</b><span class="small muted">Só você vê: usuários, ativação, retenção e convites</span></span></a>';
}

// ---------- apresentação (quem ainda não entrou) ----------
const landing = () => landingView({ invite: !!Cloud.pendingInvite(), price: CONFIG.plusPriceLabel });

// ---------- painel de métricas (admin) ----------
function adminView() {
  return `<a href="#/conta" class="back">← Conta</a><h2>Painel de métricas</h2>
  <div id="admin-body"><p class="small muted">Carregando…</p></div>`;
}
adminView.mount = async () => {
  const body = $('#admin-body');
  if (!(await Cloud.isAdmin())) { body.innerHTML = empty('Este painel é só para administradores.'); return; }
  let m;
  try { m = await Cloud.adminMetrics(); } catch (e) { body.innerHTML = `<p class="nudge">Não foi possível carregar: ${esc(e.message)}</p>`; return; }
  const pct = (ok, base) => (base ? `${Math.round((ok / base) * 100)}%` : '—');
  const goal = (ok, base, target) => (base ? (ok / base >= target ? 'ok' : 'low') : '');
  const stat = (v, label, cls = '') => `<div class="card stat ${cls}"><b>${v}</b><span>${label}</span></div>`;
  const weeks = m.signups_by_week || [];
  const max = Math.max(1, ...weeks.map((w) => w.n));
  const events = Object.entries(m.events30 || {}).sort((a, b) => b[1] - a[1]);
  body.innerHTML = `
  <section class="grid3">${stat(nf(m.users), 'usuários')}${stat(nf(m.new_7d), 'novos em 7 dias')}${stat(nf(m.mau), 'ativos em 30 dias')}</section>
  <section class="grid3">${stat(nf(m.dau), 'ativos hoje')}${stat(nf(m.wau), 'ativos na semana')}${stat(nf(m.referrals), 'entraram por convite')}</section>
  <h3>Funil</h3>
  <section class="card list">
    <div class="row between li"><span><b>Ativação</b><br><span class="small muted">salvou a 1ª nota em até 24 h (contas dos últimos 30 dias) · meta 40%</span></span><b class="metric ${goal(m.activation.ok, m.activation.base, 0.4)}">${pct(m.activation.ok, m.activation.base)}</b></div>
    <div class="row between li"><span><b>Retenção</b><br><span class="small muted">voltou a usar 7 dias depois de criar a conta · meta 25%</span></span><b class="metric ${goal(m.retention7.ok, m.retention7.base, 0.25)}">${pct(m.retention7.ok, m.retention7.base)}</b></div>
    <div class="row between li"><span><b>Compartilhamento</b><br><span class="small muted">ativos que geraram arte em 30 dias · meta 15%</span></span><b class="metric ${goal(m.sharers30, m.mau, 0.15)}">${pct(m.sharers30, m.mau)}</b></div>
    <div class="row between li"><span><b>Plus</b><br><span class="small muted">${nf(m.plus_paid)} pagantes · ${nf(m.plus_invite)} por convite · meta 2–5% dos ativos</span></span><b class="metric ${goal(m.plus_paid, m.mau, 0.02)}">${pct(m.plus_paid, m.mau)}</b></div>
  </section>
  <h3>Cadastros por semana</h3>
  <section class="card">${weeks.length ? `<div class="weekbars">${weeks.map((w) => `<div class="wb"><span class="wb-n">${w.n}</span><i style="height:${Math.max(4, (w.n / max) * 100)}%"></i><span class="wb-l">${w.week.slice(8, 10)}/${w.week.slice(5, 7)}</span></div>`).join('')}</div>` : '<p class="small muted" style="margin:0">Sem cadastros nas últimas 8 semanas.</p>'}</section>
  <h3>Eventos (30 dias)</h3>
  <section class="card list">${events.length ? events.map(([k, n]) => `<div class="row between li"><span>${esc(EVENT_LABEL[k] || k)}</span><b>${nf(n)}</b></div>`).join('') : '<p class="small muted" style="margin:0">Nenhum evento ainda.</p>'}</section>
  <p class="hint">Ativo = algum livro, nota, card ou leitura mudou no período. As porcentagens ficam mais confiáveis a partir de algumas dezenas de contas.</p>`;
};
const EVENT_LABEL = { share: 'Artes compartilhadas ou baixadas', invite_share: 'Convites enviados', invite_copy: 'Links de convite copiados', plus_view: 'Visitas à página do Plus' };

const cloudActions = {
  loginGoogle: async () => {
    try { await Cloud.signInWithGoogle(); } catch (e) { toast(`Não foi possível entrar com Google: ${esc(e.message)}`, 'err'); }
  },
  async logout() {
    if (!confirm('Sair da conta? Seus dados continuam salvos na nuvem e serão removidos deste aparelho.')) return;
    try {
      await Cloud.sync();
    } catch {
      if (!confirm('Não foi possível sincronizar agora. Se sair, as alterações feitas offline neste aparelho serão perdidas. Sair mesmo assim?')) return;
    }
    await Cloud.removePush();
    await db.wipeLocal();
    await Cloud.signOut();
    await load();
    onbStep = 1;
    location.hash = '#/';
    render();
  },
  syncNow: () => runSync({ silent: false }),
  async shareInvite() {
    const inv = await Cloud.myInvite();
    const link = Cloud.inviteLink(inv.code);
    Cloud.track('invite_share');
    if (navigator.share) navigator.share({ text: inviteMsg(link) }).catch(() => {});
    else { await navigator.clipboard?.writeText(inviteMsg(link)); toast('Convite copiado. Agora é só colar para seus amigos.'); }
  },
  async copyInvite() {
    const inv = await Cloud.myInvite();
    Cloud.track('invite_copy');
    try { await navigator.clipboard.writeText(Cloud.inviteLink(inv.code)); toast('🔗 Link de convite copiado'); } catch { prompt('Copie seu link de convite:', Cloud.inviteLink(inv.code)); }
  },
  dailyMore: () => { dailyShift++; render(); },
  async noteToClub({ id }) {
    const n = noteById(id), b = bookById(n.bookId);
    let clubs;
    try { clubs = await Cloud.myClubs(); } catch (e) { return toast(esc(e.message), 'err'); }
    if (!clubs.length) { toast('Você ainda não participa de um clube.'); location.hash = '#/clubes'; return; }
    openModal(`<div class="form"><h3>👥 Compartilhar no clube</h3>
      <p class="small muted" style="margin:0">“${esc(plainText(n.text).slice(0, 180))}${plainText(n.text).length > 180 ? '…' : ''}”</p>
      <div class="imp-options">${clubs.map((c) => `<button type="button" class="imp-opt" data-club="${c.id}"><b>${esc(c.name)}</b>${c.current_book ? `<small>Lendo juntos: ${esc(c.current_book)}</small>` : ''}</button>`).join('')}</div>
      <div class="actions"><button type="button" class="btn ghost" data-action="close">Cancelar</button></div>
    </div>`, (root) => {
      root.querySelectorAll('[data-club]').forEach((btn) => {
        btn.onclick = async () => {
          try {
            await Cloud.postToClub(btn.dataset.club, { text: plainText(n.text), book_title: b?.title || '', book_author: b?.author || '', page: n.page });
            closeModal();
            toast('🖍️ Grifo compartilhado com o clube');
          } catch (e) { toast(esc(e.message), 'err'); }
        };
      });
    });
  },
  async deleteClubPost({ id }) {
    if (!confirm('Apagar este grifo do clube?')) return;
    try { await Cloud.deleteClubPost(id); render(); } catch (e) { toast(esc(e.message), 'err'); }
  },
  async saveClubPost({ club, id }) {
    const p = (clubPostCache.get(club) || []).find((x) => x.id === id);
    if (!p) return;
    await commit(async () => {
      let b = findBook(p.book_title, p.book_author);
      if (!b) {
        b = { id: uid(), createdAt: Date.now(), title: p.book_title || 'Livro do clube', author: p.book_author || '', pages: 0, purpose: 'hobby', genre: '', subtheme: '', status: 'want', currentPage: 0, startDate: '', endDate: '', rating: 0, isbn: '', cover: '', review: '' };
        await persist('books', b);
      }
      await persist('notes', { id: uid(), bookId: b.id, title: '', text: p.text, page: p.page, kind: 'quote', source: 'clube', tags: ['clube'], createdAt: Date.now() });
    });
    toast('📥 Grifo salvo nas suas notas');
  },
  async setClubBook({ id, book }) {
    const title = prompt('Qual livro o clube está lendo junto?', book || '');
    if (title === null) return;
    try { await Cloud.setClubBook(id, title.trim()); render(); } catch (e) { toast(esc(e.message), 'err'); }
  },
  async recommend() {
    const read = state.books.filter((b) => b.status === 'finished' || b.status === 'reading');
    if (read.length < 2) return toast('Cadastre pelo menos 2 livros lidos ou em leitura para receber sugestões.');
    toast('✨ Pensando nas suas próximas leituras…');
    const highlights = [...state.notes].sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || b.createdAt - a.createdAt)
      .map((n) => plainText(n.text)).filter((t) => t.length >= 30).slice(0, 15);
    let res;
    try {
      res = await aiRun('recommend', {
        read: read.map((b) => ({ title: b.title, author: b.author, theme: [b.genre, b.subtheme].filter(Boolean).join(' › '), rating: b.rating || 0 })),
        highlights,
        owned: state.books.map((b) => b.title),
      });
    } catch (e) { if (e.message) toast(esc(e.message), 'err'); return; }
    const recs = (res.books || []).filter((r) => !findBook(r.title, r.author));
    if (!recs.length) return toast('Não encontrei sugestões novas agora. Tente de novo mais tarde.');
    openModal(`<div class="form"><div class="row between"><h3>✨ O que ler a seguir</h3><button type="button" class="icon-btn" data-action="close" aria-label="Fechar">✕</button></div>
      <p class="hint" style="margin:0">Sugestões a partir do que você leu e grifou. A IA pode errar edições e detalhes: confira antes de comprar.</p>
      <div class="recs">${recs.map((r, i) => `<article class="card rec">
        <div class="row between gap"><div><b>${esc(r.title)}</b><div class="small muted">${esc(r.author)}${r.theme ? ` · ${esc(r.theme)}` : ''}</div></div>
          <button type="button" class="btn small" data-rec="${i}">➕ Quero ler</button></div>
        <p class="small" style="margin:6px 0 0">${esc(r.why)}</p></article>`).join('')}</div>
    </div>`, (root) => {
      root.querySelectorAll('[data-rec]').forEach((btn) => {
        btn.onclick = async () => {
          const r = recs[btn.dataset.rec];
          btn.disabled = true;
          btn.textContent = '✓ Na lista';
          const [genre, subtheme = ''] = String(r.theme || '').split('›').map((x) => x.trim());
          const book = { id: uid(), createdAt: Date.now(), title: r.title, author: r.author, pages: 0, purpose: PURPOSE[r.purpose] ? r.purpose : 'hobby', genre: genre || '', subtheme, status: 'want', currentPage: 0, startDate: '', endDate: '', rating: 0, isbn: '', cover: '', review: '' };
          await commit(() => persist('books', book));
          // capa e número de páginas, se a busca encontrar o livro
          searchBooks(`${r.title} ${r.author}`).then(async ({ items }) => {
            const hit = items.find((x) => norm(x.title).startsWith(norm(r.title).slice(0, 12)));
            if (!hit) return;
            await persist('books', { ...bookById(book.id), pages: Number(hit.pages) || 0, cover: hit.cover || '', isbn: hit.isbn || '' });
            render();
          }).catch(() => {});
        };
      });
    });
  },
  async toggleFav({ id }) {
    const n = noteById(id);
    await persist('notes', { ...n, fav: !n.fav });
    render();
    scheduleSync();
  },
  async deleteAccount() {
    const typed = prompt('Isso apaga sua conta e TODOS os seus dados para sempre, inclusive na nuvem. Para confirmar, digite EXCLUIR:');
    if (typed?.trim().toUpperCase() !== 'EXCLUIR') return;
    try {
      await Cloud.removePush();
      await Cloud.deleteAccount();
      await db.wipeLocal();
      await load();
      onbStep = 1;
      location.hash = '#/';
      render();
      toast('Sua conta e seus dados foram excluídos.');
    } catch (e) {
      toast(esc(e.message), 'err');
    }
  },
  feedback() {
    if (Cloud.enabled() && !Cloud.user()) { location.hash = '#/conta'; return; }
    openModal(`<form class="form" id="fb-form"><h3>✉️ Enviar sugestão</h3>
      <div class="radio-pills">${[['sugestao', '💡 Ideia'], ['problema', '🐞 Problema'], ['elogio', '💜 Elogio']].map(([k, l], i) => `<input type="radio" name="kind" id="fb-${k}" value="${k}" ${i ? '' : 'checked'}><label for="fb-${k}">${l}</label>`).join('')}</div>
      <textarea name="message" rows="5" required minlength="3" maxlength="4000" placeholder="Conte o que aconteceu ou o que você gostaria de ver no Grifo…"></textarea>
      <div class="actions"><button type="button" class="btn ghost" data-action="close">Cancelar</button><button class="btn primary">Enviar</button></div>
    </form>`, (root) => {
      const f = $('#fb-form', root);
      f.onsubmit = async (e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(f));
        if (!Cloud.enabled()) {
          location.href = `mailto:${CONFIG.contactEmail}?subject=${encodeURIComponent('Grifo: ' + fd.kind)}&body=${encodeURIComponent(fd.message)}`;
          return closeModal();
        }
        try {
          await Cloud.sendFeedback(fd.kind, fd.message.trim(), APP_VERSION);
          closeModal();
          toast('Obrigado! Sua mensagem foi enviada 💜');
        } catch (err) {
          toast(`Não foi possível enviar: ${esc(err.message)}`, 'err');
        }
      };
    });
  },
  async copyProfile() {
    const h = Cloud.currentProfile()?.handle;
    if (!h) return;
    await navigator.clipboard.writeText(profileLink(h)).catch(() => {});
    toast('🔗 Link do perfil copiado');
  },
  newClub() {
    openModal(`<form class="form" id="club-form"><h3>➕ Novo clube de leitura</h3>
      <label>Nome <input name="name" required maxlength="60" placeholder="ex: Clube do livro da firma"></label>
      <label>Meta coletiva de páginas por mês <input name="goal" type="number" min="100" value="2000"></label>
      <div class="actions"><button type="button" class="btn ghost" data-action="close">Cancelar</button><button class="btn primary">Criar</button></div>
    </form>`, (root) => {
      const f = $('#club-form', root);
      f.onsubmit = async (e) => {
        e.preventDefault();
        try {
          const c = await Cloud.createClub(f.name.value.trim(), Number(f.goal.value) || 2000);
          closeModal();
          toast(`Clube criado! Código de convite: <b>${esc(c.code)}</b>`);
          render();
        } catch (err) { toast(esc(err.message), 'err'); }
      };
    });
  },
  async joinClubPrompt() {
    const code = prompt('Código de convite do clube:');
    if (!code) return;
    try { await Cloud.joinClub(code); toast('Você entrou no clube! 👥'); render(); } catch (e) { toast(esc(e.message), 'err'); }
  },
  async inviteClub({ code, name }) {
    const text = `Entre no meu clube de leitura “${name}” no Grifo! Código: ${code}\n${location.origin}${location.pathname}#/clubes`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else { await navigator.clipboard.writeText(text).catch(() => {}); toast('Convite copiado 📋'); }
  },
  async leaveClub({ id }) {
    if (!confirm('Sair deste clube?')) return;
    try { await Cloud.leaveClub(id); render(); } catch (e) { toast(esc(e.message), 'err'); }
  },

  // ----- IA -----
  async aiCards({ id, book }) {
    const notes = (book ? state.notes.filter((n) => n.bookId === book) : [noteById(id)]).slice(0, 20);
    if (!notes.length) return toast('Nenhuma nota para transformar em cards.');
    toast('✨ A IA está criando seus cards…');
    let res;
    try {
      res = await aiRun('cards', { notes: notes.map((n) => ({ id: n.id, book: bookById(n.bookId)?.title || '', page: n.page, text: plainText(n.text) })) });
    } catch (e) { if (e.message) toast(esc(e.message), 'err'); return; }
    const cards = (res.cards || []).filter((c) => noteById(c.noteId) && (c.type === 'qa' ? c.front && c.back : /\{\{.+?\}\}/.test(c.front)));
    if (!cards.length) return toast('A IA não encontrou ideias para virar card nessas notas.');
    openModal(`<div class="form"><h3>✨ ${cards.length} cards sugeridos</h3>
      <p class="hint" style="margin:0">Desmarque os que não quiser. Dá para editar depois.</p>
      <div class="imp-list ai-cards">${cards.map((c, i) => `<label class="check"><input type="checkbox" data-i="${i}" checked>
        <span class="grow"><b>${cardFace(c, false)}</b>${c.type === 'qa' ? `<br><span class="small muted">${linkBold(esc(c.back))}</span>` : ''}</span></label>`).join('')}</div>
      <div class="actions"><button type="button" class="btn ghost" data-action="close">Cancelar</button><button type="button" class="btn primary" id="ai-save">Salvar cards</button></div>
    </div>`, (root) => {
      $('#ai-save', root).onclick = async () => {
        const chosen = [...root.querySelectorAll('input:checked')].map((x) => cards[x.dataset.i]);
        closeModal();
        await commit(async () => {
          for (const c of chosen) {
            const n = noteById(c.noteId);
            await persist('cards', S.newCard({ id: uid(), noteId: n.id, bookId: n.bookId, createdAt: Date.now(), type: c.type, front: c.front, back: c.type === 'qa' ? c.back : '', source: 'ai' }, G.ymd()));
          }
        });
        toast(`🧠 ${chosen.length} cards criados. Eles aparecem hoje em “Revisar”.`);
      };
    });
  },
  async aiLinks({ id }) {
    const n = noteById(id);
    const b = bookById(n.bookId);
    const candidates = linkCandidates().map((c) => c.label).filter((l) => norm(l) !== norm(noteTitle(n)) && norm(l) !== norm(b?.title));
    toast('✨ Procurando conexões…');
    let res;
    try {
      res = await aiRun('links', { note: { book: b?.title || '', text: plainText(n.text) }, candidates });
    } catch (e) { if (e.message) toast(esc(e.message), 'err'); return; }
    const known = new Set(candidates.map(norm));
    const already = new Set(linksOf(n.text).map(norm));
    const items = [
      ...(res.existing || []).filter((x) => known.has(norm(x.target))).map((x) => ({ name: candidates.find((c) => norm(c) === norm(x.target)), reason: x.reason, isNew: false })),
      ...(res.concepts || []).map((x) => ({ name: x.name.trim(), reason: x.reason, isNew: !known.has(norm(x.name)) })),
    ].filter((x) => x.name && !already.has(norm(x.name)));
    if (!items.length) return toast('Nenhuma conexão nova encontrada para esta nota.');
    openModal(`<div class="form"><h3>🔗 Conexões sugeridas</h3>
      <div class="imp-list">${items.map((x, i) => `<label class="check"><input type="checkbox" data-i="${i}" checked>
        <span class="grow"><b>[[${esc(x.name)}]]</b> ${x.isNew ? '<span class="chip">novo conceito</span>' : ''}<br><span class="small muted">${esc(x.reason)}</span></span></label>`).join('')}</div>
      <div class="actions"><button type="button" class="btn ghost" data-action="close">Cancelar</button><button type="button" class="btn primary" id="ai-links-save">Adicionar à nota</button></div>
    </div>`, (root) => {
      $('#ai-links-save', root).onclick = async () => {
        const chosen = [...root.querySelectorAll('input:checked')].map((x) => items[x.dataset.i].name);
        if (!chosen.length) return closeModal();
        closeModal();
        const note = { ...n, text: `${n.text.trim()}\n\nConexões: ${chosen.map((c) => `[[${c}]]`).join(' · ')}` };
        await commit(() => persist('notes', note));
        toast(`🔗 ${chosen.length} conexões adicionadas`);
      };
    });
  },
};

// ---------- privacidade e termos (LGPD) ----------
function legalBack() {
  return Cloud.user() || !Cloud.enabled() ? '<a href="#/ajustes" class="back">← Ajustes</a>' : '<a href="#/" class="back">← Entrar</a>';
}
const contactLine = () => (CONFIG.contactEmail
  ? `pelo e-mail <a href="mailto:${esc(CONFIG.contactEmail)}">${esc(CONFIG.contactEmail)}</a> ou pelo botão “Enviar sugestão” em Ajustes`
  : 'pelo botão “Enviar sugestão” em Ajustes');

function privacyView() {
  return `${legalBack()}<article class="card legal">
  <h2>Política de privacidade</h2>
  <p class="small muted">Atualizada em 24/10/2026 · Grifo — leituras que ficam</p>
  <h3>O que coletamos</h3>
  <ul>
    <li><b>Conta:</b> nome, e-mail e foto do seu perfil Google (ou só o e-mail, no login por código).</li>
    <li><b>Suas leituras:</b> livros, sessões de leitura, notas, grifos, cards, revisões, metas e conquistas que você registra.</li>
    <li><b>Fotos de páginas:</b> são lidas no próprio aparelho para extrair o texto grifado e <b>não são enviadas</b> nem guardadas.</li>
    <li><b>Erros do app:</b> mensagem técnica, tela e navegador, para corrigirmos falhas. Não inclui suas notas.</li>
  </ul>
  <h3>Para que usamos</h3>
  <ul>
    <li>Guardar e sincronizar seus dados entre seus aparelhos.</li>
    <li>Mostrar estatísticas, metas e conquistas para você.</li>
    <li>Recursos opcionais: perfil público e clubes (só o que você escolher mostrar) e IA (apenas quando você pede).</li>
  </ul>
  <h3>Com quem compartilhamos</h3>
  <ul>
    <li><b>Supabase:</b> hospeda o banco de dados e o login.</li>
    <li><b>Google:</b> login com sua conta Google.</li>
    <li><b>Anthropic (Claude):</b> quando você usa a IA, o texto das notas envolvidas é enviado para gerar a resposta. A Anthropic não usa esses dados para treinar modelos pela API.</li>
    <li><b>Stripe:</b> pagamentos do Grifo Plus, se você assinar.</li>
    <li><b>Cloudflare Turnstile:</b> verificação anti-robô no login por e-mail.</li>
    <li><b>Buscas de livros:</b> o título ou ISBN pesquisado é enviado à BrasilAPI, Google Livros e Open Library.</li>
    <li><b>Dicionário:</b> a palavra procurada (só a palavra, sem o texto em volta) é enviada ao Wikcionário, ao Dicionário Aberto e à Free Dictionary API.</li>
  </ul>
  <p>Não vendemos seus dados e não usamos publicidade.</p>
  <h3>O que é público</h3>
  <p>Nada, a menos que você ative o perfil público. Nele aparecem só nome, foto, nível, metas, temas e títulos de livros. Notas e grifos nunca são publicados. Colegas de clube veem seu nome e suas páginas da semana.</p>
  <h3>Seus direitos (LGPD)</h3>
  <p>Você pode acessar, baixar, corrigir e apagar seus dados a qualquer momento em <b>Conta → Seus dados</b>. Ao excluir a conta, tudo é apagado definitivamente dos nossos servidores. Dúvidas: ${contactLine()}.</p>
  </article>`;
}

function termsView() {
  return `${legalBack()}<article class="card legal">
  <h2>Termos de uso</h2>
  <p class="small muted">Atualizados em 24/10/2026</p>
  <ul>
    <li>O Grifo organiza suas leituras pessoais. Você é responsável pelo conteúdo que registra e compartilha.</li>
    <li>Trechos de livros são para seu estudo pessoal; ao compartilhar citações, respeite os direitos dos autores (citações curtas, com a fonte).</li>
    <li>O plano grátis pode ter limites. O Grifo Plus é uma assinatura que você pode cancelar quando quiser; o acesso continua até o fim do período pago.</li>
    <li>A IA pode errar: confira respostas, cards e correções antes de confiar nelas.</li>
    <li>Podemos suspender contas usadas para abuso (spam, automação, tentativa de acesso a dados de outros).</li>
    <li>O serviço é oferecido “como está”. Faça backups (Conta → Baixar meus dados).</li>
    <li>Contato: ${contactLine()}.</li>
  </ul>
  <p><a href="#/privacidade">Leia também a Política de privacidade</a>.</p>
  </article>`;
}

// ---------------- modais ----------------
function datalist(id, values) {
  return `<datalist id="${id}">${[...new Set(values)].filter(Boolean).sort((a, b) => a.localeCompare(b)).map((v) => `<option value="${esc(v)}">`).join('')}</datalist>`;
}
const themeOptions = () => [...Object.keys(THEMES), ...sources().map((b) => b.genre)];
function subthemeOptions(theme) {
  const k = norm(theme);
  const preset = Object.entries(THEMES).find(([t]) => norm(t) === k)?.[1] || [];
  return [...preset, ...sources().filter((b) => norm(b.genre) === k).map((b) => b.subtheme)];
}

function starInput(value) {
  return `<div class="stars-input">${[5, 4, 3, 2, 1].map((v) => `<input type="radio" name="rating" id="r${v}" value="${v}" ${value === v ? 'checked' : ''}><label for="r${v}" title="${v}">★</label>`).join('')}</div>`;
}

function bookForm(existing, opts = {}) {
  const b = existing || { status: 'reading', startDate: G.ymd(), purpose: 'hobby' };
  openModal(`<form class="form" id="book-form">
    <h3>${existing ? 'Editar livro' : 'Novo livro'}</h3>
    <div class="row gap-s">
      <input name="lookup" class="grow" placeholder="Buscar título ou ISBN para preencher…" autocomplete="off">
      <button type="button" class="btn" id="lookup-btn" aria-label="Buscar">🔎</button>
      <button type="button" class="btn" id="scan-btn" aria-label="Ler código de barras" title="Ler código de barras do livro">▥</button>
    </div>
    <div id="scan-box" class="scan-box" hidden>
      <video id="scan-video" muted playsinline></video>
      <div class="scan-frame"></div>
      <div class="row between gap-s wrap">
        <span class="small" id="scan-status">Aponte para o código de barras no verso do livro.</span>
        <span class="row gap-s"><button type="button" class="btn small" id="scan-photo">🖼️ Usar foto</button><button type="button" class="btn small ghost" id="scan-cancel">Cancelar</button></span>
      </div>
      <input type="file" accept="image/*" hidden id="scan-file">
    </div>
    <div id="lookup-results"></div>
    <label>Título* <input name="title" required value="${esc(b.title)}"></label>
    <label>Autor <input name="author" value="${esc(b.author)}"></label>
    <label>Finalidade
      <div class="radio-pills">${Object.entries(PURPOSE).map(([k, p]) => `<input type="radio" name="purpose" id="pp-${k}" value="${k}" ${(b.purpose || 'hobby') === k ? 'checked' : ''}><label for="pp-${k}">${p.icon} ${p.label}</label>`).join('')}</div>
    </label>
    <div class="grid2">
      <label>Tema <input name="genre" list="themes" value="${esc(b.genre)}" placeholder="ex: Informática" autocomplete="off">${datalist('themes', themeOptions())}</label>
      <label>Subtema <input name="subtheme" list="subthemes" value="${esc(b.subtheme)}" placeholder="ex: Banco de dados" autocomplete="off"><span id="subthemes-wrap">${datalist('subthemes', subthemeOptions(b.genre))}</span></label>
    </div>
    <div class="grid2">
      <label>Páginas* <input name="pages" type="number" min="1" required value="${b.pages || ''}"></label>
      <label>Situação <select name="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${b.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    </div>
    <div class="grid2">
      <label>Página atual <input name="currentPage" type="number" min="0" value="${b.currentPage || 0}"></label>
      <label>ISBN <input name="isbn" value="${esc(b.isbn)}" inputmode="numeric"></label>
    </div>
    <div class="grid2">
      <label>Início <input name="startDate" type="date" value="${b.startDate || ''}"></label>
      <label>Término <input name="endDate" type="date" value="${b.endDate || ''}"></label>
    </div>
    <label>Avaliação ${starInput(b.rating)}</label>
    <div class="cover-pick">
      <span id="cover-prev">${cover({ title: '?', ...b }, 'sm')}</span>
      <div class="grow">
        <div class="cover-pick-label">Capa</div>
        <div class="row gap-s wrap">
          <button type="button" class="btn small" id="cover-cam">📷 Fotografar capa</button>
          <button type="button" class="btn small" id="cover-upload">🖼️ Da galeria</button>
          <button type="button" class="btn small ghost" id="cover-clear"${b.cover ? '' : ' hidden'}>✕ Remover</button>
        </div>
        <input type="file" id="cover-file" accept="image/*" hidden>
        <input type="file" id="cover-camfile" accept="image/*" capture="environment" hidden>
        <input name="cover" type="hidden" value="${esc(b.cover || '')}">
        <input id="cover-url" type="url" placeholder="ou cole o link de uma imagem" value="${b.cover?.startsWith('data:') ? '' : esc(b.cover || '')}">
      </div>
    </div>
    <div class="actions"><button type="button" class="btn ghost" data-action="close">Cancelar</button><button class="btn primary">Salvar</button></div>
  </form>`, (root) => {
    const form = $('#book-form', root);
    const results = $('#lookup-results', root);
    // Capa: da busca, de um link colado ou de uma foto (reduzida aqui no aparelho)
    const setCover = (src) => {
      form.cover.value = src;
      if (!src.startsWith('data:') && $('#cover-url', root).value.trim() !== src) $('#cover-url', root).value = src;
      if (src.startsWith('data:')) $('#cover-url', root).value = '';
      $('#cover-prev', root).innerHTML = cover({ ...b, title: form.title.value || b.title || '?', cover: src }, 'sm');
      $('#cover-clear', root).hidden = !src;
    };
    $('#cover-url', root).oninput = (e) => setCover(e.target.value.trim());
    $('#cover-clear', root).onclick = () => setCover('');
    $('#cover-upload', root).onclick = () => $('#cover-file', root).click();
    $('#cover-cam', root).onclick = () => $('#cover-camfile', root).click();
    const onCoverFile = async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try { setCover(await coverFromFile(f)); } catch { toast('Não consegui abrir essa imagem.'); }
    };
    $('#cover-file', root).onchange = onCoverFile;
    $('#cover-camfile', root).onchange = onCoverFile;
    form.genre.oninput = () => { $('#subthemes-wrap', root).innerHTML = datalist('subthemes', subthemeOptions(form.genre.value)); };
    let found = [];
    const doLookup = async () => {
      const q = form.lookup.value.trim();
      if (!q) return;
      results.innerHTML = '<p class="small muted">Buscando…</p>';
      const res = await searchBooks(q);
      found = res.items;
      const quotaMsg = res.quota
        ? '<br>⚠️ O Google Livros atingiu o limite gratuito compartilhado de hoje. Cadastre sua chave grátis em <a href="#/ajustes">Ajustes</a> para buscar sem limite.'
        : '';
      if (found.length) {
        results.innerHTML = `<div class="lookup">${found.map((r, i) => `<button type="button" class="lookup-item" data-i="${i}">
            ${r.cover ? `<img src="${esc(r.cover)}" alt="" referrerpolicy="no-referrer">` : '<span class="cover ph sm">📖</span>'}
            <span><b>${esc(r.title)}</b><br><small>${esc(r.author)}${r.pages ? ` · ${r.pages} pág.` : ''}</small></span></button>`).join('')}</div>`;
      } else if (res.offline && !res.quota) {
        results.innerHTML = '<p class="small muted">Sem conexão para buscar. Preencha manualmente.</p>';
      } else if (res.isbn) {
        form.isbn.value = res.isbn;
        results.innerHTML = `<p class="small muted">O ISBN ${esc(res.isbn)} não está cadastrado nas bases públicas consultadas (BrasilAPI/CBL, Google Livros e Open Library). Isso é comum em edições brasileiras pouco catalogadas. Tente buscar pelo <b>título</b> ou preencha manualmente; o ISBN já foi colocado no campo.${quotaMsg}</p>`;
      } else {
        results.innerHTML = `<p class="small muted">Nada encontrado. Tente outras palavras do título ou preencha manualmente.${quotaMsg}</p>`;
      }
    };
    $('#lookup-btn', root).onclick = doLookup;
    form.lookup.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); doLookup(); } };

    // código de barras: câmera ao vivo, ou foto quando não há câmera/permissão
    const scanBox = $('#scan-box', root), scanStatus = $('#scan-status', root), scanFile = $('#scan-file', root);
    let stopCamera = null;
    const closeScan = () => { stopCamera?.(); stopCamera = null; scanBox.hidden = true; };
    const gotIsbn = (isbn) => {
      closeScan();
      form.lookup.value = isbn;
      form.isbn.value = isbn;
      toast(`📚 ISBN ${isbn} lido`);
      doLookup();
    };
    const openScan = async () => {
      scanBox.hidden = false;
      if (!Scanner.cameraAvailable()) { scanStatus.textContent = 'Câmera indisponível aqui. Use uma foto do código de barras.'; return; }
      scanStatus.textContent = 'Abrindo a câmera…';
      try {
        stopCamera = await Scanner.startCamera($('#scan-video', root), gotIsbn);
        scanStatus.textContent = 'Aponte para o código de barras no verso do livro.';
      } catch {
        scanStatus.textContent = 'Sem acesso à câmera. Use uma foto do código de barras.';
      }
    };
    $('#scan-btn', root).onclick = openScan;
    $('#scan-cancel', root).onclick = closeScan;
    $('#scan-photo', root).onclick = () => { scanFile.value = ''; scanFile.click(); };
    scanFile.onchange = async () => {
      const f = scanFile.files[0];
      if (!f) return;
      scanStatus.textContent = 'Lendo a foto…';
      try {
        const isbn = await Scanner.scanImage(f);
        if (isbn) gotIsbn(isbn);
        else scanStatus.textContent = 'Não achei um ISBN nessa foto. Tente mais perto e com o código reto.';
      } catch {
        scanStatus.textContent = 'Não consegui ler a foto.';
      }
    };
    modal.addEventListener('close', closeScan, { once: true });
    if (opts.scan) openScan();
    results.onclick = (e) => {
      const item = e.target.closest('.lookup-item');
      if (!item) return;
      const r = found[item.dataset.i];
      for (const k of ['title', 'author', 'pages', 'isbn']) if (r[k]) form[k].value = r[k];
      if (r.cover) setCover(r.cover);
      if (r.category && !form.subtheme.value) form.subtheme.value = r.category;
      results.innerHTML = '';
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(form));
      const book = existing ? { ...existing } : { id: uid(), createdAt: Date.now() };
      Object.assign(book, {
        title: fd.title.trim(), author: fd.author.trim(), pages: Number(fd.pages) || 0,
        purpose: fd.purpose || 'hobby', genre: fd.genre.trim(), subtheme: fd.subtheme.trim(),
        status: fd.status, currentPage: Math.min(Number(fd.currentPage) || 0, Number(fd.pages) || Infinity),
        startDate: fd.startDate, endDate: fd.endDate, rating: Number(fd.rating) || 0, isbn: fd.isbn.trim(), cover: fd.cover.trim(),
      });
      if (book.status === 'finished') { book.currentPage = book.pages; book.endDate ||= G.ymd(); }
      if (book.status === 'reading') book.startDate ||= G.ymd();
      closeModal();
      await commit(() => persist('books', book));
      const onboardingNow = onbStep >= 2 && !state.settings.onboarded;
      if (!existing && !onboardingNow) location.hash = `#/livro/${book.id}`;
    };
  });
}

// Foto da capa → JPEG pequeno (até 320×480) guardado no próprio livro, para caber na sincronização
async function coverFromFile(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 320 / bmp.width, 480 / bmp.height);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c.toDataURL('image/jpeg', 0.8);
}

// Busca em várias bases, da mais forte para livros brasileiros até a mais genérica.
// Devolve { items, isbn, quota, offline } para a tela explicar por que não achou.
async function searchBooks(q) {
  const isbn = q.replace(/[-\s.]/g, '').toUpperCase();
  const isIsbn = /^(\d{9}[\dX]|\d{13})$/.test(isbn);
  const out = { items: [], isbn: isIsbn ? isbn : '', quota: false, offline: false };
  const get = async (url) => {
    try {
      const r = await fetch(url);
      if (r.status === 429) { out.quota = true; return null; }
      return r.ok ? r.json() : null;
    } catch {
      out.offline = true;
      return null;
    }
  };

  // 1) BrasilAPI: junta CBL, Mercado Editorial, Google e Open Library (bom para livros nacionais)
  if (isIsbn) {
    const v = await get(`https://brasilapi.com.br/api/isbn/v1/${isbn}`);
    if (v?.title) {
      out.items.push({
        title: [v.title, v.subtitle].filter(Boolean).join(': '), author: (v.authors || []).join(', '),
        pages: v.page_count || '', category: (v.subjects || [])[0] || '', isbn: v.isbn || isbn, cover: v.cover_url || '',
      });
      return out;
    }
  }

  // 2) Google Livros (com a chave do usuário, se houver, para não cair no limite compartilhado)
  const key = state.settings.googleKey ? `&key=${encodeURIComponent(state.settings.googleKey)}` : '';
  const g = await get(`https://www.googleapis.com/books/v1/volumes?maxResults=6&q=${encodeURIComponent(isIsbn ? `isbn:${isbn}` : q)}${key}`);
  out.items = (g?.items || []).map(({ volumeInfo: v }) => ({
    title: [v.title, v.subtitle].filter(Boolean).join(': '),
    author: (v.authors || []).join(', '),
    pages: v.pageCount || '',
    category: (v.categories || [])[0] || '',
    isbn: ((v.industryIdentifiers || []).find((i) => i.type === 'ISBN_13') || (v.industryIdentifiers || [])[0] || {}).identifier || '',
    cover: (v.imageLinks?.thumbnail || '').replace('http://', 'https://'),
  }));
  if (out.items.length) return out;

  // 3) Open Library
  const o = await get(`https://openlibrary.org/search.json?limit=6&fields=title,author_name,number_of_pages_median,cover_i,isbn&${isIsbn ? `isbn=${isbn}` : `q=${encodeURIComponent(q)}`}`);
  out.items = (o?.docs || []).map((d) => ({
    title: d.title, author: (d.author_name || []).join(', '), pages: d.number_of_pages_median || '', category: '',
    isbn: (d.isbn || [])[0] || '', cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : '',
  }));
  return out;
}

function logForm(b, { minutes } = {}) {
  const cur = b.currentPage || 0;
  openModal(`<form class="form" id="log-form">
    <h3>📖 Registrar leitura</h3>
    <p class="muted small">${esc(b.title)} · você está na pág. ${cur}${b.pages ? ` de ${b.pages}` : ''}</p>
    <label>Parei na página <input name="toPage" type="number" min="${cur + 1}" ${b.pages ? `max="${b.pages}"` : ''} value="${Math.min(cur + 10, b.pages || cur + 10)}" required autofocus></label>
    <p class="small" id="log-hint"></p>
    <div class="grid2">
      <label>Data <input name="date" type="date" value="${G.ymd()}" max="${G.ymd()}" required></label>
      <label>Minutos (opcional) <input name="minutes" type="number" min="0" placeholder="ex: 30" value="${minutes || ''}"></label>
    </div>
    <div class="actions"><button type="button" class="btn ghost" data-action="close">Cancelar</button><button class="btn primary">Salvar</button></div>
  </form>`, (root) => {
    const form = $('#log-form', root);
    const hint = $('#log-hint', root);
    const upd = () => {
      const n = (Number(form.toPage.value) || 0) - cur;
      hint.innerHTML = n > 0 ? `= <b>${n} páginas</b> lidas · +${n} XP${b.pages && Number(form.toPage.value) >= b.pages ? ' · 🏁 fim do livro!' : ''}` : '';
    };
    form.toPage.oninput = upd;
    upd();
    form.toPage.select();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(form));
      const to = Math.min(Number(fd.toPage), b.pages || Infinity);
      const pages = to - cur;
      if (pages <= 0) return toast(`Informe uma página maior que ${cur}.`, 'err');
      const session = { id: uid(), bookId: b.id, date: fd.date, pages, fromPage: cur, toPage: to, minutes: Number(fd.minutes) || 0, createdAt: Date.now() };
      const book = { ...b, currentPage: to };
      if (book.status !== 'reading') { book.status = 'reading'; book.startDate ||= fd.date; }
      closeModal();
      await commit(async () => { await persist('sessions', session); await persist('books', book); });
      if (book.pages && to >= book.pages) finishForm(book, fd.date);
    };
  });
}

function finishForm(b, date = G.ymd()) {
  openModal(`<form class="form" id="finish-form">
    <h3>🎉 Você terminou “${esc(b.title)}”!</h3>
    <p class="muted small">Marque como lido para ganhar +${G.XP.book} XP.</p>
    <label>Avaliação ${starInput(b.rating)}</label>
    <label>Data de término <input name="endDate" type="date" value="${b.endDate || date}" required></label>
    <label>O que achou? (opcional) <textarea name="review" rows="3" placeholder="Uma frase sobre o livro…">${esc(b.review)}</textarea></label>
    <div class="actions"><button type="button" class="btn ghost" data-action="close">Agora não</button><button class="btn primary">Concluir livro</button></div>
  </form>`, (root) => {
    const form = $('#finish-form', root);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(form));
      const book = { ...bookById(b.id), status: 'finished', endDate: fd.endDate, rating: Number(fd.rating) || 0, review: fd.review.trim() };
      book.currentPage = book.pages;
      closeModal();
      await commit(() => persist('books', book));
      confetti();
    };
  });
}

// Autocompletar [[ ]] no campo de texto da nota
function linkCandidates() {
  const list = new Map();
  const put = (label, icon, hint) => { if (label && !list.has(norm(label))) list.set(norm(label), { label: label.trim(), icon, hint }); };
  state.books.forEach((b) => put(b.title, '📘', 'livro'));
  state.notes.forEach((n) => put(noteTitle(n), '✍️', 'nota'));
  state.books.forEach((b) => { put(b.genre, '🏷️', 'tema'); put(b.subtheme, '🏷️', 'subtema'); });
  state.notes.forEach((n) => linksOf(n.text).forEach((l) => put(l, '💡', 'conceito')));
  return [...list.values()];
}

function attachLinkAutocomplete(ta, box) {
  const all = linkCandidates();
  let current = [];
  let match = null;
  const update = () => {
    const pos = ta.selectionStart;
    match = ta.value.slice(0, pos).match(/\[\[([^[\]\n]*)$/);
    if (!match) { box.hidden = true; return; }
    const q = norm(match[1]);
    current = all.filter((c) => norm(c.label).includes(q)).slice(0, 7);
    if (q && !current.some((c) => norm(c.label) === q)) current.push({ label: match[1].trim(), icon: '➕', hint: 'novo conceito' });
    if (!current.length) { box.hidden = true; return; }
    box.innerHTML = current.map((c, i) => `<button type="button" data-i="${i}">${c.icon} ${esc(c.label)} <small>${c.hint}</small></button>`).join('');
    box.hidden = false;
  };
  ta.addEventListener('input', update);
  ta.addEventListener('click', update);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !box.hidden) { e.preventDefault(); e.stopPropagation(); box.hidden = true; } });
  box.addEventListener('mousedown', (e) => e.preventDefault());
  box.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || !match) return;
    const c = current[btn.dataset.i];
    const pos = ta.selectionStart;
    const start = pos - match[1].length;
    const after = ta.value.slice(pos).replace(/^[^[\]\n]*\]\]/, '');
    ta.value = `${ta.value.slice(0, start)}${c.label}]]${after}`;
    const caret = start + c.label.length + 2;
    ta.focus();
    ta.setSelectionRange(caret, caret);
    box.hidden = true;
  });
  return () => { // insere "[[" no cursor (botão 🔗)
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = ta.value.slice(s, e);
    ta.value = `${ta.value.slice(0, s)}[[${sel}${sel ? ']]' : ''}${ta.value.slice(e)}`;
    const caret = s + 2 + sel.length + (sel ? 2 : 0);
    ta.focus();
    ta.setSelectionRange(caret, caret);
    update();
  };
}

// Recorte antes do OCR: mostra a foto e a pessoa arrasta sobre o trecho que quer ler.
// Devolve a área (frações da foto), null para a foto toda ou false se cancelou.
function attachCropper(root) {
  const box = $('#ocr-crop', root), stage = $('#crop-stage', root), img = $('#crop-img', root), rect = $('#crop-rect', root);
  const go = $('#crop-go', root), cancel = $('#crop-cancel', root);
  let area = null, start = null;
  const draw = () => {
    rect.hidden = !area;
    if (area) Object.assign(rect.style, { left: `${area.x0 * 100}%`, top: `${area.y0 * 100}%`, width: `${(area.x1 - area.x0) * 100}%`, height: `${(area.y1 - area.y0) * 100}%` });
    go.textContent = area ? '🔍 Ler esta área' : '🔍 Ler a foto toda';
  };
  const at = (e) => {
    const r = img.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  stage.onpointerdown = (e) => { e.preventDefault(); stage.setPointerCapture(e.pointerId); start = at(e); area = null; draw(); };
  stage.onpointermove = (e) => {
    if (!start) return;
    const p = at(e);
    area = { x0: Math.min(start.x, p.x), y0: Math.min(start.y, p.y), x1: Math.max(start.x, p.x), y1: Math.max(start.y, p.y) };
    draw();
  };
  stage.onpointerup = stage.onpointercancel = () => {
    start = null;
    if (area && (area.x1 - area.x0 < 0.04 || area.y1 - area.y0 < 0.02)) area = null; // toque sem arrastar
    draw();
  };
  return (file) => new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    img.src = url;
    area = null;
    draw();
    box.hidden = false;
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const done = (v) => { box.hidden = true; URL.revokeObjectURL(url); go.onclick = cancel.onclick = null; resolve(v); };
    go.onclick = () => done(area);
    cancel.onclick = () => done(false);
  });
}

function noteForm(existing, { bookId, autoOCR, link } = {}) {
  if (!state.books.length) {
    toast('Cadastre um livro antes de criar notas.');
    return bookForm();
  }
  const n = existing || { bookId: bookId || state.books.find((b) => b.status === 'reading')?.id, kind: link ? 'thought' : 'quote', source: 'manual', tags: [], text: link ? `[[${link}]] ` : '' };
  const lastPage = n.page ?? bookById(n.bookId)?.currentPage ?? '';
  // (nota de um artigo: o artigo entra na lista para a nota continuar ligada a ele)
  const books = [...state.books, ...state.articles].sort((a, b) => (a.status === 'reading' ? -1 : 0) - (b.status === 'reading' ? -1 : 0) || a.title.localeCompare(b.title));
  openModal(`<form class="form" id="note-form">
    <h3>${existing ? 'Editar nota' : 'Nova nota'}</h3>
    <label>Livro ou artigo ${pickField('bookId', books.map((b) => [b.id, isArticle(b) ? `${b.title} (${tr('artigo')})` : b.title]), bookById(n.bookId) ? n.bookId : '', { all: 'Sem livro (nota solta)', placeholder: 'Digite para buscar…' })}
      <span class="hint">Opcional: deixe sem livro para uma ideia solta.</span></label>
    <div class="ocr-box">
      <div class="radio-pills ocr-mode">
        <input type="radio" name="ocr-mode" id="ocr-m-h" value="highlight" checked><label for="ocr-m-h">🖍️ Só os grifos</label>
        <input type="radio" name="ocr-mode" id="ocr-m-p" value="page"><label for="ocr-m-p">📄 Página inteira</label>
      </div>
      <div class="row gap-s wrap">
        <button type="button" class="btn primary" data-ocr="cam">📷 Câmera</button>
        <button type="button" class="btn" data-ocr="file">🖼️ Galeria</button>
      </div>
      <input type="file" accept="image/*" hidden id="ocr-file">
      <input type="file" accept="image/*" capture="environment" hidden id="ocr-cam">
      <div id="ocr-status" class="small muted">Fotografe a página: o texto grifado vira nota. Funciona com marca-texto colorido e com o grifo cinza do Kindle.</div>
      <div id="ocr-crop" class="ocr-crop" hidden>
        <div class="crop-stage" id="crop-stage"><img id="crop-img" alt="Foto escolhida"><div class="crop-rect" id="crop-rect" hidden></div></div>
        <span class="hint">Arraste o dedo (ou o mouse) sobre a foto para marcar só o trecho que quer ler.</span>
        <div class="row gap-s wrap"><button type="button" class="btn primary" id="crop-go">🔍 Ler a foto toda</button><button type="button" class="btn ghost" id="crop-cancel">Cancelar</button></div>
      </div>
      <button type="button" class="btn small" id="ocr-fix" hidden>✨ Corrigir com IA</button>
      <img id="ocr-preview" alt="Pré-visualização dos trechos detectados" hidden>
    </div>
    <label>Título (opcional) <input name="title" value="${esc(noteTitle(n))}" placeholder="ex: Normalização"><span class="hint">Com título, outras notas podem citar esta com [[título]].</span></label>
    <label>Texto
      <div class="textarea-wrap">
        <textarea name="text" rows="6" required placeholder="Escreva sua reflexão ou cole a citação… Use [[ ]] para conectar ideias.">${esc(n.text)}</textarea>
        <div class="suggest" id="link-suggest" hidden></div>
      </div>
      <div class="note-preview" id="note-preview" hidden><span class="note-preview-label">Como vai ficar</span><div class="note-text"></div></div>
      <div class="row between"><span class="hint">Digite [[ para ligar a um livro, nota ou conceito.</span><button type="button" class="btn small ghost" id="insert-link">🔗 Ligar</button></div>
    </label>
    <div class="grid2">
      <label>Página <input name="page" type="number" min="0" value="${lastPage}"></label>
      <label>Tipo <select name="kind"><option value="quote" ${n.kind === 'quote' ? 'selected' : ''}>Citação</option><option value="thought" ${n.kind === 'thought' ? 'selected' : ''}>Reflexão</option></select></label>
    </div>
    <label>Tags <input name="tags" value="${esc((n.tags || []).join('; '))}" placeholder="ex: normalização; sql; banco de dados"><span class="hint">Separe várias tags com ponto e vírgula (;) ou vírgula.</span></label>
    ${existing ? '' : '<label class="check"><input type="checkbox" name="makeCard"> Criar um card de memorização em seguida</label>'}
    <input type="hidden" name="source" value="${n.source}">
    <div class="actions"><button type="button" class="btn ghost" data-action="close">Cancelar</button><button class="btn primary">Salvar</button></div>
  </form>`, (root) => {
    const form = $('#note-form', root);
    const file = $('#ocr-file', root);
    const status = $('#ocr-status', root);
    const img = $('#ocr-preview', root);
    const btns = root.querySelectorAll('[data-ocr]');
    $('#insert-link', root).onclick = attachLinkAutocomplete(form.text, $('#link-suggest', root));
    // com [[ligações]] no texto, mostra a nota já formatada (os colchetes somem na leitura)
    const preview = $('#note-preview', root);
    const showPreview = () => {
      preview.hidden = !linksOf(form.text.value).length;
      if (!preview.hidden) preview.lastElementChild.innerHTML = renderText(form.text.value);
    };
    form.text.addEventListener('input', showPreview);
    showPreview();
    let mode = 'highlight';
    const cam = $('#ocr-cam', root);
    btns.forEach((btn) => {
      btn.onclick = () => {
        mode = root.querySelector('[name="ocr-mode"]:checked')?.value || 'highlight';
        const input = btn.dataset.ocr === 'cam' ? cam : file;
        input.value = '';
        input.click();
      };
    });
    // a IA corrige erros de leitura do trecho recém-lido (foto tremida, pequena, com sombra)
    const fixBtn = $('#ocr-fix', root);
    let lastOcr = '';
    fixBtn.onclick = async () => {
      fixBtn.disabled = true;
      fixBtn.textContent = '✨ Corrigindo…';
      try {
        const { text } = await aiRun('fixocr', { text: lastOcr, book: bookById(form.bookId.value)?.title || '' });
        if (text) {
          form.text.value = form.text.value.includes(lastOcr) ? form.text.value.replace(lastOcr, text) : text;
          lastOcr = text;
          status.textContent = '✨ Texto corrigido pela IA. Confira antes de salvar.';
        }
      } catch (e) {
        if (e.message) toast(esc(e.message), 'err');
      }
      fixBtn.disabled = false;
      fixBtn.textContent = '✨ Corrigir com IA';
    };
    const chooseArea = attachCropper(root);
    const onPhoto = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      btns.forEach((x) => { x.disabled = true; });
      try {
        const area = await chooseArea(f);
        if (area === false) return; // cancelou
        const r = await runOCR(f, mode, (msg, p) => { status.textContent = `${msg}…${p != null ? ` ${Math.round(p * 100)}%` : ''}`; }, { crop: area || undefined });
        img.src = r.preview;
        img.hidden = false;
        if (!r.text) {
          status.textContent = mode === 'highlight' && !r.regions
            ? 'Nenhum grifo encontrado. Tente com mais luz, a página reta e mais perto, ou use "Página inteira".'
            : 'Não consegui ler texto nessa imagem. Tente uma foto mais nítida.';
        } else {
          form.text.value = form.text.value.trim() ? `${form.text.value.trim()}\n\n${r.text}` : r.text;
          form.source.value = 'ocr';
          form.kind.value = 'quote';
          status.textContent = `✔ ${r.regions ? `${r.regions} trecho(s) grifado(s) lido(s)` : 'Texto lido'} — revise e corrija antes de salvar.`;
          lastOcr = r.text;
          fixBtn.hidden = false;
        }
      } catch (err) {
        status.textContent = `Erro no OCR: ${err.message}`;
      } finally {
        btns.forEach((x) => { x.disabled = false; });
      }
    };
    file.onchange = onPhoto;
    cam.onchange = onPhoto;
    form.bookId.onchange = () => { if (!existing) form.page.value = bookById(form.bookId.value)?.currentPage || ''; };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(form));
      const note = existing ? { ...existing } : { id: uid(), createdAt: Date.now() };
      Object.assign(note, {
        bookId: fd.bookId || null, title: plainText(fd.title).trim(), text: fd.text.trim(), page: Number(fd.page) || null, kind: fd.kind, source: fd.source,
        tags: splitTags(fd.tags), updatedAt: Date.now(),
      });
      closeModal();
      await commit(() => persist('notes', note));
      if (fd.makeCard) cardForm({ note });
    };
    if (autoOCR) btns[0].click();
    else if (link) { form.text.focus(); form.text.setSelectionRange(form.text.value.length, form.text.value.length); }
  });
}

function cardForm({ note, card }) {
  const n = note || noteById(card?.noteId);
  const plain = (n?.text || '').replace(LINK_RE, (m, x) => x.split('|').pop());
  const c = card || {
    type: 'cloze',
    front: plain,
    back: plain,
    qaFront: n?.title ? `O que é ${noteTitle(n)}?` : '',
  };
  openModal(`<form class="form" id="card-form">
    <h3>🧠 ${card ? 'Editar card' : 'Novo card de memorização'}</h3>
    ${n ? `<p class="small muted" style="margin:0">De: ${esc(noteLabel(n))}</p>` : ''}
    <div class="radio-pills">
      <input type="radio" name="type" id="ct-cloze" value="cloze" ${c.type === 'cloze' ? 'checked' : ''}><label for="ct-cloze">▭ Lacuna</label>
      <input type="radio" name="type" id="ct-qa" value="qa" ${c.type === 'qa' ? 'checked' : ''}><label for="ct-qa">❓ Pergunta e resposta</label>
    </div>
    <div id="cloze-fields">
      <label>Texto com lacunas
        <textarea name="cloze" rows="5">${esc(c.type === 'cloze' ? c.front : plain)}</textarea>
      </label>
      <div class="row between wrap gap-s"><span class="hint">Selecione palavras-chave e toque em “Ocultar”. Elas ficam entre {{ }}.</span>
        <button type="button" class="btn small" id="hide-sel">▭ Ocultar seleção</button></div>
    </div>
    <div id="qa-fields">
      <label>Pergunta (frente) <textarea name="front" rows="2" placeholder="ex: Quais são as formas normais?">${esc(c.type === 'qa' ? c.front : c.qaFront || '')}</textarea></label>
      <label>Resposta (verso) <textarea name="back" rows="4">${esc(c.type === 'qa' ? c.back : plain)}</textarea></label>
    </div>
    <div class="card" style="margin:0"><div class="small muted">Prévia</div><div id="card-preview" class="review-q"></div></div>
    <div class="actions"><button type="button" class="btn ghost" data-action="close">Cancelar</button><button class="btn primary">Salvar card</button></div>
  </form>`, (root) => {
    const form = $('#card-form', root);
    const preview = $('#card-preview', root);
    const sync = () => {
      const t = form.type.value;
      $('#cloze-fields', root).hidden = t !== 'cloze';
      $('#qa-fields', root).hidden = t !== 'qa';
      preview.innerHTML = t === 'cloze'
        ? (/\{\{.+?\}\}/.test(form.cloze.value) ? cardFace({ type: 'cloze', front: form.cloze.value }, false) : '<span class="muted">Oculte ao menos uma palavra.</span>')
        : esc(form.front.value || '…');
    };
    form.addEventListener('input', sync);
    form.addEventListener('change', sync);
    $('#hide-sel', root).onclick = () => {
      const ta = form.cloze;
      const s = ta.selectionStart, e = ta.selectionEnd;
      if (s === e) return toast('Selecione uma palavra ou trecho primeiro.');
      ta.value = `${ta.value.slice(0, s)}{{${ta.value.slice(s, e)}}}${ta.value.slice(e)}`;
      ta.focus();
      sync();
    };
    sync();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(form));
      let fields;
      if (fd.type === 'cloze') {
        if (!/\{\{.+?\}\}/.test(fd.cloze)) return toast('Oculte ao menos uma palavra com “Ocultar seleção”.', 'err');
        fields = { type: 'cloze', front: fd.cloze.trim(), back: '' };
      } else {
        if (!fd.front.trim() || !fd.back.trim()) return toast('Preencha pergunta e resposta.', 'err');
        fields = { type: 'qa', front: fd.front.trim(), back: fd.back.trim() };
      }
      const saved = card ? { ...card, ...fields } : S.newCard({ id: uid(), noteId: n?.id || null, bookId: n?.bookId || null, createdAt: Date.now(), ...fields }, G.ymd());
      closeModal();
      await commit(() => persist('cards', saved));
      if (!card) toast('Card criado. Ele aparece hoje em “Revisar”.');
    };
  });
}

// ---------------- estúdio de artes para Instagram ----------------
const FORMATS = [{ id: 'story', label: '📱 Stories 9:16' }, { id: 'feed', label: '🖼️ Feed 4:5' }];

function canvasFile(c, name) {
  return new Promise((resolve) => c.toBlob((b) => resolve(new File([b], name, { type: 'image/png' })), 'image/png'));
}

const exportPlus = () => {
  if (isPlus()) return true;
  toast('⭐ Exportar para outros apps faz parte do Grifo Plus · <u>conhecer</u>', 'gold', () => { location.hash = '#/plus'; });
  return false;
};
const exportActions = {
  async exportMarkdown() {
    if (!exportPlus()) return;
    toast('📦 Preparando os arquivos…');
    try {
      const E = await import('./export.js');
      const data = { books: state.books, articles: state.articles, notes: state.notes };
      const files = [...E.markdownFiles(data), { path: 'Grifo - livros e artigos.csv', content: E.booksCsv(data) }];
      downloadFile(new File([await E.zip(files)], `grifo-${G.ymd()}.zip`, { type: 'application/zip' }));
      Cloud.track('export', { to: 'markdown' });
    } catch (e) { toast(`Não foi possível exportar: ${esc(e.message)}`, 'err'); }
  },
  async exportAnki() {
    if (!exportPlus()) return;
    if (!state.cards.length) { toast('Você ainda não tem cards para levar ao Anki.'); return; }
    const E = await import('./export.js');
    downloadFile(new File([E.ankiText({ books: state.books, articles: state.articles, cards: state.cards })], `grifo-anki-${G.ymd()}.txt`, { type: 'text/plain' }));
    Cloud.track('export', { to: 'anki' });
  },
};

function downloadFile(file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// Pré-visualiza a(s) arte(s), troca estilo/formato e compartilha (Instagram, WhatsApp…) ou baixa
// Texto que acompanha a arte: com conta, leva o link de convite; sem conta, o endereço do app
async function shareText(text) {
  let link = Cloud.siteUrl();
  try { const inv = await Cloud.myInvite(); if (inv?.code) link = Cloud.inviteLink(inv.code); } catch { /* sem convite: endereço simples */ }
  return `${text ? `${tr(text)}\n` : ''}${tr('Feito com Grifo:')} ${link}`;
}

function shareStudio({ title, groups = [], render, filename = 'grifo', text = '', photo = false }) {
  if (isPlus()) groups = [...groups, { key: 'brand', options: [{ id: 'on', label: '🏷️ Com marca Grifo' }, { id: 'off', label: 'Só minha assinatura' }] }];
  const renderArt = render;
  render = (v, p) => { Share.prefs.brand = v.brand !== 'off'; return renderArt(v, p); };
  const values = Object.fromEntries(groups.map((g) => [g.key, g.value ?? g.options[0].id]));
  let photoImg = null, canvases = [], token = 0;
  openModal(`<div class="form studio">
    <div class="row between"><h3>${title}</h3><button type="button" class="icon-btn" data-action="close" aria-label="Fechar">✕</button></div>
    ${groups.map((g) => `<div class="radio-pills" data-group="${g.key}">${g.options.map((o) => `<input type="radio" name="sg-${g.key}" id="sg-${g.key}-${o.id}" value="${o.id}" ${values[g.key] === o.id ? 'checked' : ''}><label for="sg-${g.key}-${o.id}">${o.label}</label>`).join('')}</div>`).join('')}
    ${photo ? '<input type="file" accept="image/*" hidden id="studio-photo">' : ''}
    <div class="studio-preview busy" id="studio-preview"><span class="small muted">Desenhando…</span></div>
    <div class="actions"><button type="button" class="btn" id="studio-dl">⬇️ Baixar</button><button type="button" class="btn primary" id="studio-share">📤 Compartilhar</button></div>
    <p class="hint center" style="margin:0">No celular, “Compartilhar” abre Instagram, WhatsApp e outros apps.</p>
  </div>`, (root) => {
    const preview = $('#studio-preview', root);
    const name = (i) => `${filename}${canvases.length > 1 ? `-${i + 1}` : ''}.png`;
    const draw = async () => {
      const my = ++token;
      preview.classList.add('busy');
      try {
        const out = await render(values, photoImg);
        if (my !== token) return;
        canvases = Array.isArray(out) ? out : [out];
        preview.innerHTML = canvases.map((c, i) => `<img src="${c.toDataURL('image/jpeg', 0.85)}" alt="Arte ${i + 1} de ${canvases.length}">`).join('');
        preview.classList.toggle('multi', canvases.length > 1);
      } catch (e) {
        preview.innerHTML = `<p class="small muted">Não consegui gerar a imagem: ${esc(e.message)}</p>`;
      }
      if (my === token) preview.classList.remove('busy');
    };
    root.querySelectorAll('[data-group] input').forEach((inp) => {
      inp.onchange = () => {
        const key = inp.closest('[data-group]').dataset.group;
        const opt = groups.find((g) => g.key === key)?.options.find((o) => o.id === inp.value);
        if (opt?.locked) {
          $(`#sg-${key}-${values[key]}`, root).checked = true;
          toast('⭐ Esse estilo faz parte do Grifo Plus · <u>conhecer</u>', 'gold', () => { location.hash = '#/plus'; });
          return;
        }
        values[key] = inp.value;
        if (photo && inp.value === 'foto' && !photoImg) $('#studio-photo', root).click();
        draw();
      };
    });
    if (photo) {
      $('#studio-photo', root).onchange = async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        photoImg = await createImageBitmap(f);
        draw();
      };
    }
    $('#studio-dl', root).onclick = async () => {
      Cloud.track('share', { kind: filename, via: 'download' });
      for (let i = 0; i < canvases.length; i++) downloadFile(await canvasFile(canvases[i], name(i)));
    };
    $('#studio-share', root).onclick = async () => {
      if (!canvases.length) return;
      const files = await Promise.all(canvases.map((c, i) => canvasFile(c, name(i))));
      Cloud.track('share', { kind: filename, via: 'share' });
      if (navigator.canShare?.({ files })) {
        try {
          await navigator.share({ files, text: await shareText(text) });
        } catch (e) {
          if (e.name !== 'AbortError') toast('Não foi possível compartilhar. Use “Baixar”.', 'err');
        }
      } else {
        files.forEach(downloadFile);
        toast('Imagem salva. Agora é só postar 📲');
      }
    };
    draw();
  });
}


const shareActions = {
  postNote({ id }) {
    const n = noteById(id), b = bookById(n.bookId);
    shareStudio({
      title: '📸 Post da citação', filename: 'citacao', photo: true, text: b ? `${b.title}${b.author ? ` — ${b.author}` : ''}` : '',
      groups: [
        { key: 'style', options: Share.QUOTE_STYLES.map((o) => (Share.PLUS_STYLES.includes(o.id) && !isPlus() ? { ...o, label: `${o.label} 🔒`, locked: true } : o)) },
        { key: 'tone', options: Share.QUOTE_TONES.map((o) => (Share.PLUS_TONES.includes(o.id) && !isPlus() ? { ...o, label: `${o.label} 🔒`, locked: true } : o)) },
        { key: 'format', options: FORMATS },
      ],
      render: (v, photo) => Share.quoteCard({ text: plainText(n.text), title: b?.title || '', author: b?.author, page: n.page, style: v.style, tone: v.tone, format: v.format, handle: state.settings.handle, photo }),
    });
  },
  shareBook({ id }) {
    const b = bookById(id);
    shareStudio({
      title: b.status === 'finished' ? '📸 Terminei!' : '📸 Lendo agora', filename: 'lendo-agora',
      groups: [{ key: 'format', options: FORMATS }],
      render: (v) => Share.readingCard({ book: b, streak: state.stats.streak, format: v.format, handle: state.settings.handle }),
    });
  },
  shareShelf() {
    const year = state.stats.year;
    shareStudio({
      title: '📸 Minha estante', filename: 'minha-estante',
      groups: [
        { key: 'style', options: Share.SHELF_STYLES },
        { key: 'period', options: [{ id: 'year', label: `Lidos em ${year}` }, { id: 'all', label: 'Todos os lidos' }] },
        { key: 'purpose', options: [{ id: 'all', label: 'Tudo' }, ...Object.entries(PURPOSE).map(([k, p]) => ({ id: k, label: `${p.icon} ${p.label}` }))] },
        { key: 'format', options: FORMATS },
      ],
      render: (v) => {
        const books = state.books
          .filter((b) => b.status === 'finished' && (v.period === 'all' || (b.endDate || '').startsWith(year)) && (v.purpose === 'all' || (b.purpose || 'hobby') === v.purpose))
          .sort((a, b) => (a.endDate || '').localeCompare(b.endDate || ''));
        const pages = books.reduce((a, b) => a + (b.pages || 0), 0);
        const pLabel = v.purpose === 'all' ? '' : ` · ${PURPOSE[v.purpose].label}`;
        return Share.shelfCard({
          books, style: v.style, format: v.format, handle: state.settings.handle,
          heading: v.period === 'year' ? `Minha estante ${year}` : 'Minha estante',
          subheading: `${books.length} ${books.length === 1 ? 'livro' : 'livros'} · ${pages.toLocaleString(LOCALE)} páginas${pLabel}`,
        });
      },
    });
  },
  shareWrapped() {
    const monthStart = `${G.ymd().slice(0, 8)}01`;
    const hasMonth = state.sessions.some((s) => s.date >= monthStart) || state.books.some((b) => (b.endDate || '') >= monthStart);
    shareStudio({
      title: '✨ Sua retrospectiva', filename: 'retrospectiva', text: 'Minha retrospectiva de leituras',
      groups: [{ key: 'period', options: Share.PERIODS, value: hasMonth ? 'month' : 'year' }],
      render: (v) => Share.wrappedSlides(state, { period: v.period, name: state.settings.name, handle: state.settings.handle, xp: state.stats.xp, full: isPlus() }),
    });
  },
  shareMap() {
    const api = graphApi;
    if (!api) return;
    shareStudio({
      title: '📸 Minha rede de ideias', filename: 'mapa-mental',
      groups: [{ key: 'format', options: FORMATS, value: 'feed' }],
      render: async (v) => {
        await Share.ensureFonts();
        const [width, height] = Share.SIZES[v.format];
        const st = api.stats();
        return api.snapshot({ width, height, title: 'Minha rede de ideias', subtitle: `${st.books} livros · ${st.themes} temas · ${st.links} conexões`, handle: state.settings.handle, site: Share.siteLabel() });
      },
    });
  },
  shareBadge({ id }) {
    const b = G.BADGES.find((x) => x.id === id);
    shareStudio({
      title: `📸 ${b.name}`, filename: `conquista-${b.id}`,
      groups: [{ key: 'format', options: FORMATS }],
      render: (v) => Share.achievementCard({ icon: b.icon, kicker: 'Conquista desbloqueada', title: b.name, subtitle: b.desc, foot: state.badges[id] ? `em ${fmtDate(state.badges[id])}` : '', format: v.format, handle: state.settings.handle }),
    });
  },
  shareLevel() {
    const s = state.stats, lv = G.levelInfo(s.xp);
    shareStudio({
      title: '📸 Meu nível', filename: `nivel-${lv.level}`,
      groups: [{ key: 'format', options: FORMATS }],
      render: (v) => Share.achievementCard({ icon: '⭐', kicker: `Nível ${lv.level}`, title: lv.title, subtitle: `${nf(s.xp)} XP em leituras, notas e revisões`, foot: `${s.finished} livros · ${nf(s.totalPages)} páginas`, format: v.format, handle: state.settings.handle }),
    });
  },
  shareStreak() {
    const s = state.stats;
    shareStudio({
      title: '📸 Minha sequência', filename: 'sequencia',
      groups: [{ key: 'format', options: FORMATS }],
      render: (v) => Share.achievementCard({ icon: '🔥', kicker: 'Sequência de leitura', title: `${s.streak} dias seguidos`, subtitle: 'lendo todos os dias, sem pular nenhum', foot: `recorde: ${s.longest} dias`, format: v.format, handle: state.settings.handle }),
    });
  },
};

// ---------------- lembretes ----------------
function reminderSupport() {
  if (!('Notification' in window)) return 'Este navegador não mostra notificações. Use “Adicionar ao calendário”.';
  if (Notification.permission === 'denied') return 'As notificações estão bloqueadas para este site nas configurações do navegador.';
  if (pushAvailable()) return 'Com sua conta, o lembrete é enviado pelo servidor e chega mesmo com o app fechado: sequência, cards para revisar ou o seu grifo do dia.';
  return 'Os avisos automáticos funcionam com o app instalado no Android (Chrome), uma vez por dia após o horário. Para garantir, adicione também ao calendário do celular.';
}

const pushAvailable = () => !!(Cloud.user() && CONFIG.vapidPublicKey && 'PushManager' in window && 'serviceWorker' in navigator);
const vapidKey = (b64) => Uint8Array.from(atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function saveReminder(enabled, time) {
  state.settings = { ...state.settings, reminder: { enabled, time } };
  await db.setKV('settings', state.settings);
  if (enabled && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
  const granted = 'Notification' in window && Notification.permission === 'granted';

  // 1) Com conta: notificação enviada pelo servidor (confiável, mesmo com o app fechado)
  if (pushAvailable()) {
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';
      if (enabled && granted) {
        sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey(CONFIG.vapidPublicKey) });
        await Cloud.savePush(sub, { tz, time, enabled: true });
      } else if (sub) {
        await Cloud.savePush(sub, { tz, time, enabled: false });
      }
      await db.setKV('pushActive', enabled && granted, { track: false }); // o service worker não repete o aviso local
      return;
    } catch {
      toast('Não consegui ativar as notificações pelo servidor; usando o aviso do aparelho.', 'err');
    }
  }
  // 2) Sem conta: o navegador acorda o app periodicamente (Chrome no Android, com o app instalado)
  if (!enabled) return;
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg && 'periodicSync' in reg) {
      const perm = await navigator.permissions.query({ name: 'periodic-background-sync' }).catch(() => null);
      if (!perm || perm.state === 'granted') await reg.periodicSync.register('estante-lembrete', { minInterval: 60 * 60 * 1000 });
    }
  } catch { /* sem sincronização periódica: fica o calendário */ }
}

const reminderActions = {
  async testReminder() {
    if (!('Notification' in window)) return toast('Notificações não são suportadas aqui.', 'err');
    if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') return toast('Permita as notificações para testar.', 'err');
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg?.active) reg.active.postMessage('test-reminder');
    else new Notification('🖍️ Grifo', { body: 'As notificações estão funcionando.', icon: 'icons/icon-192.png' });
  },
  calendarReminder() {
    const time = (state.settings.reminder?.time || '20:00').replace(':', '');
    const start = G.addDays(G.ymd(), 1).replace(/-/g, '');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Grifo//Leituras//PT-BR', 'BEGIN:VEVENT',
      `UID:grifo-lembrete-${uid()}`, `DTSTAMP:${stamp}`, `DTSTART:${start}T${time}00`, 'DURATION:PT30M', 'RRULE:FREQ=DAILY',
      'SUMMARY:📚 Hora da leitura', `DESCRIPTION:Leia ${state.settings.dailyGoal} páginas e revise seus cards no Grifo.`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT0M', 'DESCRIPTION:Hora da leitura', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    downloadFile(new File([ics], 'grifo-lembrete.ics', { type: 'text/calendar' }));
    toast('📅 Abra o arquivo para adicionar o lembrete diário ao calendário.');
  },
};

// ---------------- importar Kindle / Goodreads / Skoob ----------------
const findBook = (title, author, isbn) => state.books.find((b) =>
  (isbn && b.isbn && b.isbn.replace(/\D/g, '') === isbn) ||
  (norm(b.title) === norm(title) && (!author || !b.author || norm(b.author) === norm(author))));

function importForm() {
  openModal(`<div class="form" id="imp">
    <div class="row between"><h3>⬆️ Importar</h3><button type="button" class="icon-btn" data-action="close" aria-label="Fechar">✕</button></div>
    <div class="imp-options">
      <button type="button" class="imp-opt" data-kind="kindle"><b>📱 Grifos do Kindle</b><small>Arquivo “My Clippings.txt”, na pasta <i>documents</i> do Kindle ligado ao computador</small></button>
      <button type="button" class="imp-opt" data-kind="goodreads"><b>📗 Goodreads</b><small>My Books → Import and export → Export Library (arquivo CSV)</small></button>
      <button type="button" class="imp-opt" data-kind="csv"><b>📘 Skoob ou planilha</b><small>CSV com colunas como título, autor, páginas, nota, status e data de leitura</small></button>
    </div>
    <input type="file" hidden id="imp-file" accept=".txt,.csv,.tsv,text/plain,text/csv">
    <div id="imp-preview"></div>
  </div>`, (root) => {
    const file = $('#imp-file', root);
    const preview = $('#imp-preview', root);
    let kind = 'csv';
    root.querySelectorAll('.imp-opt').forEach((b) => { b.onclick = () => { kind = b.dataset.kind; file.value = ''; file.click(); }; });
    file.onchange = async () => {
      const f = file.files[0];
      if (!f) return;
      const text = await f.text();
      try {
        if (kind === 'kindle' || /^=+\s*$/m.test(text.slice(0, 5000))) showKindle(Importers.parseKindle(text));
        else showCSV(Importers.booksFromCSV(text));
      } catch (e) {
        preview.innerHTML = `<p class="small" style="color:var(--danger)">Não consegui ler o arquivo: ${esc(e.message)}</p>`;
      }
    };

    function showKindle(books) {
      if (!books.length) { preview.innerHTML = '<p class="small muted">Nenhum grifo encontrado nesse arquivo.</p>'; return; }
      const total = books.reduce((a, b) => a + b.items.length, 0);
      preview.innerHTML = `<p class="small"><b>${total} grifos</b> em ${books.length} livros. Escolha o que importar:</p>
        <div class="imp-list">${books.map((b, i) => {
          const ex = findBook(b.title, b.author);
          const dup = ex ? b.items.filter((it) => state.notes.some((n) => n.bookId === ex.id && n.text === it.text)).length : 0;
          return `<label class="check"><input type="checkbox" data-i="${i}" checked> <span class="grow"><b>${esc(b.title)}</b><br><small class="muted">${esc(b.author)} · ${b.items.length - dup} novos${dup ? ` · ${dup} já importados` : ''} · ${ex ? 'já na estante' : 'livro novo'}</small></span></label>`;
        }).join('')}</div>
        <label>Situação dos livros novos <select id="imp-status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === 'finished' ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <button type="button" class="btn primary block" id="imp-go" style="margin-top:0">Importar grifos</button>`;
      $('#imp-go', root).onclick = async () => {
        const status = $('#imp-status', root).value;
        const chosen = [...root.querySelectorAll('.imp-list input:checked')].map((c) => books[c.dataset.i]);
        let nb = 0, nn = 0;
        closeModal();
        await commit(async () => {
          const newBooks = [], newNotes = [];
          for (const k of chosen) {
            let b = findBook(k.title, k.author);
            if (!b) {
              b = { id: uid(), createdAt: Date.now(), title: k.title, author: k.author, pages: 0, purpose: 'hobby', genre: '', subtheme: '', status, currentPage: 0, startDate: '', endDate: status === 'finished' ? G.ymd() : '', rating: 0, isbn: '', cover: '' };
              newBooks.push(b);
              state.books.push(b);
              nb++;
            }
            k.items.forEach((it, j) => {
              if (state.notes.some((n) => n.bookId === b.id && n.text === it.text)) return;
              const n = { id: uid(), bookId: b.id, title: '', text: it.text, page: it.page, kind: it.kind, source: 'kindle', tags: ['kindle'], createdAt: Date.now() + j };
              newNotes.push(n);
              state.notes.push(n);
              nn++;
            });
          }
          await db.bulkPut('books', newBooks);
          await db.bulkPut('notes', newNotes);
        });
        toast(`📱 ${nn} grifos importados${nb ? ` e ${nb} livros criados` : ''}.`);
      };
    }

    function showCSV({ books, source, columns }) {
      if (!books.length) { preview.innerHTML = '<p class="small muted">Nenhum livro encontrado nessa planilha.</p>'; return; }
      const fresh = books.filter((b) => !findBook(b.title, b.author, b.isbn));
      const by = (st) => fresh.filter((b) => b.status === st).length;
      preview.innerHTML = `<p class="small"><b>${books.length} livros</b> no arquivo ${source === 'goodreads' ? 'do Goodreads' : ''}: <b>${fresh.length} novos</b>${books.length - fresh.length ? `, ${books.length - fresh.length} já estão na estante (serão ignorados)` : ''}.</p>
        <p class="small muted">Lidos: ${by('finished')} · Lendo: ${by('reading')} · Quero ler: ${by('want')} · Abandonados: ${by('abandoned')}<br>Colunas reconhecidas: ${columns.join(', ')}</p>
        <div class="imp-list">${fresh.slice(0, 8).map((b) => `<div class="small">• <b>${esc(b.title)}</b> <span class="muted">${esc(b.author)}${b.endDate ? ` · lido em ${fmtDate(b.endDate)}` : ''}</span></div>`).join('')}${fresh.length > 8 ? `<div class="small muted">… e mais ${fresh.length - 8}</div>` : ''}</div>
        <label>Finalidade dos livros importados <select id="imp-purpose">${Object.entries(PURPOSE).map(([k, p]) => `<option value="${k}">${p.icon} ${p.label}</option>`).join('')}</select></label>
        <button type="button" class="btn primary block" id="imp-go" style="margin-top:0" ${fresh.length ? '' : 'disabled'}>Importar ${fresh.length} livros</button>`;
      $('#imp-go', root).onclick = async () => {
        const purpose = $('#imp-purpose', root).value;
        closeModal();
        await commit(async () => {
          const list = fresh.map((b, i) => ({
            id: uid(), createdAt: Date.now() + i, purpose, subtheme: '', cover: '', ...b,
            currentPage: b.status === 'finished' ? b.pages : 0,
          }));
          state.books.push(...list);
          await db.bulkPut('books', list);
        });
        toast(`📚 ${fresh.length} livros importados.`);
      };
    }
  });
}

// ---------------- backup ----------------
function exportData() {
  const data = { app: 'grifo', version: 2, exportedAt: new Date().toISOString(), ...Object.fromEntries(STORES.map((s) => [s, s === 'books' ? [...state.books, ...state.articles] : state[s]])), settings: state.settings, badges: state.badges, challenges: state.challenges };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = `grifo-backup-${G.ymd()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!['grifo', 'estante'].includes(data.app)) throw new Error('arquivo não é um backup do Grifo');
    if (!confirm(`Importar ${data.books.length} livros, ${data.notes.length} notas e ${(data.cards || []).length} cards? Os dados atuais serão substituídos.`)) return;
    for (const s of STORES) { await db.clear(s, { tombstone: true }); await db.bulkPut(s, data[s] || []); }
    await db.setKV('settings', data.settings || DEFAULT_SETTINGS);
    await db.setKV('badges', data.badges || {});
    await db.setKV('challenges', data.challenges || []);
    await load();
    toast('Backup importado ✔');
    render();
  } catch (e) {
    toast(`Não foi possível importar: ${e.message}`, 'err');
  }
}

// ---------------- cronômetro de leitura ----------------
// Fica no localStorage: sobrevive a recarregar a página e a fechar o app.
const TIMER_KEY = 'estante.timer';
const timerGet = () => { try { return JSON.parse(localStorage.getItem(TIMER_KEY)); } catch { return null; } };
const timerSet = (t) => { try { if (t) localStorage.setItem(TIMER_KEY, JSON.stringify(t)); else localStorage.removeItem(TIMER_KEY); } catch { /* sem armazenamento */ } };
const timerElapsed = (t) => (t.acc || 0) + (t.since ? Date.now() - t.since : 0);
const clock = (ms) => {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(sec).padStart(2, '0')}`;
};

function renderTimer() {
  const bar = $('#timer-bar');
  const t = timerGet();
  const b = t && bookById(t.bookId);
  if (!b) { bar.hidden = true; document.body.classList.remove('has-timer'); return; }
  bar.hidden = false;
  document.body.classList.add('has-timer');
  bar.innerHTML = `<span class="timer-dot ${t.since ? 'on' : ''}"></span>
    <span class="grow timer-info"><b id="timer-clock">${clock(timerElapsed(t))}</b><small>${esc(b.title)}</small></span>
    <button class="btn small" data-action="${t.since ? 'pauseTimer' : 'resumeTimer'}">${t.since ? '⏸ Pausar' : '▶ Retomar'}</button>
    <button class="btn small primary" data-action="stopTimer">■ Terminar</button>`;
}
setInterval(() => {
  const t = timerGet();
  const el = $('#timer-clock');
  if (t && el) el.textContent = clock(timerElapsed(t));
}, 1000);

const timerActions = {
  startTimer({ id }) {
    const cur = timerGet();
    if (cur && cur.bookId !== id && !confirm(`Já há um cronômetro em “${bookById(cur.bookId)?.title}”. Trocar de livro?`)) return;
    if (!cur || cur.bookId !== id) timerSet({ bookId: id, acc: 0, since: Date.now() });
    renderTimer();
    toast('⏱️ Boa leitura! Toque em “Terminar” quando parar.');
  },
  pauseTimer() {
    const t = timerGet();
    if (t?.since) timerSet({ ...t, acc: timerElapsed(t), since: null });
    renderTimer();
  },
  resumeTimer() {
    const t = timerGet();
    if (t && !t.since) timerSet({ ...t, since: Date.now() });
    renderTimer();
  },
  stopTimer() {
    const t = timerGet();
    if (!t) return;
    const minutes = Math.max(1, Math.round(timerElapsed(t) / 60000));
    timerSet(null);
    renderTimer();
    const b = bookById(t.bookId);
    if (b) logForm(b, { minutes });
  },
};

// ---------------- ações ----------------
const actions = {
  ...shareActions,
  ...examActions,
  ...aiStudyActions,
  ...articleActions,
  ...exportActions,
  ...pdfActions,
  ...tagActions,
  ...wordActions,
  ...timerActions,
  ...reminderActions,
  ...cloudActions,
  close: closeModal,
  toggleTheme: () => {
    const order = ['auto', 'light', 'dark'];
    const next = order[(order.indexOf(currentTheme()) + 1) % order.length];
    applyTheme(next);
    toast(`Tema: ${THEME_LABEL[next]}`);
    if (location.hash === '#/ajustes') render();
  },
  newBook: () => bookForm(),
  scanBook: () => bookForm(null, { scan: true }),
  importFile: () => importForm(),
  async finishOnboarding() {
    state.settings = { ...state.settings, onboarded: true };
    await db.setKV('settings', state.settings);
    toast('Tudo pronto! Boas leituras 📚');
    render();
  },
  editBook: ({ id }) => bookForm(bookById(id)),
  logReading: ({ id }) => logForm(bookById(id)),
  finishBook: ({ id }) => finishForm(bookById(id)),
  newNote: ({ id, link }) => noteForm(null, { bookId: id, link }),
  scan: ({ id }) => noteForm(null, { bookId: id, autoOCR: true }),
  editNote: ({ id }) => noteForm(noteById(id)),
  newCard: ({ id }) => cardForm({ note: noteById(id) }),
  editCard: ({ id }) => cardForm({ card: state.cards.find((c) => c.id === id) }),
  async deleteCard({ id }) {
    if (!confirm('Excluir este card?')) return;
    await commit(() => remove('cards', id));
    toast('🗑️ Card excluído');
  },
  startReview: () => {
    const today = G.ymd();
    const due = reviewCards().filter((c) => c.due <= today).sort((a, b) => a.due.localeCompare(b.due) || a.createdAt - b.createdAt);
    review = { queue: due.slice(0, state.settings.dailyCards).map((c) => c.id), revealed: false, done: 0 };
    render();
  },
  clearScope: ({ key }) => { sessionStorage.removeItem(key); render(); },
  stopReview: () => { review = review && { ...review, queue: [] }; render(); },
  reveal: () => { if (!review || Date.now() < (review.revealAfter || 0)) return; review.revealed = true; render(); },
  grade: ({ g }) => gradeCard(Number(g)),
  bookFilter: ({ v }) => { sessionStorage.setItem('bookFilter', v); render(); },
  bookPurpose: ({ v }) => { sessionStorage.setItem('bookPurpose', v); render(); },
  async deleteBook({ id }) {
    const b = bookById(id);
    if (!confirm(`Excluir “${b.title}” com suas notas, cards e sessões?`)) return;
    await commit(async () => {
      for (const c of state.cards.filter((x) => x.bookId === id)) await remove('cards', c.id);
      for (const n of state.notes.filter((x) => x.bookId === id)) await remove('notes', n.id);
      for (const s of state.sessions.filter((x) => x.bookId === id)) await remove('sessions', s.id);
      await remove('books', id);
    });
    toast(`🗑️ “${esc(b.title)}” excluído`);
    location.hash = '#/livros';
  },
  async deleteNote({ id }) {
    const cards = state.cards.filter((c) => c.noteId === id);
    if (!confirm(`Excluir esta nota${cards.length ? ` e ${cards.length} card(s)` : ''}?`)) return;
    await commit(async () => {
      for (const c of cards) await remove('cards', c.id);
      await remove('notes', id);
    });
    toast('🗑️ Nota excluída');
    if (location.hash.startsWith('#/nota/')) location.hash = '#/notas';
  },
  async deleteSession({ id }) {
    const s = state.sessions.find((x) => x.id === id);
    if (!confirm(`Excluir a sessão de ${fmtDate(s.date)} (+${s.pages} pág.)?`)) return;
    await commit(async () => {
      await remove('sessions', id);
      const b = bookById(s.bookId);
      if (b && b.currentPage === s.toPage && b.status !== 'finished') await persist('books', { ...b, currentPage: s.fromPage });
    });
    toast('🗑️ Sessão excluída');
  },
  async shareNote({ id }) {
    const n = noteById(id);
    const b = bookById(n.bookId);
    const body = n.text.replace(LINK_RE, (m, x) => x.split('|').pop());
    const text = `“${body}”\n— ${b?.title || ''}${b?.author ? `, ${b.author}` : ''}${n.page ? ` (p. ${n.page})` : ''}`;
    if (navigator.share) {
      navigator.share({ text }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(text);
      toast('Citação copiada 📋');
    }
  },
  export: exportData,
  import: () => $('#import-file').click(),
  async wipe() {
    if (!confirm('Apagar TODOS os livros, notas, cards e progresso? Isso não pode ser desfeito.')) return;
    if (!confirm('Tem certeza? Considere exportar um backup antes.')) return;
    for (const s of STORES) await db.clear(s, { tombstone: true });
    for (const k of ['settings', 'badges', 'challenges']) await db.setKV(k, undefined);
    await load();
    render();
    toast('Dados apagados.');
  },
};

document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]');
  if (a) {
    e.preventDefault();
    e.stopPropagation();
    actions[a.dataset.action]?.(a.dataset, a);
    return;
  }
  const card = e.target.closest('[data-href]');
  if (card && !e.target.closest('a, button')) location.hash = card.dataset.href;
});

// Atalhos de teclado na revisão
document.addEventListener('keydown', (e) => {
  if (!review || !review.queue.length || modal.open || e.target.closest('input, textarea, select')) return;
  if (!review.revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); actions.reveal(); return; }
  const g = S.GRADES.find((x) => x.key === e.key);
  if (review.revealed && g) { e.preventDefault(); gradeCard(g.g); }
});

// Capa que não carregou (sem internet, link quebrado) vira a capa gerada
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains('cover')) return;
  const ph = document.createElement('div');
  ph.className = `${img.className} ph`;
  ph.textContent = '📖';
  img.replaceWith(ph);
}, true);

document.addEventListener('input', (e) => {
  const sel = e.target.dataset.filterList;
  if (!sel) return;
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll(`${sel} [data-search]`).forEach((el) => { el.hidden = !el.dataset.search.includes(q); });
});

document.addEventListener('change', async (e) => {
  if (e.target.dataset.mapShow) {
    const show = { ...mapShow(), [e.target.dataset.mapShow]: e.target.checked };
    try { localStorage.setItem('grifo.mapShow', JSON.stringify(show)); } catch { /* sem armazenamento */ }
    render();
    return;
  }
  if (e.target.matches('[data-theme-pick]')) applyTheme(e.target.value);
  if (e.target.matches('[data-lang-pick]')) { setLang(e.target.value); location.reload(); }
  if (e.target.matches('[data-weekly]')) {
    try {
      await Cloud.setWeeklyEmail(e.target.checked);
      toast(e.target.checked ? '✉️ Você vai receber o resumo aos domingos' : 'Resumo semanal desativado');
    } catch (err) {
      e.target.checked = !e.target.checked;
      toast(`Não foi possível salvar: ${esc(err.message)}`, 'err');
    }
  }
  if (e.target.id === 'rem-on' || e.target.id === 'rem-time') {
    await saveReminder($('#rem-on').checked, $('#rem-time').value || '20:00');
    if (e.target.id === 'rem-on') toast(e.target.checked ? '⏰ Lembrete ativado' : 'Lembrete desativado');
  }
  if (e.target.id === 'import-file' && e.target.files[0]) importData(e.target.files[0]);
});

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'settings-form') return;
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  state.settings = {
    ...state.settings,
    name: fd.name.trim(), yearGoal: Math.max(1, Number(fd.yearGoal) || 12),
    dailyGoal: Math.max(1, Number(fd.dailyGoal) || 20), dailyCards: Math.max(5, Number(fd.dailyCards) || 20),
    googleKey: fd.googleKey.trim(), handle: fd.handle.trim(), aiKey: (fd.aiKey ?? state.settings.aiKey ?? '').trim(),
  };
  await db.setKV('settings', state.settings);
  await commit(() => {});
  toast('Ajustes salvos ✔');
});

// ---------------- roteamento ----------------
const routes = {
  '': home, livros: booksView, livro: bookDetail, notas: notesView, nota: noteDetail, conceito: conceptView,
  mapa: mapView, revisar: reviewView, stats: statsView, conquistas: achievementsView, ajustes: settingsView,
  conta: accountView, admin: adminView, busca: searchView, tags: tagsView, vocabulario: vocabView, artigos: articlesView, pdf: pdfView, artigo: articleView, u: publicProfileView, clubes: clubsView, perguntar: askView, plus: plusView,
  privacidade: privacyView, termos: termsView,
};
// páginas que qualquer pessoa pode abrir sem login
const OPEN_ROUTES = ['u', 'privacidade', 'termos'];
const TAB_OF = { vocabulario: 'notas', tags: 'notas', pdf: 'livros', busca: 'nenhuma', artigos: 'livros', artigo: 'livros', livro: 'livros', nota: 'notas', conceito: 'notas', mapa: 'notas', perguntar: 'notas', stats: 'progresso', conquistas: 'progresso', clubes: 'progresso' };

function render() {
  const [hashPath, query = ''] = location.hash.slice(1).split('?');
  const [, name = '', arg] = hashPath.split('/');
  const gated = Cloud.enabled() && !Cloud.user() && !OPEN_ROUTES.includes(name);
  // atalhos do ícone do app (manifest): #/livros?acao=escanear, #/notas?acao=grifo
  const acao = new URLSearchParams(query).get('acao');
  if (acao && !gated) {
    history.replaceState(null, '', `${location.pathname}${location.search}#${hashPath}`);
    setTimeout(() => (acao === 'escanear' ? actions.scanBook() : acao === 'grifo' ? actions.scan({}) : null), 0);
  }
  document.body.classList.toggle('gated', gated);
  let fn = gated ? (name === 'conta' ? accountView : landing) : routes[name] || home;
  if (fn === home && (needsOnboarding() || (onbStep >= 2 && !state.settings.onboarded))) fn = onboarding;
  const keepScroll = view.dataset.route === location.hash;
  const y = scrollY;
  graphApi = null;
  view.innerHTML = fn(arg);
  fn.mount?.(arg);
  if (!gated) saveSharedArticle();
  view.dataset.route = location.hash;
  if (keepScroll) scrollTo(0, y); else scrollTo(0, 0);
  const tab = TAB_OF[name] ?? name;
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  const due = state.stats.dueCards;
  const badge = $('#due-badge');
  badge.hidden = !due;
  badge.textContent = due > 99 ? '99+' : due;
  renderTimer();
  const acc = $('#account-btn');
  const avatar = Cloud.user() && Cloud.currentProfile()?.avatar_url;
  acc.innerHTML = avatar ? `<img src="${esc(avatar)}" alt="" class="avatar xs" referrerpolicy="no-referrer">` : '👤';
  // número no ícone do app instalado (cards pendentes)
  if ('setAppBadge' in navigator) (due ? navigator.setAppBadge(due) : navigator.clearAppBadge()).catch(() => {});
}

window.addEventListener('hashchange', () => {
  closeModal();
  if (!location.hash.startsWith('#/revisar')) review = null;
  render();
});

applyTheme(currentTheme());
startTranslating();
Cloud.onInvite((r) => {
  const msg = {
    ok: '🎉 Convite aceito! Você ganhou 1 mês de Grifo Plus.',
    old: 'Convites valem só para contas novas.',
    invalid: 'Esse link de convite não é válido.',
    self: 'Esse é o seu próprio convite 🙂',
    already: 'Você já usou um convite.',
  }[r];
  if (msg) toast(msg, r === 'ok' ? 'gold' : '');
  if (r === 'ok') render();
});
await Cloud.init().catch(() => {});
await load();
render();

// conta: ao entrar, sincroniza tudo; depois a cada alteração, ao voltar ao app e a cada 5 minutos
let knownUser = Cloud.user()?.id || null;
Cloud.onChange(() => {
  const id = Cloud.user()?.id || null;
  if (id && id !== knownUser) {
    knownUser = id;
    toast('☁️ Conectado! Sincronizando seus dados…');
    location.hash = '#/';
    runSync({ silent: false });
  }
  knownUser = id;
  render();
});
if (Cloud.user()) runSync();
window.addEventListener('error', (e) => { if (e.message) Cloud.reportError(e.message, e.error?.stack, APP_VERSION); });
window.addEventListener('unhandledrejection', (e) => Cloud.reportError(String(e.reason?.message || e.reason), e.reason?.stack, APP_VERSION));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(500); });
setInterval(() => scheduleSync(0), 5 * 60 * 1000);

// Atualizações: o celular costuma devolver a aba da memória sem recarregar. Ao voltar para o app,
// procura uma versão nova; quando ela assume, recarrega sozinho (ou avisa, se houver algo aberto).
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    const busy = $('#modal')?.open || document.activeElement?.matches?.('input, textarea');
    if (!busy) { reloading = true; location.reload(); return; }
    toast('Nova versão do Grifo disponível · <u>toque para atualizar</u>', '', () => location.reload());
  });
}
