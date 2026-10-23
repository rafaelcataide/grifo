import { db, uid, STORES } from './db.js';
import * as G from './game.js';
import * as C from './charts.js';
import * as S from './srs.js';
import { runOCR } from './ocr.js';
import { createGraph } from './graph.js';
import * as Share from './share.js';
import * as Scanner from './scanner.js';
import * as Importers from './importers.js';
import * as Cloud from './cloud.js';
import * as AI from './ai.js';
import { CONFIG } from '../config.js';

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
const LINK_RE = /\[\[([^[\]\n]+?)\]\]/g;

const state = {
  books: [], sessions: [], notes: [], cards: [], reviews: [],
  settings: { ...DEFAULT_SETTINGS }, badges: {}, challenges: [], stats: null,
};
let review = null; // sessão de revisão em andamento: { queue: [cardId], revealed, done }

const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const modal = $('#modal');
const modalBody = $('#modal-body');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s ?? '').trim().toLowerCase();
const nf = (n) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const fmtDate = (s) => (s ? G.parseYmd(s).toLocaleDateString('pt-BR') : '');
const bookById = (id) => state.books.find((b) => b.id === id);
const noteById = (id) => state.notes.find((n) => n.id === id);
const stars = (n) => (n > 0 ? `<span class="stars">${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span></span>` : '');
const pct = (b) => (b.pages ? Math.min(100, Math.round(((b.status === 'finished' ? b.pages : b.currentPage || 0) / b.pages) * 100)) : 0);
const empty = (msg, extra = '') => `<div class="empty"><p>${msg}</p>${extra}</div>`;
const conceptHref = (name) => `#/conceito/${encodeURIComponent(name.trim())}`;
const purposeChip = (b) => { const p = PURPOSE[b.purpose || 'hobby']; return `<span class="chip p-${b.purpose || 'hobby'}">${p.icon} ${p.label}</span>`; };
const seg = (items, active) => `<nav class="seg">${items.map(([href, label, key]) => `<a href="${href}" class="${key === active ? 'active' : ''}">${label}</a>`).join('')}</nav>`;

// ---------------- links [[ ]] ----------------
const linksOf = (text) => [...String(text || '').matchAll(LINK_RE)].map((m) => m[1].split('|')[0].trim()).filter(Boolean);

function resolveLink(name) {
  const k = norm(name);
  const b = state.books.find((x) => norm(x.title) === k);
  if (b) return { type: 'book', href: `#/livro/${b.id}`, node: `b:${b.id}` };
  const n = state.notes.find((x) => x.title && norm(x.title) === k);
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

const noteLabel = (n) => n.title || (n.text || '').replace(LINK_RE, '$1').slice(0, 48) + ((n.text || '').length > 48 ? '…' : '');

// ---------------- persistência ----------------
async function load() {
  const all = await Promise.all(STORES.map((s) => db.all(s)));
  STORES.forEach((s, i) => { state[s] = all[i]; });
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
  const arr = state[store];
  const i = arr.findIndex((x) => x.id === obj.id);
  if (i >= 0) arr[i] = obj; else arr.push(obj);
}

async function remove(store, id) {
  await db.del(store, id);
  state[store] = state[store].filter((x) => x.id !== id);
}

// Toda alteração passa por aqui: recalcula XP, desafios, conquistas e comemora.
async function commit(fn, { quiet = false } = {}) {
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
  render();
  scheduleSync();
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
  return `<article class="note card ${n.kind === 'quote' ? 'quote' : ''}" data-href="#/nota/${n.id}" data-book="${n.bookId}" data-search="${esc(`${n.title || ''} ${n.text} ${(n.tags || []).join(' ')} ${b?.title || ''}`.toLowerCase())}">
    ${n.title ? `<div class="note-title">${esc(n.title)}</div>` : ''}
    <div class="note-text">${renderText(n.text)}</div>
    <div class="row between wrap gap-s">
      <div class="small muted">
        ${showBook && b ? `<a href="#/livro/${b.id}">${esc(b.title)}</a> · ` : ''}${n.page ? `pág. ${n.page} · ` : ''}${new Date(n.createdAt).toLocaleDateString('pt-BR')}
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

function home() {
  const s = state.stats, set = state.settings;
  const ch = G.weeklyChallenge(s);
  const reading = state.books.filter((b) => b.status === 'reading');
  const recentBadges = G.BADGES.filter((b) => state.badges[b.id])
    .sort((a, b) => state.badges[b.id].localeCompare(state.badges[a.id])).slice(0, 4);
  const streakMsg = s.pagesToday > 0
    ? (s.pagesToday >= set.dailyGoal ? 'Meta de hoje batida! 🎉' : `Faltam ${set.dailyGoal - s.pagesToday} páginas para a meta de hoje.`)
    : (s.streak > 0 ? `Leia hoje para manter sua sequência de ${s.streak} dias!` : 'Que tal começar uma sequência hoje?');

  return `${levelCard()}
  <p class="nudge">${streakMsg}</p>
  <section class="grid2">
    <div class="card center">${C.ring(s.pagesToday / set.dailyGoal)}<div class="small"><b>${s.pagesToday}</b> / ${set.dailyGoal} páginas hoje</div></div>
    <div class="card center">${C.ring(s.finishedThisYear / set.yearGoal)}<div class="small"><b>${s.finishedThisYear}</b> / ${set.yearGoal} livros em ${s.year}</div></div>
  </section>
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
  </div>
  <h2>Lendo agora</h2>
  ${reading.length ? reading.map(bookCard).join('') : empty('Nenhum livro em andamento.', '<button class="btn primary" data-action="newBook">Adicionar um livro</button>')}
  ${recentBadges.length ? `<h2>Conquistas recentes</h2><div class="badges">${recentBadges.map(badgeTile).join('')}</div>` : ''}`;
}

function booksView() {
  const filter = sessionStorage.getItem('bookFilter') || 'all';
  const purpose = sessionStorage.getItem('bookPurpose') || 'all';
  const list = state.books
    .filter((b) => (filter === 'all' || b.status === filter) && (purpose === 'all' || (b.purpose || 'hobby') === purpose))
    .sort((a, b) => (b.endDate || b.startDate || '').localeCompare(a.endDate || a.startDate || '') || b.createdAt - a.createdAt);
  const count = (st) => state.books.filter((b) => b.status === st).length;
  return `<div class="row between"><h2>Meus livros</h2><div class="row gap-s"><button class="btn" data-action="importFile" title="Importar do Kindle, Goodreads ou Skoob">⬆️</button><button class="btn" data-action="shareShelf">📸 Minha estante</button><button class="btn primary" data-action="newBook">➕ Novo</button></div></div>
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
  const notes = [...state.notes].sort((a, b) => b.createdAt - a.createdAt);
  const withNotes = state.books.filter((b) => notes.some((n) => n.bookId === b.id));
  return `${seg([['#/notas', '✍️ Notas', 'list'], ['#/mapa', '🕸️ Mapa', 'map'], ['#/perguntar', '✨ Perguntar', 'ask']], 'list')}
  <div class="row between"><h2 style="margin-top:0">Notas</h2>
    <div class="row gap-s"><button class="btn" data-action="scan">📷 Grifo</button><button class="btn primary" data-action="newNote">✍️ Nova</button></div></div>
  <p class="small muted">Dica: escreva <b>[[</b> numa nota para ligá-la a um livro, a outra nota ou a um conceito. As ligações formam o mapa mental.</p>
  <input class="search" type="search" placeholder="Buscar em notas e tags…" data-filter-list="#note-list">
  ${withNotes.length > 1 ? `<select class="search" data-book-filter="#note-list"><option value="">Todos os livros</option>
    ${withNotes.map((b) => `<option value="${b.id}">${esc(b.title)}</option>`).join('')}</select>` : ''}
  <div id="note-list">${notes.length ? notes.map((n) => noteCard(n)).join('') : empty('Suas citações e reflexões aparecem aqui.', '<button class="btn primary" data-action="scan">📷 Capturar um grifo</button>')}</div>`;
}

function noteDetail(id) {
  const n = noteById(id);
  if (!n) return empty('Nota não encontrada.', '<a class="btn" href="#/notas">Voltar</a>');
  const b = bookById(n.bookId);
  const out = [...new Set(linksOf(n.text))];
  const backlinks = n.title ? state.notes.filter((x) => x.id !== n.id && linksOf(x.text).some((l) => norm(l) === norm(n.title))) : [];
  const shared = state.notes.filter((x) => x.id !== n.id && (
    (x.tags || []).some((t) => (n.tags || []).map(norm).includes(norm(t))) ||
    linksOf(x.text).some((l) => out.map(norm).includes(norm(l)))
  )).slice(0, 8);
  const cards = state.cards.filter((c) => c.noteId === n.id);
  return `<a href="#/notas" class="back">← Notas</a>
  <section class="card note ${n.kind === 'quote' ? 'quote' : ''}">
    ${n.title ? `<h2 style="margin-top:0">${esc(n.title)}</h2>` : ''}
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
    <a class="btn" href="#/mapa/${encodeURIComponent(`n:${n.id}`)}">🕸️ No mapa</a>
    <button class="btn" data-action="shareNote" data-id="${n.id}">↗ Compartilhar</button>
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
    <button class="btn" data-action="newNote" data-link="${esc(name)}">✍️ Nota sobre isto</button></div>
  ${subs.length ? `<h3>Subtemas</h3><div class="chips">${subs.map((x) => `<a class="chip tag" href="${conceptHref(x)}">${esc(x)}</a>`).join('')}</div>` : ''}
  ${books.length ? `<h3>Livros (${books.length})</h3>${books.map(bookCard).join('')}` : ''}
  <h3>Notas conectadas (${notes.length})</h3>
  ${notes.length ? notes.map((n) => noteCard(n)).join('') : empty(`Nenhuma nota liga para [[${esc(name)}]] ainda.`)}`;
}

// ---------- mapa mental ----------
let graphApi = null;

function graphData({ purpose = 'all', showNotes = true } = {}) {
  const nodes = new Map();
  const links = new Map();
  const node = (id, label, type, extra = {}) => { if (!nodes.has(id)) nodes.set(id, { id, label, type, ...extra }); return id; };
  const link = (a, b) => { if (a && b && a !== b) links.set(a < b ? `${a}|${b}` : `${b}|${a}`, { source: a, target: b }); };
  const books = state.books.filter((b) => purpose === 'all' || (b.purpose || 'hobby') === purpose);
  const ids = new Set(books.map((b) => b.id));

  for (const b of books) {
    const bid = node(`b:${b.id}`, b.title, 'book', { purpose: b.purpose || 'hobby', href: `#/livro/${b.id}` });
    if (!b.genre) continue;
    const tid = node(`c:${norm(b.genre)}`, b.genre, 'theme', { href: conceptHref(b.genre) });
    if (b.subtheme) {
      const sid = node(`c:${norm(b.subtheme)}`, b.subtheme, 'subtheme', { href: conceptHref(b.subtheme) });
      link(bid, sid);
      link(sid, tid);
    } else link(bid, tid);
  }
  for (const n of state.notes) {
    if (!ids.has(n.bookId)) continue;
    const from = showNotes ? node(`n:${n.id}`, noteLabel(n), 'note', { href: `#/nota/${n.id}` }) : `b:${n.bookId}`;
    if (showNotes) link(from, `b:${n.bookId}`);
    for (const t of n.tags || []) link(from, node(`c:${norm(t)}`, `#${t}`, 'tag', { href: conceptHref(t) }));
    for (const l of linksOf(n.text)) {
      const r = resolveLink(l);
      if (r.type === 'book' && !nodes.has(r.node)) continue; // livro filtrado
      if (r.type === 'note' && !showNotes) { link(from, `b:${noteById(r.node.slice(2))?.bookId}`); continue; }
      if (r.type === 'concept') node(r.node, l, 'concept', { href: r.href });
      link(from, r.node);
    }
  }
  return { nodes: [...nodes.values()], links: [...links.values()].filter((l) => nodes.has(l.source) && nodes.has(l.target)) };
}

const TYPE_LABEL = { book: 'Livro', theme: 'Tema', subtheme: 'Subtema', tag: 'Tag', note: 'Nota', concept: 'Conceito' };

function mapView() {
  const purpose = sessionStorage.getItem('mapPurpose') || 'all';
  const showNotes = sessionStorage.getItem('mapNotes') !== '0';
  const d = graphData({ purpose, showNotes });
  return `${seg([['#/notas', '✍️ Notas', 'list'], ['#/mapa', '🕸️ Mapa', 'map'], ['#/perguntar', '✨ Perguntar', 'ask']], 'map')}
  <div class="filters">
    <input type="search" class="search" id="graph-search" placeholder="Encontrar no mapa…">
    <select class="search" id="graph-purpose">
      <option value="all">Todas as finalidades</option>
      ${Object.entries(PURPOSE).map(([k, p]) => `<option value="${k}" ${purpose === k ? 'selected' : ''}>${p.icon} ${p.label}</option>`).join('')}
    </select>
    <label class="toggle"><input type="checkbox" id="graph-notes" ${showNotes ? 'checked' : ''}> mostrar notas</label>
  </div>
  ${d.nodes.length ? `<section class="card graph-wrap">
    <canvas id="graph" aria-label="Mapa mental de livros, temas, notas e conceitos"></canvas>
    <div class="graph-tools">
      <button type="button" data-graph="in" aria-label="Aproximar">＋</button>
      <button type="button" data-graph="out" aria-label="Afastar">－</button>
      <button type="button" data-graph="fit" aria-label="Enquadrar tudo">⤢</button>
      <button type="button" data-graph="photo" aria-label="Compartilhar mapa como imagem" title="Compartilhar como imagem">📸</button>
    </div>
    <div class="legend-row">
      <span><i class="dot" style="background:var(--c-hobby)"></i>Hobby</span>
      <span><i class="dot" style="background:var(--c-pro)"></i>Profissional</span>
      <span><i class="dot" style="background:var(--c-acad)"></i>Acadêmico</span>
      <span><i class="dot" style="background:var(--c-theme)"></i>Tema</span>
      <span><i class="dot" style="background:var(--c-sub)"></i>Subtema</span>
      <span><i class="dot" style="background:var(--c-concept)"></i>Conceito</span>
      <span><i class="dot" style="background:var(--c-tag)"></i>Tag</span>
      <span><i class="dot" style="background:var(--c-note)"></i>Nota</span>
    </div>
  </section>
  <section class="card" id="graph-panel"><p class="small muted" style="margin:0">Toque num ponto para ver as conexões. Arraste para mover, use dois dedos (ou a roda do mouse) para zoom.</p></section>
  <p class="small muted">${d.nodes.length} pontos · ${d.links.length} conexões</p>`
    : empty('O mapa aparece quando você cadastrar livros com tema e subtema e criar notas com [[ligações]].', '<button class="btn primary" data-action="newBook">Adicionar livro</button>')}`;
}
mapView.mount = (arg) => {
  const canvas = $('#graph');
  const purposeSel = $('#graph-purpose');
  const notesChk = $('#graph-notes');
  purposeSel.onchange = () => { sessionStorage.setItem('mapPurpose', purposeSel.value); render(); };
  notesChk.onchange = () => { sessionStorage.setItem('mapNotes', notesChk.checked ? '1' : '0'); render(); };
  if (!canvas) return;
  const panel = $('#graph-panel');
  const purpose = sessionStorage.getItem('mapPurpose') || 'all';
  const showNotes = sessionStorage.getItem('mapNotes') !== '0';
  graphApi = createGraph(canvas, graphData({ purpose, showNotes }), {
    onSelect(n, near) {
      if (!n) { panel.innerHTML = '<p class="small muted" style="margin:0">Toque num ponto para ver as conexões.</p>'; return; }
      const order = ['theme', 'subtheme', 'book', 'concept', 'tag', 'note'];
      near.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
      panel.innerHTML = `<div class="row between gap"><div><span class="chip">${TYPE_LABEL[n.type]}</span><h3 style="margin:4px 0 0">${esc(n.label)}</h3></div>
        <a class="btn small primary" href="${n.href}">Abrir</a></div>
        <div class="small muted" style="margin:10px 0 4px">${near.length} ${near.length === 1 ? 'conexão' : 'conexões'}</div>
        <div class="chips">${near.map((x) => `<a class="chip" href="${x.href}">${esc(TYPE_LABEL[x.type])}: ${esc(x.label.length > 40 ? `${x.label.slice(0, 39)}…` : x.label)}</a>`).join('')}</div>`;
    },
  });
  view.querySelectorAll('[data-graph]').forEach((b) => {
    b.onclick = () => ({ in: () => graphApi.zoom(1.3), out: () => graphApi.zoom(1 / 1.3), fit: () => graphApi.fit(), photo: () => actions.shareMap() })[b.dataset.graph]();
  });
  const search = $('#graph-search');
  search.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!graphApi.find(search.value)) toast('Nada encontrado no mapa.'); } };
  if (arg) setTimeout(() => graphApi.selectById(decodeURIComponent(arg)), 50);
};

// ---------- cards de memorização ----------
function cardFace(c, answer) {
  if (c.type === 'cloze') {
    const html = esc(c.front).replace(/\n/g, '<br>');
    return answer ? S.clozeAnswer(html) : S.clozeQuestion(html);
  }
  return esc(answer ? c.back : c.front).replace(/\n/g, '<br>');
}

function cardItem(c) {
  const b = bookById(c.bookId);
  return `<div class="card card-item">
    <div class="q">${cardFace(c, false)}</div>
    ${c.type === 'qa' ? `<div class="muted">${esc(c.back).slice(0, 160)}</div>` : ''}
    <div class="row between small muted" style="margin-top:6px">
      <span>${b ? esc(b.title) : ''} · próxima: ${c.due <= state.stats.today ? 'hoje' : fmtDate(c.due)}</span>
      <span class="row gap-s"><button class="icon-btn" data-action="editCard" data-id="${c.id}" aria-label="Editar">✏️</button>
      <button class="icon-btn" data-action="deleteCard" data-id="${c.id}" aria-label="Excluir">🗑️</button></span>
    </div></div>`;
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
  const cards = [...state.cards].sort((a, b) => a.due.localeCompare(b.due));
  return `<h2>Revisar</h2>
  ${finished ? '<section class="card center"><span class="big-emoji">🎉</span><b>Revisão concluída!</b><span class="small muted">Os cards voltam no momento certo para você não esquecer.</span></section>' : ''}
  <section class="grid3">
    <div class="card stat"><b>${s.dueCards}</b><span>para hoje</span></div>
    <div class="card stat"><b>${s.cards}</b><span>cards no total</span></div>
    <div class="card stat"><b>${s.reviews ? `${Math.round(s.retention * 100)}%` : '—'}</b><span>acertos</span></div>
  </section>
  ${s.dueCards ? `<button class="btn primary block" data-action="startReview" style="margin:0 0 12px">🧠 Revisar ${Math.min(s.dueCards, state.settings.dailyCards)} cards agora</button>`
    : `<p class="nudge">${s.cards ? 'Tudo em dia! Volte amanhã para a próxima rodada.' : 'Crie cards a partir das suas notas (botão 🧠) para memorizar o que leu.'}</p>`}
  <p class="small muted">Cada card volta num intervalo que cresce conforme você acerta (repetição espaçada, como no Anki). +${G.XP.review} XP por revisão.</p>
  <h3>Todos os cards (${cards.length})</h3>
  ${cards.length ? cards.map(cardItem).join('') : empty('Nenhum card ainda.', '<a class="btn" href="#/notas">Ir para as notas</a>')}`;
}

async function gradeCard(g) {
  const c = state.cards.find((x) => x.id === review.queue[0]);
  const next = S.schedule(c, g, G.ymd());
  review.queue.shift();
  if (g === 0) review.queue.push(c.id); // errou: volta no fim desta sessão
  review.done++;
  review.revealed = false;
  await commit(async () => {
    await persist('cards', next);
    await persist('reviews', { id: uid(), cardId: c.id, date: G.ymd(), grade: g, createdAt: Date.now() });
  }, { quiet: true });
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
  <section class="card"><h3>Dicas</h3><ul class="small">
    <li><b>Mapa mental:</b> escreva <b>[[Nome]]</b> numa nota para ligá-la a um livro, outra nota (pelo título) ou conceito. Temas e subtemas dos livros também viram pontos do mapa.</li>
    <li><b>Cards:</b> no botão 🧠 de uma nota, crie pergunta e resposta ou selecione palavras para virar lacuna.</li>
    <li><b>OCR:</b> fotografe a página de frente, com boa luz. Marca-texto amarelo, verde, rosa, azul ou laranja são detectados.</li>
  </ul></section>
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
    if (applied) { await load(); render(); }
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
    return `<section class="login">
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
  ${plan !== 'plus' ? '<a class="card wrapped-cta" href="#/plus"><span class="big-emoji">⭐</span><span class="grow"><b>Conheça o Grifo Plus</b><span class="small muted">IA na sua biblioteca, estilos extras e artes sem marca</span></span></a>' : ''}
  <button class="btn ghost block" data-action="logout">Sair da conta</button>`;
}
accountView.mount = () => {
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
clubsView.mount = async () => {
  const box = $('#clubs-list');
  if (!box) return;
  try {
    await Cloud.publishStats(publicStats());
    const clubs = await Cloud.myClubs();
    if (!clubs.length) { box.innerHTML = empty('Você ainda não participa de nenhum clube. Crie um e convide amigos com o código!'); return; }
    const month = state.stats.today.slice(0, 7), week = state.stats.week.start;
    const parts = await Promise.all(clubs.map(async (c) => {
      const members = await Cloud.clubMembers(c.id);
      const rows = members.map((m) => ({
        ...m,
        week: m.stats?.weekStart === week ? m.stats.weekPages || 0 : 0,
        month: m.stats?.month === month ? m.stats.monthPages || 0 : 0,
      })).sort((a, b) => b.week - a.week);
      const total = rows.reduce((a, r) => a + r.month, 0);
      const me = Cloud.user().id;
      return `<section class="card club">
        <div class="row between"><h3 style="margin:0">${esc(c.name)}</h3><span class="chip">${rows.length} ${rows.length === 1 ? 'membro' : 'membros'}</span></div>
        <div class="small muted" style="margin-top:6px">Meta coletiva do mês: <b>${nf(total)}</b> / ${nf(c.goal_pages)} páginas</div>
        <div class="bar"><div style="width:${Math.min(100, (total / c.goal_pages) * 100)}%"></div></div>
        <div class="small muted" style="margin:10px 0 4px">Ranking da semana (páginas)</div>
        <div class="list">${rows.map((r, i) => `<div class="row between li ${r.user_id === me ? 'current' : ''}">
          <span>${['🥇', '🥈', '🥉'][i] || `${i + 1}.`} ${r.handle ? `<a href="#/u/${esc(r.handle)}">${esc(r.display_name || r.handle)}</a>` : esc(r.display_name || 'Leitor')}${r.stats?.streak > 1 ? ` <span class="small">🔥${r.stats.streak}</span>` : ''}</span>
          <b>${nf(r.week)}</b></div>`).join('')}</div>
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
  return `${seg([['#/notas', '✍️ Notas', 'list'], ['#/mapa', '🕸️ Mapa', 'map'], ['#/perguntar', '✨ Perguntar', 'ask']], 'ask')}
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
  const st = AI.available(state.settings);
  if (st === 'login') { location.hash = '#/conta'; throw new Error('Entre na sua conta para usar a IA.'); }
  if (st === 'plus') { location.hash = '#/plus'; throw new Error(''); }
  if (st === 'key') { location.hash = '#/ajustes'; throw new Error('Cadastre sua chave da API da Anthropic em Ajustes → IA.'); }
  try {
    return await AI.run(task, input, state.settings);
  } catch (e) {
    if (e.code === 'plus') { location.hash = '#/plus'; throw new Error(''); }
    throw e;
  }
}

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
    ['🎨', 'Estilos extras de arte', 'Noite e Sua foto nos posts de citação'],
    ['🏷️', 'Artes sem marca', 'Posts só com a sua assinatura'],
  ];
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
    : '<p class="nudge">As assinaturas abrem em breve.</p>'}`;
}

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
    await db.wipeLocal();
    await Cloud.signOut();
    await load();
    onbStep = 1;
    location.hash = '#/';
    render();
  },
  syncNow: () => runSync({ silent: false }),
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
        <span class="grow"><b>${cardFace(c, false)}</b>${c.type === 'qa' ? `<br><span class="small muted">${esc(c.back)}</span>` : ''}</span></label>`).join('')}</div>
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
    const candidates = linkCandidates().map((c) => c.label).filter((l) => norm(l) !== norm(n.title) && norm(l) !== norm(b?.title));
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

// ---------------- modais ----------------
function datalist(id, values) {
  return `<datalist id="${id}">${[...new Set(values)].filter(Boolean).sort((a, b) => a.localeCompare(b)).map((v) => `<option value="${esc(v)}">`).join('')}</datalist>`;
}
const themeOptions = () => [...Object.keys(THEMES), ...state.books.map((b) => b.genre)];
function subthemeOptions(theme) {
  const k = norm(theme);
  const preset = Object.entries(THEMES).find(([t]) => norm(t) === k)?.[1] || [];
  return [...preset, ...state.books.filter((b) => norm(b.genre) === k).map((b) => b.subtheme)];
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
    <label>URL da capa <input name="cover" type="url" value="${esc(b.cover)}"></label>
    <div class="actions"><button type="button" class="btn ghost" data-action="close">Cancelar</button><button class="btn primary">Salvar</button></div>
  </form>`, (root) => {
    const form = $('#book-form', root);
    const results = $('#lookup-results', root);
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
      for (const k of ['title', 'author', 'pages', 'isbn', 'cover']) if (r[k]) form[k].value = r[k];
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
  state.notes.forEach((n) => put(n.title, '✍️', 'nota'));
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

function noteForm(existing, { bookId, autoOCR, link } = {}) {
  if (!state.books.length) {
    toast('Cadastre um livro antes de criar notas.');
    return bookForm();
  }
  const n = existing || { bookId: bookId || state.books.find((b) => b.status === 'reading')?.id, kind: link ? 'thought' : 'quote', source: 'manual', tags: [], text: link ? `[[${link}]] ` : '' };
  const lastPage = n.page ?? bookById(n.bookId)?.currentPage ?? '';
  const books = [...state.books].sort((a, b) => (a.status === 'reading' ? -1 : 0) - (b.status === 'reading' ? -1 : 0) || a.title.localeCompare(b.title));
  openModal(`<form class="form" id="note-form">
    <h3>${existing ? 'Editar nota' : 'Nova nota'}</h3>
    <label>Livro <select name="bookId" required>${books.map((b) => `<option value="${b.id}" ${b.id === n.bookId ? 'selected' : ''}>${esc(b.title)}</option>`).join('')}</select></label>
    <div class="ocr-box">
      <div class="row gap-s wrap">
        <button type="button" class="btn" data-ocr="highlight">📷 Ler grifos</button>
        <button type="button" class="btn ghost" data-ocr="page">📄 Página inteira</button>
      </div>
      <input type="file" accept="image/*" hidden id="ocr-file">
      <div id="ocr-status" class="small muted">Fotografe ou escolha uma imagem da página. O texto grifado vira nota.</div>
      <button type="button" class="btn small" id="ocr-fix" hidden>✨ Corrigir com IA</button>
      <img id="ocr-preview" alt="Pré-visualização dos trechos detectados" hidden>
    </div>
    <label>Título (opcional) <input name="title" value="${esc(n.title)}" placeholder="ex: Normalização"><span class="hint">Com título, outras notas podem citar esta com [[título]].</span></label>
    <label>Texto
      <div class="textarea-wrap">
        <textarea name="text" rows="6" required placeholder="Escreva sua reflexão ou cole a citação… Use [[ ]] para conectar ideias.">${esc(n.text)}</textarea>
        <div class="suggest" id="link-suggest" hidden></div>
      </div>
      <div class="row between"><span class="hint">Digite [[ para ligar a um livro, nota ou conceito.</span><button type="button" class="btn small ghost" id="insert-link">🔗 Ligar</button></div>
    </label>
    <div class="grid2">
      <label>Página <input name="page" type="number" min="0" value="${lastPage}"></label>
      <label>Tipo <select name="kind"><option value="quote" ${n.kind === 'quote' ? 'selected' : ''}>Citação</option><option value="thought" ${n.kind === 'thought' ? 'selected' : ''}>Reflexão</option></select></label>
    </div>
    <label>Tags <input name="tags" value="${esc((n.tags || []).join(', '))}" placeholder="ex: normalização, sql"></label>
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
    let mode = 'highlight';
    btns.forEach((btn) => { btn.onclick = () => { mode = btn.dataset.ocr; file.value = ''; file.click(); }; });
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
    file.onchange = async () => {
      const f = file.files[0];
      if (!f) return;
      btns.forEach((x) => { x.disabled = true; });
      try {
        const r = await runOCR(f, mode, (msg, p) => { status.textContent = `${msg}…${p != null ? ` ${Math.round(p * 100)}%` : ''}`; });
        img.src = r.preview;
        img.hidden = false;
        if (!r.text) {
          status.textContent = mode === 'highlight' && !r.regions
            ? 'Nenhum grifo colorido encontrado. Tente com mais luz ou use "Página inteira".'
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
    form.bookId.onchange = () => { if (!existing) form.page.value = bookById(form.bookId.value)?.currentPage || ''; };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(form));
      const note = existing ? { ...existing } : { id: uid(), createdAt: Date.now() };
      Object.assign(note, {
        bookId: fd.bookId, title: fd.title.trim(), text: fd.text.trim(), page: Number(fd.page) || null, kind: fd.kind, source: fd.source,
        tags: fd.tags.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean), updatedAt: Date.now(),
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
    qaFront: n?.title ? `O que é ${n.title}?` : '',
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

function downloadFile(file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// Pré-visualiza a(s) arte(s), troca estilo/formato e compartilha (Instagram, WhatsApp…) ou baixa
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
      for (let i = 0; i < canvases.length; i++) downloadFile(await canvasFile(canvases[i], name(i)));
    };
    $('#studio-share', root).onclick = async () => {
      if (!canvases.length) return;
      const files = await Promise.all(canvases.map((c, i) => canvasFile(c, name(i))));
      if (navigator.canShare?.({ files })) {
        try {
          await navigator.share({ files, text });
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

const plainText = (t) => String(t || '').replace(LINK_RE, (m, x) => x.split('|').pop());

const shareActions = {
  postNote({ id }) {
    const n = noteById(id), b = bookById(n.bookId);
    shareStudio({
      title: '📸 Post da citação', filename: 'citacao', photo: true, text: b ? `${b.title}${b.author ? ` — ${b.author}` : ''}` : '',
      groups: [{ key: 'style', options: Share.QUOTE_STYLES.map((o) => (Share.PLUS_STYLES.includes(o.id) && !isPlus() ? { ...o, label: `${o.label} 🔒`, locked: true } : o)) }, { key: 'format', options: FORMATS }],
      render: (v, photo) => Share.quoteCard({ text: plainText(n.text), title: b?.title || '', author: b?.author, page: n.page, style: v.style, format: v.format, handle: state.settings.handle, photo }),
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
          subheading: `${books.length} ${books.length === 1 ? 'livro' : 'livros'} · ${pages.toLocaleString('pt-BR')} páginas${pLabel}`,
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
      render: (v) => Share.wrappedSlides(state, { period: v.period, name: state.settings.name, handle: state.settings.handle, xp: state.stats.xp }),
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
        return api.snapshot({ width, height, title: 'Minha rede de ideias', subtitle: `${st.books} livros · ${st.nodes} ideias · ${st.links} conexões`, handle: state.settings.handle });
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
  return 'Os avisos automáticos funcionam com o app instalado no Android (Chrome), uma vez por dia após o horário. Para garantir, adicione também ao calendário do celular.';
}

async function saveReminder(enabled, time) {
  state.settings = { ...state.settings, reminder: { enabled, time } };
  await db.setKV('settings', state.settings);
  if (!enabled) return;
  if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
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
  const data = { app: 'grifo', version: 2, exportedAt: new Date().toISOString(), ...Object.fromEntries(STORES.map((s) => [s, state[s]])), settings: state.settings, badges: state.badges, challenges: state.challenges };
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
    if (confirm('Excluir este card?')) await commit(() => remove('cards', id));
  },
  startReview: () => {
    const today = G.ymd();
    const due = state.cards.filter((c) => c.due <= today).sort((a, b) => a.due.localeCompare(b.due) || a.createdAt - b.createdAt);
    review = { queue: due.slice(0, state.settings.dailyCards).map((c) => c.id), revealed: false, done: 0 };
    render();
  },
  stopReview: () => { review = review && { ...review, queue: [] }; render(); },
  reveal: () => { review.revealed = true; render(); },
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
    location.hash = '#/livros';
  },
  async deleteNote({ id }) {
    const cards = state.cards.filter((c) => c.noteId === id);
    if (!confirm(`Excluir esta nota${cards.length ? ` e ${cards.length} card(s)` : ''}?`)) return;
    await commit(async () => {
      for (const c of cards) await remove('cards', c.id);
      await remove('notes', id);
    });
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
  if (e.target.dataset.bookFilter) {
    const v = e.target.value;
    document.querySelectorAll(`${e.target.dataset.bookFilter} [data-book]`).forEach((el) => { el.hidden = v && el.dataset.book !== v; });
  }
  if (e.target.matches('[data-theme-pick]')) applyTheme(e.target.value);
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
  conta: accountView, u: publicProfileView, clubes: clubsView, perguntar: askView, plus: plusView,
};
const TAB_OF = { livro: 'livros', nota: 'notas', conceito: 'notas', mapa: 'notas', perguntar: 'notas', stats: 'progresso', conquistas: 'progresso', clubes: 'progresso' };

function render() {
  const [, name = '', arg] = location.hash.slice(1).split('/');
  const gated = Cloud.enabled() && !Cloud.user() && name !== 'u';
  document.body.classList.toggle('gated', gated);
  let fn = gated ? accountView : routes[name] || home;
  if (fn === home && (needsOnboarding() || (onbStep >= 2 && !state.settings.onboarded))) fn = onboarding;
  const keepScroll = view.dataset.route === location.hash;
  const y = scrollY;
  graphApi = null;
  view.innerHTML = fn(arg);
  fn.mount?.(arg);
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
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(500); });
setInterval(() => scheduleSync(0), 5 * 60 * 1000);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
